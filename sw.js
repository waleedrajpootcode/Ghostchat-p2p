self.addEventListener('install', (e) => {
  console.log('GhostChat Service Worker Installed');
  self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  // Let the browser handle standard fetch
  e.respondWith(fetch(e.request).catch(() => new Response('Offline')));
});