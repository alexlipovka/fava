/// <reference lib="webworker" />
/**
 * Fava service worker — installable PWA with asset caching, offline fallback,
 * and offline entry queuing.
 *
 * Caching strategy:
 *  - Content-addressed assets (hashed filenames): cache-first, kept forever.
 *  - Unhashed static assets (app.js, app.css): network-first, cached for offline.
 *  - Navigation requests: network-first with offline.html fallback.
 *  - PUT /<slug>/api/add_entries: try network; if offline, queue to IndexedDB
 *    and return an optimistic success so the UI stays responsive.
 *  - Other API, partial fetches, OAuth: network-only, never cached.
 *
 * BUILD_HASH is injected by esbuild at build time so each build gets a fresh
 * cache name, automatically evicting stale entries from previous deployments.
 */

declare const self: ServiceWorkerGlobalScope;
declare const BUILD_HASH: string;

// Background Sync types are not in the webworker lib — declare them inline.
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
}
interface SyncManager {
  register(tag: string): Promise<void>;
}

const CACHE = `fava-v${BUILD_HASH}`;

/** Matches hashed static assets that are safe to cache forever. */
const HASHED_ASSET =
  /\/static\/(?:chunk-|bql-|beancount-|web-tree-sitter-|tree-sitter-)[^/]+\.(js|css|wasm|woff2)$/;

const PRECACHE = ["/static/app.js", "/static/app.css", "/offline.html"];

// ---------------------------------------------------------------------------
// IndexedDB queue — shared with the app (same DB name + store name).
// Must stay in sync with frontend/src/lib/offline-queue.ts.
// ---------------------------------------------------------------------------

const IDB_NAME = "fava-offline";
const IDB_VERSION = 1;
const IDB_STORE = "pending_entries";

interface QueuedEntry {
  id: number;
  slug: string;
  entries: unknown[];
  queued_at: string;
  status: "pending" | "failed";
}

async function idb_open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE, {
        keyPath: "id",
        autoIncrement: true,
      });
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error);
    };
  });
}

async function idb_add(slug: string, entries: unknown[]): Promise<void> {
  return idb_open().then(
    async (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).add({
          slug,
          entries,
          queued_at: new Date().toISOString(),
          status: "pending",
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error);
        };
      }),
  );
}

async function idb_get_all(): Promise<QueuedEntry[]> {
  return idb_open().then(
    async (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).getAll();
        req.onsuccess = () => {
          db.close();
          resolve(req.result as QueuedEntry[]);
        };
        req.onerror = () => {
          reject(req.error);
        };
      }),
  );
}

async function idb_remove(id: number): Promise<void> {
  return idb_open().then(
    async (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(id);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          reject(tx.error);
        };
      }),
  );
}

// ---------------------------------------------------------------------------
// Offline entry sync
// ---------------------------------------------------------------------------

async function drain_queue(): Promise<void> {
  const items = await idb_get_all();
  let any_synced = false;
  for (const item of items) {
    try {
      const resp = await fetch(`/${item.slug}/api/add_entries`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: item.entries }),
      });
      if (resp.ok) {
        await idb_remove(item.id);
        any_synced = true;
      }
    } catch {
      // Still offline — leave item in queue.
    }
  }
  if (any_synced) {
    const clients = await self.clients.matchAll();
    for (const c of clients) {
      c.postMessage({ type: "sync-complete" });
    }
  }
}

// ---------------------------------------------------------------------------
// Service worker lifecycle
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => cache.addAll(PRECACHE)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then(async (keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map(async (k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

// Background Sync (Chrome/Android) — fires when connectivity is restored.
self.addEventListener("sync", (event: Event) => {
  const sync = event as SyncEvent;
  if (sync.tag === "fava-sync-entries") {
    sync.waitUntil(drain_queue());
  }
});

// Manual drain triggered by app via postMessage (fallback for browsers without Background Sync).
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | null)?.type === "drain-queue") {
    event.waitUntil(drain_queue());
  }
});

// ---------------------------------------------------------------------------
// Fetch handling
// ---------------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  // Intercept add_entries before the generic API passthrough so we can queue
  // the request when offline instead of dropping it entirely.
  if (request.method === "PUT" && url.pathname.endsWith("/api/add_entries")) {
    event.respondWith(handle_add_entries(request, url));
    return;
  }

  // Never cache: partial page fetches, JSON API, OAuth2 proxy endpoints.
  if (
    url.searchParams.has("partial") ||
    url.pathname.includes("/api/") ||
    url.pathname.startsWith("/oauth2/")
  ) {
    return;
  }

  if (HASHED_ASSET.test(url.pathname)) {
    event.respondWith(cache_first(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(network_first_nav(request));
    return;
  }

  if (url.pathname.startsWith("/static/")) {
    event.respondWith(network_first(request));
  }
});

async function handle_add_entries(
  request: Request,
  url: URL,
): Promise<Response> {
  // Read body before attempting the fetch so we can reuse it in the catch branch.
  const body_text = await request.text();
  try {
    return await fetch(url.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body_text,
    });
  } catch {
    // Network unavailable — queue entry and return an optimistic success.
    const body = JSON.parse(body_text) as { entries: unknown[] };
    // URL pattern: /<slug>/api/add_entries → slug is the first path segment.
    const slug = url.pathname.split("/")[1] ?? "";
    await idb_add(slug, body.entries);
    try {
      const sync = (self.registration as unknown as { sync: SyncManager }).sync;
      await sync.register("fava-sync-entries");
    } catch {
      // Background Sync not supported in this browser.
    }
    return new Response(
      JSON.stringify({ data: "__offline_queued__", mtime: null }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
}

async function cache_first(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  const cache = await caches.open(CACHE);
  cache.put(request, response.clone());
  return response;
}

async function network_first(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
    return response;
  } catch {
    return (await caches.match(request)) ?? Response.error();
  }
}

async function network_first_nav(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match("/offline.html")) ?? Response.error();
  }
}
