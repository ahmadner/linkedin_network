import {
  CONNECTION_ENDPOINTS, conversationsPageUrl, findGraphqlUrls, messagesUrl, parseConnections, parseConversations, parseMe, parseMessages,
  VOYAGER, type ParsedConversation, type QueryIds,
} from "./linkedin";
import type { CollectedConnection, CollectedMessage, ErrorResponse, JobStatus, Request, SyncOptions, SyncSince } from "./protocol";
import { clearCollected, count, loadJob, loadPostsJob, page, putConnections, putMessages, saveJob } from "./store";
import { OUTBOX_ALARM, outboxStatus, processOutbox, readCandidates, startOutbox, stopOutbox } from "./outbox";
import { cancelPosts, POSTS_ALARM, runPostsJob, startPosts } from "./postsSync";
import { closeTabs, FEED_URL, isFatal, linkedinTab as sharedLinkedinTab, openTab as openSharedTab, pageRequest, resourceUrls, sleep, StopError } from "./tab";

declare const __TOOL_ORIGINS__: string[];

const ALARM = "lnt-resume";
const MESSAGING_URL = "https://www.linkedin.com/messaging/";
const MAX_CONNECTION_PAGES = 1000;
const MAX_THREAD_FAILURES = 5;
const RESUME_WINDOW_MS = 30 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const GRAPHQL_PATTERN = "https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql*";

let running = false;
let cancelRequested = false;

const politeDelay = (): Promise<void> => sleep(1200 + Math.random() * 1300);
const now = (): string => new Date().toISOString();
const pageFetch = (tabId: number, url: string): Promise<unknown> => pageRequest(tabId, url, { stop: () => cancelRequested });
const openTab = (url: string): Promise<number> => openSharedTab(url, "sync");
const linkedinTab = (url: string): Promise<number> => sharedLinkedinTab(url, "sync");

function newJob(since: SyncSince, options: SyncOptions): JobStatus {
  return {
    id: crypto.randomUUID(),
    state: "running",
    phase: "starting",
    startedAt: now(),
    updatedAt: now(),
    finishedAt: "",
    since,
    options,
    owner: { name: "", slug: "", memberId: "" },
    counts: { connections: 0, conversations: 0, messages: 0 },
    cursor: { connectionsStart: 0, conversationsBefore: 0, conversationIndex: 0 },
    notes: [],
    error: "",
  };
}

async function save(job: JobStatus): Promise<void> {
  job.updatedAt = now();
  await saveJob(job);
}

function note(job: JobStatus, text: string): void {
  if (!job.notes.includes(text)) job.notes.push(text);
}

async function syncConnections(job: JobStatus, tabId: number): Promise<void> {
  let endpoint = -1;
  for (let pages = 0; pages < MAX_CONNECTION_PAGES; pages += 1) {
    let items: CollectedConnection[] = [];
    if (endpoint < 0) {
      for (let i = 0; i < CONNECTION_ENDPOINTS.length; i += 1) {
        try {
          items = parseConnections(await pageFetch(tabId, CONNECTION_ENDPOINTS[i]!(job.cursor.connectionsStart)));
        } catch (error) {
          if (isFatal(error)) throw error;
          continue;
        }
        if (items.length > 0 || i === CONNECTION_ENDPOINTS.length - 1) {
          endpoint = i;
          break;
        }
      }
      if (endpoint < 0) throw new Error("LinkedIn connection endpoints did not answer. LinkedIn may have changed them.");
    } else {
      items = parseConnections(await pageFetch(tabId, CONNECTION_ENDPOINTS[endpoint]!(job.cursor.connectionsStart)));
    }
    if (items.length === 0) return;
    await putConnections(items);
    job.counts.connections = await count("connections");
    job.cursor.connectionsStart += items.length;
    await save(job);
    const since = dayBefore(job.since.newestConnectionAt);
    if (!job.options.photos && since && items.every((c) => c.connectedAt !== "" && c.connectedAt < since)) return;
    await politeDelay();
  }
  note(job, "Stopped connections after the safety page limit");
}

function dayBefore(day: string): string {
  const ms = Date.parse(day);
  return Number.isFinite(ms) ? new Date(ms - DAY_MS).toISOString().slice(0, 10) : "";
}

function sinceMessagesMs(job: JobStatus): number {
  const ms = job.since.newestMessageAt ? Date.parse(job.since.newestMessageAt) : 0;
  return Number.isFinite(ms) && ms > 0 ? ms - DAY_MS : 0;
}

async function loadConversations(): Promise<ParsedConversation[]> {
  const stored = await chrome.storage.local.get("conversations");
  return (stored.conversations as ParsedConversation[] | undefined) ?? [];
}

async function storedQueryIds(): Promise<QueryIds> {
  const stored = (await chrome.storage.local.get("queryIds")).queryIds as Partial<QueryIds> | undefined;
  return { conversations: stored?.conversations ?? "", messages: stored?.messages ?? "" };
}

async function rememberQueryIds(found: QueryIds): Promise<QueryIds> {
  const stored = await storedQueryIds();
  const ids = { conversations: found.conversations || stored.conversations, messages: found.messages || stored.messages };
  if (ids.conversations !== stored.conversations || ids.messages !== stored.messages) await chrome.storage.local.set({ queryIds: ids });
  return ids;
}

async function discoverQueryIds(tabId: number): Promise<QueryIds> {
  return rememberQueryIds(findGraphqlUrls(await resourceUrls(tabId)));
}

async function freshQueryIds(dropStored: boolean): Promise<{ tabId: number; ids: QueryIds }> {
  const tabId = await openTab(MESSAGING_URL);
  await sleep(4000);
  const found = findGraphqlUrls(await resourceUrls(tabId));
  if (!dropStored) return { tabId, ids: await rememberQueryIds(found) };
  await chrome.storage.local.set({ queryIds: found });
  return { tabId, ids: found };
}

async function readConversations(job: JobStatus, tabId: number, ids: QueryIds, sinceMs: number): Promise<void> {
  job.phase = "conversations";
  const conversations = new Map((await loadConversations()).map((c) => [c.urn, c]));
  let before = job.cursor.conversationsBefore;
  while (conversations.size < job.options.maxConversations) {
    const body = await pageFetch(tabId, conversationsPageUrl(ids.conversations, before));
    const pageItems = parseConversations(body);
    const fresh = pageItems.filter((c) => !conversations.has(c.urn));
    for (const c of pageItems) conversations.set(c.urn, c);
    const byUrn = new Map(pageItems.map((c) => [c.urn, c]));
    const inline = parseMessages(body, byUrn, job.owner).filter((m) => Date.parse(m.at) > sinceMs);
    if (inline.length > 0) await putMessages(inline);
    job.counts.conversations = conversations.size;
    job.counts.messages = await count("messages");
    await chrome.storage.local.set({ conversations: [...conversations.values()] });
    const oldest = pageItems[pageItems.length - 1]?.lastActivityAt ?? 0;
    if (oldest === 0 || oldest <= sinceMs) break;
    if (fresh.length === 0) {
      note(job, "LinkedIn stopped returning older conversations, so some older threads may be missing.");
      break;
    }
    before = oldest - 1;
    job.cursor.conversationsBefore = before;
    await save(job);
    await politeDelay();
  }
  if (conversations.size >= job.options.maxConversations) note(job, `Stopped at ${job.options.maxConversations} conversations`);
  job.phase = "messages";
  job.cursor.conversationIndex = 0;
  await save(job);
}

async function readThreads(job: JobStatus, tabId: number, ids: QueryIds, sinceMs: number): Promise<void> {
  const changed = (await loadConversations()).filter((c) => c.lastActivityAt > sinceMs);
  const byUrn = new Map(changed.map((c) => [c.urn, c]));
  let failures = 0;
  let skipped = 0;
  for (let i = job.cursor.conversationIndex; i < changed.length; i += 1) {
    const conv = changed[i]!;
    try {
      const items: CollectedMessage[] = parseMessages(await pageFetch(tabId, messagesUrl(ids.messages, conv.urn)), byUrn, job.owner, conv.urn).filter((m) => Date.parse(m.at) > sinceMs);
      if (items.length > 0) await putMessages(items);
      failures = 0;
    } catch (error) {
      if (isFatal(error)) throw error;
      failures += 1;
      skipped += 1;
      if (failures >= MAX_THREAD_FAILURES) {
        note(job, `Stopped reading full threads after ${MAX_THREAD_FAILURES} failed requests in a row (${error instanceof Error ? error.message : String(error)}). The latest message of each conversation was still saved.`);
        return;
      }
    }
    job.cursor.conversationIndex = i + 1;
    job.counts.messages = await count("messages");
    await save(job);
    await politeDelay();
  }
  if (skipped > 0) note(job, `${skipped} conversations could not be read in full and were skipped.`);
}

async function syncMessages(job: JobStatus): Promise<void> {
  let tabId = await linkedinTab(MESSAGING_URL);
  await sleep(4000);
  let ids = await discoverQueryIds(tabId);
  if (!ids.conversations || !ids.messages) ({ tabId, ids } = await freshQueryIds(false));
  if (!ids.conversations) {
    note(job, "Message history was not read: LinkedIn messaging did not load in the background tab. Open linkedin.com/messaging once in this browser, then sync again.");
    return;
  }
  const sinceMs = sinceMessagesMs(job);

  if (job.phase !== "messages") {
    try {
      await readConversations(job, tabId, ids, sinceMs);
    } catch (error) {
      if (isFatal(error)) throw error;
      ({ tabId, ids } = await freshQueryIds(true));
      if (!ids.conversations) throw error;
      job.cursor.conversationsBefore = 0;
      await chrome.storage.local.remove("conversations");
      await readConversations(job, tabId, ids, sinceMs);
    }
  }

  if (!ids.messages) {
    note(job, "Only the latest message of each conversation was read. Open any conversation on linkedin.com/messaging, then sync again for full threads.");
    return;
  }
  await readThreads(job, tabId, ids, sinceMs);
}

async function runJob(): Promise<void> {
  if (running) return;
  const job = await loadJob();
  if (!job || job.state !== "running") return;
  running = true;
  cancelRequested = false;
  try {
    const tabId = await linkedinTab(FEED_URL);
    if (job.phase === "starting" || job.phase === "profile") {
      job.phase = "profile";
      job.owner = parseMe(await pageFetch(tabId, `${VOYAGER}/me`));
      job.phase = "connections";
      await save(job);
    }
    if (job.phase === "connections") {
      await syncConnections(job, tabId);
      job.phase = job.options.messages ? "discovery" : "finished";
      await save(job);
    }
    if (job.phase === "discovery" || job.phase === "conversations" || job.phase === "messages") {
      try {
        await syncMessages(job);
      } catch (error) {
        if (isFatal(error)) throw error;
        note(job, `Messages were not fully read: ${error instanceof Error ? error.message : String(error)}. People were still synced.`);
      }
    }
    job.phase = "finished";
    job.state = "done";
    job.finishedAt = now();
  } catch (error) {
    job.state = error instanceof StopError ? "cancelled" : "error";
    job.error = error instanceof StopError ? "" : error instanceof Error ? error.message : String(error);
  } finally {
    running = false;
    await save(job);
    if (job.state !== "running") await closeTabs("sync");
    if (job.state !== "running") await chrome.alarms.clear(ALARM);
  }
}

function sameSince(a: SyncSince, b: SyncSince): boolean {
  return a.newestConnectionAt === b.newestConnectionAt && a.newestMessageAt === b.newestMessageAt;
}

function resumable(previous: JobStatus | null, since: SyncSince): previous is JobStatus {
  if (!previous || previous.state === "done" || !sameSince(previous.since, since)) return false;
  if (previous.state === "running") return true;
  return Date.now() - Date.parse(previous.updatedAt) < RESUME_WINDOW_MS;
}

async function start(since: SyncSince, options: SyncOptions): Promise<JobStatus> {
  const previous = await loadJob();
  let job: JobStatus;
  if (resumable(previous, since)) {
    job = { ...previous, state: "running", error: "", options };
  } else {
    if (running) throw new Error("A sync is already running");
    await clearCollected();
    await chrome.storage.local.remove("conversations");
    job = newJob(since, options);
  }
  await save(job);
  await chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  void runJob();
  return job;
}

function sanitizeOptions(value: Partial<SyncOptions> | undefined): SyncOptions {
  const max = Number(value?.maxConversations);
  return { messages: value?.messages !== false, photos: value?.photos === true, maxConversations: Number.isFinite(max) && max > 0 ? Math.min(max, 20_000) : 3000 };
}

function sanitizeSince(value: Partial<SyncSince> | undefined): SyncSince {
  const iso = (v: unknown): string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 40) : "");
  return { newestConnectionAt: iso(value?.newestConnectionAt), newestMessageAt: iso(value?.newestMessageAt) };
}

async function handle(request: Request): Promise<unknown> {
  switch (request.type) {
    case "hello":
      return { ok: true, version: chrome.runtime.getManifest().version, job: await loadJob(), features: ["posts"], postsJob: await loadPostsJob() };
    case "status":
      return { ok: true, job: await loadJob() };
    case "start":
      return { ok: true, job: await start(sanitizeSince(request.since), sanitizeOptions(request.options)) };
    case "cancel": {
      cancelRequested = true;
      const job = await loadJob();
      if (job && job.state === "running" && !running) {
        job.state = "cancelled";
        await save(job);
      }
      return { ok: true, job };
    }
    case "fetch": {
      const part = request.part === "messages" || request.part === "posts" ? request.part : "connections";
      const limit = Math.min(Math.max(1, Number(request.limit) || 500), 2000);
      const offset = Math.max(0, Number(request.offset) || 0);
      return { ok: true, items: await page(part, offset, limit), total: await count(part) };
    }
    case "posts-start":
      return { ok: true, job: await startPosts(typeof request.since === "string" ? request.since : "") };
    case "posts-status":
      return { ok: true, job: await loadPostsJob() };
    case "posts-cancel":
      return { ok: true, job: await cancelPosts() };
    case "clear":
      await clearCollected();
      return { ok: true };
    case "outbox-start":
      await startOutbox(request.kind === "invite" ? "invite" : "message", request.items);
      return outboxStatus();
    case "outbox-status":
      return outboxStatus();
    case "outbox-cancel":
      await stopOutbox();
      return outboxStatus();
    case "candidates":
      return { ok: true, ...(await readCandidates()) };
    default:
      return { ok: false, error: "Unknown request" } satisfies ErrorResponse;
  }
}

function respond(request: Request, sendResponse: (r: unknown) => void): true {
  handle(request)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies ErrorResponse));
  return true;
}

chrome.runtime.onMessageExternal.addListener((request: Request, sender, sendResponse) => {
  if (!sender.origin || !__TOOL_ORIGINS__.includes(sender.origin)) {
    sendResponse({ ok: false, error: "This page is not allowed to use the extension" } satisfies ErrorResponse);
    return false;
  }
  return respond(request, sendResponse);
});

chrome.runtime.onMessage.addListener((request: Request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || (request.type !== "status" && request.type !== "cancel" && request.type !== "posts-status")) return false;
  return respond(request, sendResponse);
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const found = findGraphqlUrls([details.url]);
    if (found.conversations || found.messages) void rememberQueryIds(found);
    return undefined;
  },
  { urls: [GRAPHQL_PATTERN], types: ["xmlhttprequest"] },
);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void runJob();
  if (alarm.name === OUTBOX_ALARM) void processOutbox();
  if (alarm.name === POSTS_ALARM) void runPostsJob();
});

chrome.runtime.onStartup.addListener(() => {
  void runJob();
  void processOutbox();
  void runPostsJob();
});
