const CACHE_VERSION = 'v3';
const CACHE_SHELL = `lan-messenger-shell-${CACHE_VERSION}`;
const CACHE_STATIC = `lan-messenger-static-${CACHE_VERSION}`;

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
  '/icons/arrow-left.svg',
  '/icons/attachment.svg',
  '/icons/bell-off-outline.svg',
  '/icons/camera-outline.svg',
  '/icons/chevron-down.svg',
  '/icons/close.svg',
  '/icons/delete-forever-outline.svg',
  '/icons/delete-outline.svg',
  '/icons/dots-vertical.svg',
  '/icons/emoticon-happy-outline.svg',
  '/icons/image-multiple-outline.svg',
  '/icons/magnify.svg',
  '/icons/message-plus-outline.svg',
  '/icons/microphone-outline.svg',
  '/icons/pencil-outline.svg',
  '/icons/phone-in-talk.svg',
  '/icons/phone.svg',
  '/icons/pin-outline.svg',
  '/icons/pin.svg',
  '/icons/record-circle-outline.svg',
  '/icons/reply-outline.svg',
  '/icons/send.svg',
  '/icons/stop.svg',
  '/icons/theme-light-dark.svg',
  '/icons/timer-outline.svg',
];

function isSameOrigin(url) {
  return new URL(url).origin === self.location.origin;
}

function isStaticAsset(request) {
  return request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font' ||
    request.destination === 'image' ||
    request.url.includes('/icons/') ||
    request.url.includes('/assets/');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('lan-messenger-') && key !== CACHE_SHELL && key !== CACHE_STATIC)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !isSameOrigin(req.url)) return;

  // Keep API and websocket traffic network-first so server remains source of truth.
  if (req.url.includes('/api/') || req.url.includes('/ws')) {
    event.respondWith(fetch(req));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_SHELL).then((cache) => cache.put('/index.html', clone));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  if (isStaticAsset(req)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkFetch = fetch(req)
          .then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(CACHE_STATIC).then((cache) => cache.put(req, clone));
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
  );
});
