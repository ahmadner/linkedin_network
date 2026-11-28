import type {
  CandidatesResponse, CollectedConnection, CollectedMessage, CollectedPost, ExtensionEnvelope, FetchResponse, HelloResponse, JobResponse, JobStatus, OutboxDraft, OutboxKind, OutboxResponse, PageEnvelope, PostsJob, PostsJobResponse, Request, SyncOptions, SyncSince,
} from "../../extension/src/protocol";
import { EXTENSION_CHANNEL, PAGE_CHANNEL } from "../../extension/src/protocol";
import { sanitizePost, type Post, type SyncedPost } from "../core/content";
import targets from "../../extension/targets.json";
import { sanitizeSyncPayload, type SyncPayload } from "../core/dataset";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export const LOCAL_TOOL = LOCAL_HOSTS.has(globalThis.location?.hostname ?? "");
const EXTENSION_ID = LOCAL_TOOL ? targets.local.id : targets.production.id;
const PAGE = 1000;

const HELLO_TIMEOUT_MS = 2500;
const REQUEST_TIMEOUT_MS = 120_000;

interface PageRuntime {
  sendMessage(id: string, message: unknown, callback: (response: unknown) => void): void;
  lastError?: { message?: string };
}

function runtime(): PageRuntime | null {
  const chromeGlobal = (globalThis as { chrome?: { runtime?: PageRuntime } }).chrome;
  return chromeGlobal?.runtime?.sendMessage ? chromeGlobal.runtime : null;
}

function settle<T>(response: unknown, resolve: (value: T) => void, reject: (error: Error) => void): void {
  const r = response as { ok?: boolean; error?: string } | undefined;
  if (!r || r.ok !== true) reject(new Error(r?.error ?? "The extension did not answer."));
  else resolve(response as T);
}

function viaRuntime<T>(rt: PageRuntime, request: Request): Promise<T> {
  return new Promise((resolve, reject) => {
    rt.sendMessage(EXTENSION_ID, request, (response) => {
      const error = rt.lastError;
      if (error) reject(new Error(error.message ?? "The extension did not answer."));
      else settle(response, resolve, reject);
    });
  });
}

let nextId = 1;

function viaContentScript<T>(request: Request): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    const done = (): void => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as Partial<ExtensionEnvelope> | null;
      if (event.source !== window || event.origin !== location.origin || data?.channel !== EXTENSION_CHANNEL || data.id !== id) return;
      done();
      settle(data.response, resolve, reject);
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(request.type === "hello" ? "The extension is not installed in this browser." : "The extension did not answer."));
    }, request.type === "hello" ? HELLO_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    window.postMessage({ channel: PAGE_CHANNEL, id, request } satisfies PageEnvelope, location.origin);
  });
}

let bridgeReady: Promise<boolean> | null = null;

function contentScriptReady(): Promise<boolean> {
  bridgeReady ??= viaContentScript<HelloResponse>({ type: "hello" }).then(() => true, () => {
    bridgeReady = null;
    return false;
  });
  return bridgeReady;
}

async function send<T>(request: Request): Promise<T> {
  const rt = runtime();
  if (rt) return viaRuntime<T>(rt, request);
  if (typeof window === "undefined" || (request.type !== "hello" && !(await contentScriptReady()))) throw new Error("The extension is not installed in this browser.");
  return viaContentScript<T>(request);
}

export const IS_FIREFOX = /\bFirefox\//.test(globalThis.navigator?.userAgent ?? "");

export async function detectExtension(): Promise<HelloResponse | null> {
  try {
    return await send<HelloResponse>({ type: "hello" });
  } catch {
    return null;
  }
}

export async function startSync(since: SyncSince, options: SyncOptions): Promise<JobStatus | null> {
  return (await send<JobResponse>({ type: "start", since, options })).job;
}

export async function syncStatus(): Promise<JobStatus | null> {
  return (await send<JobResponse>({ type: "status" })).job;
}

export async function cancelSync(): Promise<void> {
  await send<JobResponse>({ type: "cancel" });
}

async function pullAll<T>(part: "connections" | "messages" | "posts", onProgress: (done: number, total: number) => void): Promise<T[]> {
  const items: T[] = [];
  for (;;) {
    const r = await send<FetchResponse<T>>({ type: "fetch", part, offset: items.length, limit: PAGE });
    items.push(...r.items);
    onProgress(items.length, r.total);
    if (r.items.length === 0 || items.length >= r.total) return items;
  }
}

export async function collectResult(job: JobStatus, onProgress: (label: string) => void): Promise<SyncPayload> {
  const connections = await pullAll<CollectedConnection>("connections", (d, t) => onProgress(`connections ${d}/${t}`));
  const messages = await pullAll<CollectedMessage>("messages", (d, t) => onProgress(`messages ${d}/${t}`));
  return sanitizeSyncPayload({ collectedAt: job.finishedAt || new Date().toISOString(), owner: job.owner, connections, messages, notes: job.notes });
}

export async function clearExtensionData(): Promise<void> {
  await send<{ ok: true }>({ type: "clear" });
}

export function outboxStart(kind: OutboxKind, items: OutboxDraft[]): Promise<OutboxResponse> {
  return send<OutboxResponse>({ type: "outbox-start", kind, items });
}

export function outboxStatus(): Promise<OutboxResponse> {
  return send<OutboxResponse>({ type: "outbox-status" });
}

export function outboxCancel(): Promise<OutboxResponse> {
  return send<OutboxResponse>({ type: "outbox-cancel" });
}

export function searchCandidates(): Promise<CandidatesResponse> {
  return send<CandidatesResponse>({ type: "candidates" });
}

export function supportsPosts(hello: HelloResponse | null): boolean {
  return Boolean(hello?.features?.includes("posts"));
}

export async function startPostsSync(since: string): Promise<PostsJob | null> {
  return (await send<PostsJobResponse>({ type: "posts-start", since })).job;
}

export async function postsSyncStatus(): Promise<PostsJob | null> {
  return (await send<PostsJobResponse>({ type: "posts-status" })).job;
}

export async function cancelPostsSync(): Promise<void> {
  await send<PostsJobResponse>({ type: "posts-cancel" });
}

const URN = /^urn:li:(activity|share|ugcPost):\d+$/;

export function toSyncedPost(raw: CollectedPost): SyncedPost | null {
  const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  const id = typeof raw.id === "string" && URN.test(raw.id) ? raw.id : "";
  const url = typeof raw.url === "string" && /^https:\/\/www\.linkedin\.com\/feed\/update\//.test(raw.url) ? raw.url : "";
  const metrics = { impressions: n(raw.impressions), reactions: n(raw.reactions), comments: n(raw.comments), reposts: n(raw.reposts) };
  const post: Post | null = sanitizePost({ id, at: raw.at, text: raw.text, url, sharedUrl: "", media: raw.media, origin: "sync", metrics });
  if (!post) return null;
  const keys = (Array.isArray(raw.urns) ? raw.urns : []).filter((u): u is string => typeof u === "string" && URN.test(u)).slice(0, 10);
  return { post, keys };
}

export async function collectPosts(onProgress: (label: string) => void): Promise<SyncedPost[]> {
  const raw = await pullAll<CollectedPost>("posts", (d, t) => onProgress(`${d}/${t}`));
  return raw.map(toSyncedPost).filter((p): p is SyncedPost => p !== null);
}
