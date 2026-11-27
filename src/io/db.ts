import type { AppState } from "./state";

const DB_NAME = "linkedin-network";
const STORE = "state";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is not available"));
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = action(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("IndexedDB transaction failed"));
        };
      }),
  );
}

export function loadStoredState(): Promise<unknown> {
  return run("readonly", (store) => store.get(KEY));
}

export function saveStoredState(state: AppState): Promise<IDBValidKey> {
  return run("readwrite", (store) => store.put(state, KEY));
}

export function clearStoredState(): Promise<undefined> {
  return run("readwrite", (store) => store.delete(KEY));
}
