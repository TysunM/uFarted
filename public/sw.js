// App-shell cache so the app opens offline. API calls and audio always go to the network.
const CACHE = 'ufarted-shell-v4';
const SHELL = ['/', '/css/app.css', '/js/app.js', '/js/ui.js', '/js/api.js', '/js/state.js', '/js/catalog.js', '/js/age.js', '/js/logsheet.js',
  '/js/recorder.js', '/js/player.js', '/js/typepicker.js', '/js/sounds-version.js', '/js/share.js', '/js/views/today.js', '/js/views/insights.js', '/js/views/community.js',
  '/js/views/me.js', '/icons/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const key = e.request.mode === 'navigate' && url.pathname === '/' ? '/' : e.request;
  // Network-first (cheap 304s thanks to ETags) so deploys show up immediately; cache is the offline fallback.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(e.request);
      if (res.status === 200 && res.type === 'basic') cache.put(key, res.clone()); // never cache partial (206) audio
      return res;
    } catch {
      return (await cache.match(key)) || (e.request.mode === 'navigate' ? cache.match('/') : Response.error());
    }
  })());
});
