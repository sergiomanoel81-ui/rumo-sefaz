const CACHE = "rumo-sefaz-v8";
const CORE = [
  "./",
  "index.html",
  "styles.css?v=8",
  "data.js?v=8",
  "app.js?v=8",
  "vendor/Sortable.min.js?v=8",
  "fonts/fonts.css",
  "fonts/caveat-600.woff2",
  "fonts/nunito.woff2",
  "fonts/patrick-hand-400.woff2",
  "fonts/permanent-marker-400.woff2",
  "questoes/cesgranrio.json?v=8",
  "questoes/leiseca.json?v=8",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("index.html"));
    })
  );
});
