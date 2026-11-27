import type { AppState, StoredImage } from "./state";

const DB_NAME = "linkedin-network";
const DB_VERSION = 2;
const STATE = "state";
const IMAGES = "images";
const KEY = "current";

type StoreName = typeof STATE | typeof IMAGES;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STATE)) db.createObjectStore(STATE);
      if (!db.objectStoreNames.contains(IMAGES)) db.createObjectStore(IMAGES);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is not available"));
  });
}

function run<T>(name: StoreName, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(name, mode);
        const request = action(tx.objectStore(name));
        tx.oncomplete = () => {
          db.close();
          resolve(request ? request.result : (undefined as T));
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB transaction failed"));
        };
      }),
  );
}

export function loadStoredState(): Promise<unknown> {
  return run(STATE, "readonly", (store) => store.get(KEY));
}

export function saveStoredState(state: AppState): Promise<IDBValidKey> {
  return run(STATE, "readwrite", (store) => store.put(state, KEY));
}

export function clearStoredState(): Promise<void> {
  return Promise.all([run(STATE, "readwrite", (store) => store.delete(KEY)), clearImages()]).then(() => undefined);
}

export function getImageBlob(id: string): Promise<Blob | undefined> {
  return run<unknown>(IMAGES, "readonly", (store) => store.get(id)).then((v) => (v instanceof Blob ? v : undefined));
}

export function putImageBlob(id: string, blob: Blob): Promise<void> {
  return run(IMAGES, "readwrite", (store) => void store.put(blob, id));
}

export function deleteImageBlob(id: string): Promise<void> {
  return run(IMAGES, "readwrite", (store) => void store.delete(id));
}

export function clearImages(): Promise<void> {
  return run(IMAGES, "readwrite", (store) => void store.clear());
}

export async function readImages(ids: string[]): Promise<StoredImage[]> {
  const out: StoredImage[] = [];
  for (const id of ids) {
    const blob = await getImageBlob(id);
    if (blob) out.push({ id, type: blob.type || "image/png", bytes: new Uint8Array(await blob.arrayBuffer()) });
  }
  return out;
}

export function replaceImages(images: StoredImage[]): Promise<void> {
  const blobs = images.map((img) => [img.id, new Blob([img.bytes as Uint8Array<ArrayBuffer>], { type: img.type })] as const);
  return run(IMAGES, "readwrite", (store) => {
    store.clear();
    for (const [id, blob] of blobs) store.put(blob, id);
  });
}
