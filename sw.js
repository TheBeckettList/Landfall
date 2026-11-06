// Caches the app itself so it opens with no internet. Photos live in IndexedDB.
const VERSION = 'landfall-v4';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/geo.js', 'js/map.js', 'js/sync.js', 'js/viewer.js', 'js/progress.js', 'js/config.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // API + photo downloads go straight to network
  // Cache first (works offline), refresh in the background when online.
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || new Response('Offline', { status: 503 });
    })
  );
});
