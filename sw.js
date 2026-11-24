// Offline support.
// Everything is network first: when online you always get the latest deploy on the first open
// (requests bypass the browser's HTTP cache, which GitHub Pages sets to 10 minutes).
// Offline, or if the network is slow, the last saved copy is used.
// Fonts and icons never change, so they come straight from the cache.
const CACHE = "eh-v10";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "energy-tab.js", "manifest.webmanifest",
  "assets/icon.svg", "assets/icon-192.png", "assets/fonts/archivo.woff2", "assets/fonts/source-serif.woff2",
];
const NETWORK_TIMEOUT = 4000;   // ms before falling back to the saved copy

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function fromNetwork(request) {
  const response = await fetch(request, { cache: "no-cache" });
  if (response.ok) { const cache = await caches.open(CACHE); await cache.put(request, response.clone()); }
  return response;
}
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/assets/")) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fromNetwork(e.request)));
    return;
  }
  const net = fromNetwork(e.request);
  e.respondWith(withTimeout(net, NETWORK_TIMEOUT)
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || net)));
  e.waitUntil(net.catch(() => {}));   // still save the fresh copy if it arrives after the timeout
});
