import type { ExportImport } from "../core/types";
import type { NamedFile } from "./exportImport";
import type { AppState } from "./state";
import type { WorkerRequest } from "./worker";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

type Payload = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

function call<T>(payload: Payload, transfer: Transferable[] = []): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = pending.get(event.data.id);
      if (!p) return;
      pending.delete(event.data.id);
      if (event.data.ok) p.resolve(event.data.result);
      else p.reject(new Error(event.data.error ?? "Background task failed"));
    };
    worker.onerror = (event) => {
      for (const p of pending.values()) p.reject(new Error(event.message || "Background task crashed"));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (v) => resolve(v as T), reject });
    worker!.postMessage({ ...payload, id }, transfer);
  });
}

export async function filesFrom(list: File[]): Promise<NamedFile[]> {
  return Promise.all(list.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

export function importExportInBackground(files: NamedFile[], label: string): Promise<ExportImport> {
  return call<ExportImport>({ kind: "export", files, label }, files.map((f) => f.bytes.buffer));
}

export function loadStateInBackground(bytes: Uint8Array): Promise<AppState> {
  return call<AppState>({ kind: "loadState", bytes }, [bytes.buffer]);
}

export function saveStateInBackground(state: AppState): Promise<Uint8Array> {
  return call<Uint8Array>({ kind: "saveState", state });
}
