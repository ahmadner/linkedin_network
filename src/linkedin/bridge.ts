import type {
  CandidatesResponse, CollectedConnection, CollectedMessage, FetchResponse, HelloResponse, JobResponse, JobStatus, OutboxDraft, OutboxKind, OutboxResponse, Request, SyncOptions, SyncSince,
} from "../../extension/src/protocol";
import targets from "../../extension/targets.json";
import { sanitizeSyncPayload, type SyncPayload } from "../core/dataset";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export const LOCAL_TOOL = LOCAL_HOSTS.has(globalThis.location?.hostname ?? "");
const EXTENSION_ID = LOCAL_TOOL ? targets.local.id : targets.production.id;
const PAGE = 1000;

interface PageRuntime {
  sendMessage(id: string, message: unknown, callback: (response: unknown) => void): void;
  lastError?: { message?: string };
}

function runtime(): PageRuntime | null {
  const chromeGlobal = (globalThis as { chrome?: { runtime?: PageRuntime } }).chrome;
  return chromeGlobal?.runtime?.sendMessage ? chromeGlobal.runtime : null;
}

function send<T>(request: Request): Promise<T> {
  const rt = runtime();
  if (!rt) return Promise.reject(new Error("The extension is not installed in this browser."));
  return new Promise((resolve, reject) => {
    rt.sendMessage(EXTENSION_ID, request, (response) => {
      const error = rt.lastError;
      if (error) return reject(new Error(error.message ?? "The extension did not answer."));
      const r = response as { ok?: boolean; error?: string } | undefined;
      if (!r || r.ok !== true) return reject(new Error(r?.error ?? "The extension did not answer."));
      resolve(response as T);
    });
  });
}

export async function detectExtension(): Promise<HelloResponse | null> {
  if (!runtime()) return null;
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

async function pullAll<T>(part: "connections" | "messages", onProgress: (done: number, total: number) => void): Promise<T[]> {
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
