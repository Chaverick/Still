const SHELL_CACHE = 'still-shell-v8';
const MODEL_CACHE = 'still-models-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

const MODEL_ASSETS = [
  './models/face_landmarker.task',
  './models/hand_landmarker.task',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shellCache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(
        SHELL_ASSETS.map((url) => shellCache.add(new Request(url, { cache: 'reload' })))
      );

      // Warm-cache MediaPipe .task models in background without blocking activation if offline
      const modelCache = await caches.open(MODEL_CACHE);
      await Promise.allSettled(
        MODEL_ASSETS.map(async (url) => {
          const existing = await modelCache.match(url);
          if (!existing) {
            await modelCache.add(url);
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== MODEL_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // 1. MediaPipe models & WASM: Cache-First (zero network after first load)
  if (
    isSameOrigin &&
    (url.pathname.includes('/models/') || url.pathname.includes('/wasm/'))
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MODEL_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      })()
    );
    return;
  }

  // 2. Google Fonts: Cache-First with background refresh
  if (
    url.origin === 'https://fonts.googleapis.com' ||
    url.origin === 'https://fonts.gstatic.com'
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) {
              cache.put(request, res.clone());
            }
            return res;
          })
          .catch(() => null);
        return cached || (await networkPromise) || Response.error();
      })()
    );
    return;
  }

  if (!isSameOrigin) return;

  // 3. Navigation requests: Network-First with offline shell fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            cache.put('./index.html', response.clone());
          }
          return response;
        } catch {
          return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
        }
      })()
    );
    return;
  }

  // 4. Same-origin app assets: Stale-While-Revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request);
      const networkPromise = fetch(request)
        .then((res) => {
          if (res && res.ok) {
            cache.put(request, res.clone());
          }
          return res;
        })
        .catch(() => null);
      return cached || (await networkPromise) || Response.error();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
