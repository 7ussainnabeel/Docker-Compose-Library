const CACHE = "prepper-shell-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/voip.html",
  "/mesh.html",
  "/ai/",
  "/ai/index.html"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request)
        .then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
          return resp;
        })
        .catch(() => caches.match("/index.html"));
    })
  );
});
