const CACHE_NAME = 'calisync-v21';
const ASSETS = [
  './',
  './index.html?v=21',
  './style.css?v=21',
  './app.js?v=21',
  './manifest.json?v=21',
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
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('app_api.php')) return;
  event.respondWith(
    fetch(event.request)
      .then(res => caches.open(CACHE_NAME).then(cache => { cache.put(event.request, res.clone()); return res; }))
      .catch(() => caches.match(event.request).then(r => r || new Response('Offline')))
  );
});