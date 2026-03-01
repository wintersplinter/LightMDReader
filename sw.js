const CACHE_NAME = "lightmdreader-v0-1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// Install: cache core assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)),
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))),
        ),
      ),
  );
  self.clients.claim();
});

// Fetch: cache-first for app shell
self.addEventListener("fetch", (event) => {
  const req = event.request;
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});
