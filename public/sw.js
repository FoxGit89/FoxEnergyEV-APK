const CACHE_NAME = 'foxsync-v76';
const ASSETS = [
  './',
  './index.html?v=76',
  './style.css?v=76',
  './app.js?v=76',
  './manifest.json?v=76',
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

// ── WEB PUSH: ricevi notifiche dal server ──
self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch(e) { data = { title: 'FoxSync', body: event.data.text() }; }

  const title   = data.title || 'FoxSync';
  const options = {
    body:    data.body  || '',
    icon:    './manifest.json',
    badge:   './manifest.json',
    tag:     data.tag   || 'foxsync',
    data:    { url: data.url || './' },
    vibrate: [100, 50, 100],
    actions: data.url ? [{ action: 'open', title: '📖 Apri' }] : [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tap sulla notifica → apri/porta in primo piano l'app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes('foxsync.cards') && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', event => {
  // Non cachare: API PHP e richieste POST (es. Overpass)
  if (event.request.url.includes('app_api.php') || event.request.method === 'POST') {
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