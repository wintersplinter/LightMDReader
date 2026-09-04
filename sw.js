const VERSION = "v4-1-0";
const CACHE_NAME = `lightmdreader-${VERSION}`;
const RUNTIME_CACHE_NAME = `lightmdreader-runtime-${VERSION}`;
const RUNTIME_CACHE_LIMIT = 60;

const ASSETS = [
  "./",
  "./index.html",
  "./config.js",
  "./styles.css",
  "./customMarkdown.css",
  "./customMarkdown.light.css",
  "./customMarkdown.brown.css",
  "./customMarkdown.standard.css",
  "./customMarkdown.studio.css",
  "./customMarkdown.editorial.css",
  "./customMarkdown.refined.css",
  "./customMarkdown.graphite.css",
  "./customMarkdown.print.css",
  "./blockedit.css",
  "./MDrender.js",
  "./app.js",
  "./lib/paths.js",
  "./lib/crypto.js",
  "./lib/blockModel.js",
  "./lib/blockRender.js",
  "./cheatsheet.md",
  "./manifest.webmanifest",
  "./icons/icon-16.png",
  "./icons/icon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./vendor/purify.min.js",
  "./vendor/markdown-it.min.js",
  "./vendor/markdown-it-footnote.min.js",
  "./vendor/markdown-it-deflist.min.js",
  "./vendor/markdown-it-sub.min.js",
  "./vendor/markdown-it-sup.min.js",
  "./vendor/markdown-it-mark.min.js",
  "./vendor/markdown-it-attrs.browser.js",
  "./vendor/markdown-it-task-lists.min.js",
];

// Install: cache core assets.
//
// This deliberately does not call skipWaiting(). An update that activates on
// its own would reload the page and discard whatever is in the editor. The
// page asks for activation via the SKIP_WAITING message once it knows there
// is no unsaved work.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

// Activate: clean caches belonging to previous versions.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.map((key) => (key === CACHE_NAME || key === RUNTIME_CACHE_NAME ? null : caches.delete(key)))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function shouldUseNetworkFirst(request) {
  const url = new URL(request.url);

  if (request.mode === "navigate") return true;
  if (url.origin !== self.location.origin) return false;

  return ["document", "script", "style", "worker", "manifest"].includes(request.destination);
}

// Keep the runtime cache from growing without bound. Entries are evicted in
// insertion order, which is a good enough approximation of least-recently-added
// for the handful of same-origin extras this app fetches.
async function trimRuntimeCache(cache) {
  const keys = await cache.keys();

  if (keys.length <= RUNTIME_CACHE_LIMIT) return;

  await Promise.all(keys.slice(0, keys.length - RUNTIME_CACHE_LIMIT).map((key) => cache.delete(key)));
}

async function fetchAndCache(request) {
  const response = await fetch(request);

  if (!response.ok || new URL(request.url).origin !== self.location.origin) {
    return response;
  }

  const isCoreAsset = await caches.open(CACHE_NAME).then((cache) => cache.match(request));
  const cache = await caches.open(isCoreAsset ? CACHE_NAME : RUNTIME_CACHE_NAME);

  await cache.put(request, response.clone());

  if (!isCoreAsset) {
    await trimRuntimeCache(cache);
  }

  return response;
}

// Fetch fresh UI files first; fall back to cache when offline.
self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  if (shouldUseNetworkFirst(req)) {
    event.respondWith(fetchAndCache(req).catch(() => caches.match(req)));
    return;
  }

  event.respondWith(caches.match(req).then((cached) => cached || fetchAndCache(req)));
});
