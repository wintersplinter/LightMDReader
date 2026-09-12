const VERSION = "v4-11-1";
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
  "./customMarkdown.signature.css",
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
  // Temml is small enough to belong with the app; Mermaid is not, and is
  // deliberately absent from this list. It is fetched only when a document
  // contains a diagram and then kept by the runtime cache, so an install
  // never pays 3 MB for a feature most documents do not use.
  "./vendor/temml.min.js",
  "./vendor/Temml-Local.css",
  "./vendor/Temml.woff2",
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
//
// `cache: "reload"` is load-bearing, not decoration. cache.addAll() fetches
// through the browser's ordinary HTTP cache, so a new worker version could
// dutifully build a new cache out of the *old* files the HTTP cache still
// held - a phone that had seen the previous release would install the update
// and go on showing the previous app, with nothing anywhere reporting a
// failure. "reload" forces every precache fetch to the network and lets the
// response refresh the HTTP cache on its way past.
self.addEventListener("install", (event) => {
  event.waitUntil(precacheAssets());
});

/* One missing file used to cost the whole update.
 *
 * cache.addAll() is all-or-nothing: if a single entry in ASSETS answers 404,
 * it rejects, the install fails, and the *previous* worker stays active and
 * keeps serving the previous app - forever, and with nothing on screen to say
 * so. A file renamed or left out of a deploy therefore does not look like a
 * broken file, it looks like an app that refuses to update.
 *
 * Each asset is fetched on its own now. A missing one is reported and skipped;
 * the update still lands, and anything skipped is picked up by the runtime
 * cache the first time the page asks for it. */
async function precacheAssets() {
  const cache = await caches.open(CACHE_NAME);

  const results = await Promise.allSettled(
    ASSETS.map((asset) => cache.add(new Request(asset, { cache: "reload" }))),
  );

  const missing = ASSETS.filter((_, i) => results[i].status === "rejected");

  if (missing.length) {
    console.warn(`[sw ${VERSION}] not precached: ${missing.join(", ")}`);
  }
}

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
//
// Vendored library code is exempt. Mermaid arrives here rather than in the
// precache because it is too large to load eagerly, but it is still part of
// the app: evicting a chunk would leave diagrams broken offline, with nothing
// to refetch from. Only genuine extras are subject to the limit.
function isEvictable(request) {
  return !new URL(request.url).pathname.includes("/vendor/");
}

async function trimRuntimeCache(cache) {
  const keys = await cache.keys();
  const evictable = keys.filter(isEvictable);

  if (evictable.length <= RUNTIME_CACHE_LIMIT) return;

  await Promise.all(evictable.slice(0, evictable.length - RUNTIME_CACHE_LIMIT).map((key) => cache.delete(key)));
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
