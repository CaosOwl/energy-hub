// Offline support.
// App shell: served from cache at once, refreshed in the background, so a new version
//            reaches the phone on the next open without anyone bumping a version number.
// Data:      network first, falling back to the last copy when offline.
const CACHE = "eh-v4";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "assets/icon.svg", "assets/icon-192.png", "assets/fonts/archivo.woff2", "assets/fonts/source-serif.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function refresh(request) {
  const response = await fetch(request);
  if (response.ok) { const cache = await caches.open(CACHE); await cache.put(request, response.clone()); }
  return response;
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/data/")) {
    e.respondWith(refresh(e.request).catch(() => caches.match(e.request, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => {
    const fresh = refresh(e.request);
    if (!hit) return fresh;
    e.waitUntil(fresh.catch(() => {}));
    return hit;
  }));
});
