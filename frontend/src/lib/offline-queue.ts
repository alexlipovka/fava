/**
 * App-side IndexedDB helpers for the offline entry queue.
 * The service worker has its own inline IDB code (same DB, same store).
 */

const DB_NAME = "fava-offline";
const DB_VERSION = 1;
const STORE = "pending_entries";

async function open_db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, {
        keyPath: "id",
        autoIncrement: true,
      });
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error("IDB open failed"));
    };
  });
}

export async function get_pending_count(): Promise<number> {
  const db = await open_db();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error("IDB count failed"));
    };
    tx.oncomplete = () => {
      db.close();
    };
  });
}
