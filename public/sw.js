const CACHE_NAME = 'calisync-v19';
const ASSETS = [
  './',
  './index.html?v=19',
  './style.css?v=19',
  './app.js?v=19',
  './manifest.json?v=19',
  'https://cdn.jsdelivr.net/npm/chameleon-ultra.js@0/dist/index.global.js',
  'https://cdn.jsdelivr.net/npm/chameleon-ultra.js@0/dist/Crypto1.global.js',
  'https://cdn.jsdelivr.net/npm/chameleon-ultra.js@0/dist/plugin/WebbleAdapter.global.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()) // prendi controllo subito senza aspettare reload
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim()) // ← FIX: prendi controllo di tutte le tab aperte
  );
});

self.addEventListener('fetch', event => {
  // Sempre rete per le API — mai cache
  if (event.request.url.includes('app_api.php')) return;

  // Network-first: prova rete, fallback su cache
  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        return caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() =>
        caches.match(event.request).then(r => r || new Response('Offline'))
      )
  );
});