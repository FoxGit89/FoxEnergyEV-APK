const CACHE_NAME = 'calisync-v32';
const ASSETS = [
  './',
  './index.html?v=32',
  './style.css?v=32',
  './app.js?v=32',
  './manifest.json?v=32',
  'https://cdn.jsdelivr.net/npm/chameleon-ultra.js@0/dist/index.global.js',
  'https://cdn.jsdelivr.net/npm/chameleon-ultra.js@0/dist/Crypto1.global.js',
  'https://cdn.jsdelivr.net/npm/chameleon-ultra.js@0/dist/plugin/WebbleAdapter.global.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Always hit network for API
  if (event.request.url.includes('app_api.php')) {
    return;
  }

  // Network-first strategy for static assets to avoid aggressive caching issues
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // Cache the fresh response for later offline use
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // If network fails (offline), fallback to cache
        return caches.match(event.request).then(cachedResponse => {
           return cachedResponse || new Response('Offline');
        });
      })
  );
});