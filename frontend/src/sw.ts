/// <reference lib="webworker" />
/**
 * Fava service worker — installable PWA with asset caching and offline fallback.
 *
 * Caching strategy:
 *  - Content-addressed assets (hashed filenames): cache-first, kept forever.
 *  - Unhashed static assets (app.js, app.css): network-first, cached for offline.
 *  - Navigation requests: network-first with offline.html fallback.
 *  - Partial fetches (?partial=), API and OAuth endpoints: network-only, never cached.
 *
 * BUILD_HASH is injected by esbuild at build time so each build gets a fresh
 * cache name, automatically evicting stale entries from previous deployments.
 */

declare const self: ServiceWorkerGlobalScope;
declare const BUILD_HASH: string;

const CACHE = `fava-v${BUILD_HASH}`;

/** Matches hashed static assets that are safe to cache forever. */
const HASHED_ASSET =
  /\/static\/(?:chunk-|bql-|beancount-|web-tree-sitter-|tree-sitter-)[^/]+\.(js|css|wasm|woff2)$/;

const PRECACHE = ["/static/app.js", "/static/app.css", "/offline.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // Never cache: partial page fetches, JSON API, OAuth2 proxy endpoints.
  if (
    url.searchParams.has("partial") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/oauth2/")
  ) {
    return;
  }

  if (HASHED_ASSET.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNav(request));
    return;
  }

  if (url.pathname.startsWith("/static/")) {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  const cache = await caches.open(CACHE);
  cache.put(request, response.clone());
  return response;
}

async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
    return response;
  } catch {
    return (await caches.match(request)) ?? Response.error();
  }
}

async function networkFirstNav(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match("/offline.html")) ?? Response.error();
  }
}
