import {
  CONNECTION_ENDPOINTS, conversationsPageUrl, findGraphqlUrls, messagesUrl, parseConnections, parseConversations, parseMe, parseMessages,
  VOYAGER, type ParsedConversation, type QueryIds,
} from "./linkedin";
import type { CollectedConnection, CollectedMessage, ErrorResponse, JobStatus, Request, SyncOptions, SyncSince } from "./protocol";
import { clearCollected, count, loadJob, page, putConnections, putMessages, saveJob } from "./store";

declare const __TOOL_ORIGINS__: string[];

const ALARM = "lnt-resume";
const MESSAGING_URL = "https://www.linkedin.com/messaging/";
const FEED_URL = "https://www.linkedin.com/feed/";
const MAX_CONNECTION_PAGES = 1000;
const MAX_RETRIES = 3;

let running = false;
let cancelRequested = false;
const openedTabs = new Set<number>();

class StopError extends Error {}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const politeDelay = (): Promise<void> => sleep(1200 + Math.random() * 1300);
const now = (): string => new Date().toISOString();

async function waitForTab(tabId: number): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await sleep(500);
  }
}

async function linkedinTab(url: string): Promise<number> {
  const tabs = await chrome.tabs.query({ url: "https://www.linkedin.com/*" });
  const existing = tabs.find((t) => t.id !== undefined && (url === FEED_URL || (t.url ?? "").startsWith(url)));
  if (existing?.id !== undefined) return existing.id;
  const tab = await chrome.tabs.create({ url, active: false });
  if (tab.id === undefined) throw new Error("Could not open a LinkedIn tab");
  openedTabs.add(tab.id);
  await waitForTab(tab.id);
  await sleep(3000);
  return tab.id;
}

interface PageResult {
  status: number;
  body: unknown;
}

async function pageFetch(tabId: number, url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    if (cancelRequested) throw new StopError("cancelled");
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [url],
      func: async (target: string): Promise<PageResult> => {
        const token = /JSESSIONID="?([^";]+)/.exec(document.cookie)?.[1];
        if (!token) return { status: 401, body: null };
        const graphql = target.includes("/graphql");
        const response = await fetch(target, {
          credentials: "include",
          headers: {
            "csrf-token": token,
            "x-restli-protocol-version": "2.0.0",
            "x-li-lang": "en_US",
            accept: graphql ? "application/graphql" : "application/vnd.linkedin.normalized+json+2.1",
          },
        });
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        return { status: response.status, body };
      },
    });
    const result = injection?.result as PageResult | undefined;
    if (!result) throw new Error("LinkedIn tab did not answer");
    if (result.status === 200) return result.body;
    if (result.status === 401 || result.status === 403) throw new Error("Not signed in to LinkedIn in this browser (or the session expired). Sign in and try again.");
    if ((result.status === 429 || result.status >= 500) && attempt < MAX_RETRIES) {
      await sleep(30_000 * (attempt + 1));
      continue;
    }
    throw new Error(`LinkedIn answered ${result.status} for ${url.split("?")[0]}`);
  }
}

async function resourceUrls(tabId: number): Promise<string[]> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => performance.getEntriesByType("resource").map((e) => e.name),
  });
  return (injection?.result as string[] | undefined) ?? [];
}

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
    owner: { name: "", slug: "" },
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
          if (error instanceof StopError || (error instanceof Error && error.message.startsWith("Not signed in"))) throw error;
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
    const since = job.since.newestConnectionAt;
    if (since && items.every((c) => c.connectedAt !== "" && c.connectedAt < since)) return;
    await politeDelay();
  }
  note(job, "Stopped connections after the safety page limit");
}

async function loadConversations(): Promise<ParsedConversation[]> {
  const stored = await chrome.storage.local.get("conversations");
  return (stored.conversations as ParsedConversation[] | undefined) ?? [];
}

async function syncMessages(job: JobStatus): Promise<void> {
  const tabId = await linkedinTab(MESSAGING_URL);
  await sleep(4000);
  const stored = await chrome.storage.local.get("queryIds");
  const found = findGraphqlUrls(await resourceUrls(tabId));
  const ids: QueryIds = {
    conversations: found.conversations || ((stored.queryIds as QueryIds | undefined)?.conversations ?? ""),
    messages: found.messages || ((stored.queryIds as QueryIds | undefined)?.messages ?? ""),
  };
  await chrome.storage.local.set({ queryIds: ids });
  if (!ids.conversations) {
    note(job, "Message history was not read: open linkedin.com/messaging once in this browser, then sync again.");
    return;
  }
  const sinceMs = job.since.newestMessageAt ? Date.parse(job.since.newestMessageAt) : 0;

  if (job.phase !== "messages") {
    job.phase = "conversations";
    const conversations = new Map((await loadConversations()).map((c) => [c.urn, c]));
    let before = job.cursor.conversationsBefore;
    while (conversations.size < job.options.maxConversations) {
      const body = await pageFetch(tabId, conversationsPageUrl(ids.conversations, before));
      const pageItems = parseConversations(body);
      const fresh = pageItems.filter((c) => !conversations.has(c.urn));
      for (const c of pageItems) conversations.set(c.urn, c);
      const byUrn = new Map(pageItems.map((c) => [c.urn, c]));
      const inline = parseMessages(body, byUrn).filter((m) => Date.parse(m.at) > sinceMs);
      if (inline.length > 0) await putMessages(inline);
      job.counts.conversations = conversations.size;
      job.counts.messages = await count("messages");
      const oldest = pageItems[pageItems.length - 1]?.lastActivityAt ?? 0;
      await chrome.storage.local.set({ conversations: [...conversations.values()] });
      if (fresh.length === 0 || oldest === 0 || oldest <= sinceMs) break;
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

  if (!ids.messages) {
    note(job, "Only the latest message of each conversation was read. Open any conversation on linkedin.com/messaging, then sync again for full threads.");
    return;
  }
  const changed = (await loadConversations()).filter((c) => c.lastActivityAt > sinceMs);
  const byUrn = new Map(changed.map((c) => [c.urn, c]));
  for (let i = job.cursor.conversationIndex; i < changed.length; i += 1) {
    const conv = changed[i]!;
    const items: CollectedMessage[] = parseMessages(await pageFetch(tabId, messagesUrl(ids.messages, conv.urn)), byUrn).filter((m) => Date.parse(m.at) > sinceMs);
    if (items.length > 0) await putMessages(items);
    job.cursor.conversationIndex = i + 1;
    job.counts.messages = await count("messages");
    await save(job);
    await politeDelay();
  }
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
      await syncMessages(job);
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
    if (job.state !== "running") {
      await Promise.all([...openedTabs].map((id) => chrome.tabs.remove(id).catch(() => undefined)));
      openedTabs.clear();
    }
    if (job.state !== "running") await chrome.alarms.clear(ALARM);
  }
}

function sameSince(a: SyncSince, b: SyncSince): boolean {
  return a.newestConnectionAt === b.newestConnectionAt && a.newestMessageAt === b.newestMessageAt;
}

async function start(since: SyncSince, options: SyncOptions): Promise<JobStatus> {
  const previous = await loadJob();
  let job: JobStatus;
  if (previous && previous.state !== "done" && sameSince(previous.since, since)) {
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
  return { messages: value?.messages !== false, maxConversations: Number.isFinite(max) && max > 0 ? Math.min(max, 20_000) : 3000 };
}

function sanitizeSince(value: Partial<SyncSince> | undefined): SyncSince {
  const iso = (v: unknown): string => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 40) : "");
  return { newestConnectionAt: iso(value?.newestConnectionAt), newestMessageAt: iso(value?.newestMessageAt) };
}

async function handle(request: Request): Promise<unknown> {
  switch (request.type) {
    case "hello":
      return { ok: true, version: chrome.runtime.getManifest().version, job: await loadJob() };
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
      const part = request.part === "messages" ? "messages" : "connections";
      const limit = Math.min(Math.max(1, Number(request.limit) || 500), 2000);
      const offset = Math.max(0, Number(request.offset) || 0);
      return { ok: true, items: await page(part, offset, limit), total: await count(part) };
    }
    case "clear":
      await clearCollected();
      return { ok: true };
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
  if (sender.id !== chrome.runtime.id || (request.type !== "status" && request.type !== "cancel")) return false;
  return respond(request, sendResponse);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void runJob();
});

chrome.runtime.onStartup.addListener(() => void runJob());
