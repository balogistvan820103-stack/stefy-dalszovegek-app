// Service worker: az alkalmazás teljes kerete előre gyorsítótárazva, így internet nélkül is indul.
// Új verzió kiadásakor a CACHE nevét növelni kell.

const CACHE = 'stefy-dalszovegek-v1.2.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/util.js',
  './js/icons.js',
  './js/db.js',
  './js/store.js',
  './js/backup.js',
  './js/dnd.js',
  './js/wakelock.js',
  './js/components.js',
  './js/txtimport.js',
  './js/docread.js',
  './js/views/home.js',
  './js/views/songs.js',
  './js/views/reader.js',
  './js/views/setlists.js',
  './js/views/perform.js',
  './js/views/settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('stefy-dalszovegek-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // külső kérésekhez nem nyúlunk
  if (url.pathname.includes('/tests/')) return; // a tesztek sosem a gyorsítótárból futnak

  // Navigáció: mindig az előre mentett index.html (offline is), háttérben frissítve
  const scopePath = new URL(self.registration.scope).pathname;
  const isAppPage = url.pathname === scopePath || url.pathname === `${scopePath}index.html`;
  if (req.mode === 'navigate' && !isAppPage) return; // pl. a tesztoldal: mindig hálózatról
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        const net = fetch(req).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put('./index.html', res.clone()));
          return res;
        }).catch(() => cached);
        return cached || net;
      }),
    );
    return;
  }

  // Statikus fájlok: gyorsítótár először, a háttérben frissítés (stale-while-revalidate)
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => cached || Response.error());
      return cached || net;
    }),
  );
});
