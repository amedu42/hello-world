// SitePulse service worker: makes the app installable and shows an offline page when there's no signal.
// It only caches the app's own code, icons and the offline page — never API data, photos or logins,
// so everything you see is always live.
const CACHE = 'sitepulse-v1';
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Live data, photos and PDFs always go straight to the server.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;

  // Pages: always fetch fresh; if there's no connection show the offline page.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  // Built app files (their names change on every release) and icons: cache after first use.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
  }
});
