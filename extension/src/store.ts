import type { CollectedConnection, CollectedMessage, CollectedPost, JobStatus, PostsJob } from "./protocol";

const DB_NAME = "linkedin-network-sync";
const STORES = { connections: "connections", messages: "messages", posts: "posts", meta: "meta" } as const;
type Part = "connections" | "messages" | "posts";
type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const d = request.result;
      if (!d.objectStoreNames.contains(STORES.connections)) d.createObjectStore(STORES.connections, { keyPath: "slug" });
      if (!d.objectStoreNames.contains(STORES.messages)) d.createObjectStore(STORES.messages, { keyPath: "id" });
      if (!d.objectStoreNames.contains(STORES.posts)) d.createObjectStore(STORES.posts, { keyPath: "id" });
      if (!d.objectStoreNames.contains(STORES.meta)) d.createObjectStore(STORES.meta);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("IndexedDB unavailable"));
    };
  });
  return dbPromise;
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const request = action(t.objectStore(store));
    t.oncomplete = () => resolve(request ? request.result : undefined);
    t.onerror = t.onabort = () => reject(t.error ?? new Error("IndexedDB transaction failed"));
  });
}

export function putConnections(items: CollectedConnection[]): Promise<unknown> {
  return tx(STORES.connections, "readwrite", (s) => {
    for (const item of items) s.put(item);
  });
}

export function putMessages(items: CollectedMessage[]): Promise<unknown> {
  return tx(STORES.messages, "readwrite", (s) => {
    for (const item of items) s.put(item);
  });
}

export function putPosts(items: CollectedPost[]): Promise<unknown> {
  return tx(STORES.posts, "readwrite", (s) => {
    for (const item of items) s.put(item);
  });
}

export function clearPosts(): Promise<unknown> {
  return tx(STORES.posts, "readwrite", (s) => s.clear());
}

export async function count(store: Part): Promise<number> {
  return (await tx(store, "readonly", (s) => s.count())) ?? 0;
}

export async function page<T>(store: Part, offset: number, limit: number): Promise<T[]> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const out: T[] = [];
    const t = d.transaction(store, "readonly");
    const request = t.objectStore(store).openCursor();
    let skipped = offset === 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (!skipped) {
        skipped = true;
        cursor.advance(offset);
        return;
      }
      out.push(cursor.value as T);
      if (out.length < limit) cursor.continue();
    };
    t.oncomplete = () => resolve(out);
    t.onerror = t.onabort = () => reject(t.error ?? new Error("IndexedDB read failed"));
  });
}

export function clearCollected(): Promise<unknown> {
  return Promise.all([
    tx(STORES.connections, "readwrite", (s) => s.clear()),
    tx(STORES.messages, "readwrite", (s) => s.clear()),
  ]);
}

export async function loadJob(): Promise<JobStatus | null> {
  return ((await tx(STORES.meta, "readonly", (s) => s.get("job"))) as JobStatus | undefined) ?? null;
}

export function saveJob(job: JobStatus): Promise<unknown> {
  return tx(STORES.meta, "readwrite", (s) => s.put(job, "job"));
}

export async function loadPostsJob(): Promise<PostsJob | null> {
  return ((await tx(STORES.meta, "readonly", (s) => s.get("postsJob"))) as PostsJob | undefined) ?? null;
}

export function savePostsJob(job: PostsJob): Promise<unknown> {
  return tx(STORES.meta, "readwrite", (s) => s.put(job, "postsJob"));
}
