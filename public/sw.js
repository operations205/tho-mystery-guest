// Minimal PWA service worker — caches the static app shell for offline fallback only.
// API calls (/api/...) always go to the network since they're live data.
//
// Strategy: NETWORK-FIRST for the shell files, falling back to cache only when offline.
// (Previously this was cache-first-with-background-update, which meant every deploy
// required users to hard-refresh (Ctrl+Shift+R) to see the new version — the old cached
// app.js/index.html would keep being served instantly from cache on every normal load,
// and only get silently replaced in the background for the *next* load after that.)
const CACHE_NAME = 'tho-shell-v5';
const SHELL_FILES = ['/', '/styles.css', '/app.js', '/manifest.json', '/vendor/fonts/fonts.css'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // never cache API responses
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
