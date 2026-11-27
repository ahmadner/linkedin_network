import { candidateFrom, findMemberId, inviteRequest, MEMBER_ID, messageRequest, parseMe, profileLookupUrl, VANITY_SLUG, VOYAGER } from "./linkedin";
import type { Candidate, OutboxDraft, OutboxItem, OutboxJob, OutboxKind, OutboxLimits, OutboxResponse, OutboxUsage } from "./protocol";
import { closeTabs, FEED_URL, isFatal, linkedinTab, pageRequest } from "./tab";

export const OUTBOX_ALARM = "lnt-outbox";

export const LIMITS: Record<OutboxKind, OutboxLimits> = {
  message: { day: 25, week: 100 },
  invite: { day: 20, week: 80 },
};

const TEXT_LIMIT: Record<OutboxKind, number> = { message: 8000, invite: 300 };
const MAX_ITEMS = 50;
const MIN_GAP_MS = 45_000;
const MAX_GAP_MS = 120_000;
const MAX_FAILURES_IN_ROW = 3;
const DAY_MS = 24 * 60 * 60_000;
const SEARCH_URL = "https://www.linkedin.com/search/results/people/";

interface SentEntry {
  kind: OutboxKind;
  at: number;
}

let busy = false;
let ownerId = "";
let stopRequested = false;

const now = (): string => new Date().toISOString();

async function loadOutbox(): Promise<OutboxJob | null> {
  return ((await chrome.storage.local.get("outbox")).outbox as OutboxJob | undefined) ?? null;
}

async function saveOutbox(job: OutboxJob): Promise<void> {
  job.updatedAt = now();
  await chrome.storage.local.set({ outbox: job });
}

async function sentLog(): Promise<SentEntry[]> {
  const log = ((await chrome.storage.local.get("sentLog")).sentLog as SentEntry[] | undefined) ?? [];
  return log.filter((e) => Date.now() - e.at < 7 * DAY_MS);
}

async function recordSent(kind: OutboxKind): Promise<void> {
  const log = await sentLog();
  log.push({ kind, at: Date.now() });
  await chrome.storage.local.set({ sentLog: log });
}

export async function usage(): Promise<Record<OutboxKind, OutboxUsage>> {
  const log = await sentLog();
  const of = (kind: OutboxKind): OutboxUsage => ({
    day: log.filter((e) => e.kind === kind && Date.now() - e.at < DAY_MS).length,
    week: log.filter((e) => e.kind === kind).length,
    limits: LIMITS[kind],
  });
  return { message: of("message"), invite: of("invite") };
}

function capReached(u: OutboxUsage): string {
  if (u.day >= u.limits.day) return `Reached today's safe limit of ${u.limits.day}. The rest stays in the list for tomorrow.`;
  if (u.week >= u.limits.week) return `Reached this week's safe limit of ${u.limits.week}. The rest stays in the list for next week.`;
  return "";
}

function sanitizeDrafts(kind: OutboxKind, drafts: unknown): OutboxItem[] {
  const list = Array.isArray(drafts) ? (drafts as Array<Partial<OutboxDraft>>) : [];
  const seen = new Set<string>();
  const out: OutboxItem[] = [];
  for (const d of list) {
    const slug = typeof d.slug === "string" ? d.slug.trim().toLowerCase() : "";
    const memberId = typeof d.memberId === "string" && MEMBER_ID.test(d.memberId) ? d.memberId : "";
    const text = typeof d.text === "string" ? d.text.trim() : "";
    const id = memberId || slug;
    if (!id || (!memberId && !VANITY_SLUG.test(slug)) || seen.has(id)) continue;
    if (kind === "message" && !text) continue;
    if (text.length > TEXT_LIMIT[kind]) continue;
    seen.add(id);
    out.push({
      key: typeof d.key === "string" ? d.key.slice(0, 200) : id,
      kind,
      slug: memberId ? "" : slug,
      memberId,
      name: typeof d.name === "string" ? d.name.slice(0, 200) : "",
      text,
      state: "pending",
      error: "",
      at: "",
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export async function startOutbox(kind: OutboxKind, drafts: unknown): Promise<OutboxJob> {
  const current = await loadOutbox();
  if (current?.state === "running") throw new Error("Another send list is still running. Stop it first.");
  const items = sanitizeDrafts(kind, drafts);
  if (items.length === 0) throw new Error("There is nothing valid to send.");
  const cap = capReached((await usage())[kind]);
  if (cap) throw new Error(cap);
  const job: OutboxJob = { id: crypto.randomUUID(), kind, state: "running", items, startedAt: now(), updatedAt: now(), nextAt: 0, error: "" };
  stopRequested = false;
  await saveOutbox(job);
  await chrome.alarms.create(OUTBOX_ALARM, { periodInMinutes: 0.5 });
  void processOutbox();
  return job;
}

export async function stopOutbox(): Promise<OutboxJob | null> {
  stopRequested = true;
  const job = await loadOutbox();
  if (job?.state === "running" && !busy) {
    job.state = "stopped";
    job.error = "Stopped by you.";
    await saveOutbox(job);
    await chrome.alarms.clear(OUTBOX_ALARM);
  }
  return job;
}

export async function outboxStatus(): Promise<OutboxResponse> {
  return { ok: true, job: await loadOutbox(), usage: await usage() };
}

function trackingId(): string {
  return String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)));
}

async function memberIdFor(tabId: number, item: OutboxItem): Promise<string> {
  if (item.memberId) return item.memberId;
  const id = findMemberId(await pageRequest(tabId, profileLookupUrl(item.slug), { retry: false }), item.slug);
  if (!id) throw new Error("Could not find this person on LinkedIn");
  return id;
}

async function sendOne(tabId: number, ownerId: string, item: OutboxItem): Promise<void> {
  const recipient = await memberIdFor(tabId, item);
  const request = item.kind === "message" ? messageRequest(ownerId, recipient, item.text, crypto.randomUUID(), trackingId()) : inviteRequest(recipient, item.text);
  await pageRequest(tabId, request.url, { method: "POST", body: request.body, retry: false });
}

async function finish(job: OutboxJob, state: "done" | "stopped", error = ""): Promise<void> {
  job.state = state;
  job.error = error;
  await saveOutbox(job);
  await chrome.alarms.clear(OUTBOX_ALARM);
  await closeTabs("outbox");
}

export async function processOutbox(): Promise<void> {
  if (busy) return;
  const job = await loadOutbox();
  if (!job || job.state !== "running") return;
  if (stopRequested) return finish(job, "stopped", "Stopped by you.");
  if (Date.now() < job.nextAt) return;
  const item = job.items.find((i) => i.state === "pending");
  if (!item) return finish(job, "done");
  const cap = capReached((await usage())[job.kind]);
  if (cap) return finish(job, "stopped", cap);

  busy = true;
  try {
    const tabId = await linkedinTab(FEED_URL, "outbox");
    ownerId ||= parseMe(await pageRequest(tabId, `${VOYAGER}/me`, { retry: false })).memberId;
    if (!ownerId) throw new Error("Could not read your own LinkedIn profile");
    if (stopRequested) return await finish(job, "stopped", "Stopped by you.");
    await sendOne(tabId, ownerId, item);
    item.state = "sent";
    item.at = now();
    await recordSent(job.kind);
    job.nextAt = Date.now() + MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS);
    await saveOutbox(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isFatal(error)) {
      await finish(job, "stopped", message);
      return;
    }
    item.state = "failed";
    item.error = message;
    item.at = now();
    const index = job.items.indexOf(item);
    const recent = job.items.slice(Math.max(0, index - MAX_FAILURES_IN_ROW + 1), index + 1);
    if (recent.length === MAX_FAILURES_IN_ROW && recent.every((i) => i.state === "failed")) {
      await finish(job, "stopped", `Stopped after ${MAX_FAILURES_IN_ROW} failed sends in a row: ${message}`);
      return;
    }
    job.nextAt = Date.now() + MIN_GAP_MS;
    await saveOutbox(job);
  } finally {
    busy = false;
  }
}

export async function readCandidates(): Promise<{ url: string; candidates: Candidate[] }> {
  const tabs = await chrome.tabs.query({ url: `${SEARCH_URL}*` });
  const tab = tabs.find((t) => t.active) ?? tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  if (tab?.id === undefined) throw new Error("Open a LinkedIn people search in this browser first.");
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const out: Array<{ id: string; name: string; headline: string; degree: string }> = [];
      const seen = new Set<string>();
      for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/in/"]'))) {
        const match = /\/in\/([^/?#]+)/.exec(a.href);
        const item = a.closest("li");
        if (!match?.[1] || !item) continue;
        const id = decodeURIComponent(match[1]);
        if (seen.has(id)) continue;
        const name = (a.querySelector('span[aria-hidden="true"]')?.textContent ?? a.textContent ?? "").trim();
        if (!name) continue;
        const text = item.innerText;
        const degree = /\b(1st|2nd|3rd\+?)\b/.exec(text)?.[1] ?? "";
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        const after = lines.findIndex((l) => /\b(1st|2nd|3rd\+?)\b/.test(l));
        const headline = lines.slice(after + 1).find((l) => l !== name && !/^(•|view |connect$|message$|follow$|pending$)/i.test(l) && !/\b(1st|2nd|3rd)\b/.test(l)) ?? "";
        seen.add(id);
        out.push({ id, name, headline, degree });
      }
      return out;
    },
  });
  const raw = (injection?.result as Array<{ id: string; name: string; headline: string; degree: string }> | undefined) ?? [];
  const candidates = raw.map(candidateFrom).filter((c): c is Candidate => c !== null).slice(0, 100);
  return { url: tab.url ?? SEARCH_URL, candidates };
}
