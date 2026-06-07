const CACHE_NAME = "lightmdreader-v0-12";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./customMarkdown.css",
  "./customMarkdown.light.css",
  "./customMarkdown.brown.css",
  "./MDrender.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// Install: cache core assets
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))),
  );
  self.clients.claim();
});

function shouldUseNetworkFirst(request) {
  const url = new URL(request.url);

  if (request.mode === "navigate") return true;
  if (url.origin !== self.location.origin) return false;

  return ["document", "script", "style", "worker", "manifest"].includes(request.destination);
}

async function fetchAndCache(request) {
  const response = await fetch(request);

  if (response.ok && new URL(request.url).origin === self.location.origin) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
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
