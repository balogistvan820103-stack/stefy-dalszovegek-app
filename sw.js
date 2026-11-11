// Service worker: az alkalmazás teljes kerete előre gyorsítótárazva, így internet nélkül is indul.
// Új verzió kiadásakor a CACHE nevét növelni kell.

// Egyedi előtag: ugyanazon a github.io címen futhat a régi STEFY-BAND alkalmazás is
// (az ő gyorsítótára „stefy-dalszovegek-v…” nevű) – azt soha nem töröljük.
const PREFIX = 'stefy-dalszovegek-app-';
const CACHE = `${PREFIX}v1.4.1`;
// A szövegfelismerő (kb. 17 MB) külön tárolóban van, hogy alkalmazásfrissítéskor ne kelljen újra letölteni.
// Csak akkor kell átnevezni, ha a vendor/tesseract mappa tartalma változik.
const OCR_CACHE = `${PREFIX}ocr-tesseract-5.1.1-hun-best`;
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
  './js/ocr.js',
  './js/lyrics.js',
  './js/swipeback.js',
  './js/views/scan.js',
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

const precache = () => caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))));

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE && k !== OCR_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Önjavítás: ha a gyorsítótárat valami más törölte (pl. egy másik alkalmazás
// service workere ugyanazon a címen), online állapotban csendben újraépítjük.
let healing = null;
function heal() {
  if (healing) return;
  healing = caches.has(CACHE)
    .then((ok) => (ok ? null : precache()))
    .catch(() => null)
    .finally(() => { setTimeout(() => { healing = null; }, 60000); });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // külső kérésekhez nem nyúlunk
  if (url.pathname.includes('/tests/')) return; // a tesztek sosem a gyorsítótárból futnak
  heal();

  // Szövegfelismerő fájlok: nagyok és nem változnak – tárolóból, ha megvan; különben letöltés és eltárolás
  if (url.pathname.includes('/vendor/tesseract/')) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          event.waitUntil(caches.open(OCR_CACHE).then((c) => c.put(req, copy)));
        }
        return res;
      })),
    );
    return;
  }

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
