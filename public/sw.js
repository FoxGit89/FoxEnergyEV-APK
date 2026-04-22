const CACHE_NAME = 'calisync-v4';
const ASSETS = [
  './',
  './index.html?v=4',
  './style.css?v=4',
  './app.js?v=4',
  './manifest.json?v=4',
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
    })
  );
});

self.addEventListener('fetch', event => {
  // Pass through API requests directly to network, no cache
  if (event.request.url.includes('app_api.php')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
      .catch(() => {
        // Fallback for offline if needed
        return new Response('Offline');
      })
  );
});
