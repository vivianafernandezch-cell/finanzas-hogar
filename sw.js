// Service worker: la app abre sin internet (los DATOS viven en IndexedDB, no aquí).
// Al publicar una versión nueva, sube el número de VERSION.
const VERSION = 'fh-v1.0.1';
const SHELL = [
  './', 'index.html', 'styles.css', 'config.js', 'manifest.webmanifest',
  'vendor/preact-htm.js', 'vendor/supabase.js', 'vendor/xlsx.full.min.js',
  'src/app.js', 'src/store.js', 'src/db.js', 'src/sync.js', 'src/cloud.js',
  'src/logic/util.js', 'src/logic/stats.js', 'src/logic/importer.js', 'src/logic/recurring.js',
  'src/logic/insights.js', 'src/logic/seed.js', 'src/logic/fx.js',
  'src/ui/common.js', 'src/ui/add.js', 'src/ui/home.js', 'src/ui/history.js', 'src/ui/stats.js',
  'src/ui/manage.js', 'src/ui/dataio.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;   // Supabase / tipo de cambio: siempre red
  // Red primero (para recibir actualizaciones), caché si no hay internet
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
