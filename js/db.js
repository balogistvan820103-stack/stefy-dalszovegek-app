// Vékony IndexedDB-réteg. Minden adat helyben, a böngésző tárolójában marad.

export const DB_VERSION = 1;
export const STORES = ['songs', 'tags', 'setlists', 'settings', 'media', 'snapshots'];
const KEYS = { songs: 'id', tags: 'id', setlists: 'id', settings: 'key', media: 'key', snapshots: 'id' };

export function openDB(name) {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('Ez a böngésző nem támogatja a helyi adattárolást (IndexedDB).'));
      return;
    }
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: KEYS[s] });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Az adatbázis megnyitása nem sikerült.'));
    req.onblocked = () => reject(new Error('Az adatbázist egy másik megnyitott lap zárolja. Zárd be a többi lapot.'));
  });
}

/**
 * Tranzakció futtatása. A fn(stores) szinkron módon ütemezi a műveleteket;
 * a Promise csak akkor teljesül, ha a teljes tranzakció sikeresen lezárult
 * (hiba esetén minden változás visszavonódik).
 */
export function tx(db, storeNames, mode, fn) {
  return new Promise((resolve, reject) => {
    let t;
    try {
      t = db.transaction(storeNames, mode);
    } catch (e) { reject(e); return; }
    const stores = {};
    for (const n of [].concat(storeNames)) stores[n] = t.objectStore(n);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || new Error('Adatbázis-hiba.'));
    t.onabort = () => reject(t.error || new Error('A művelet megszakadt, az adatok nem változtak.'));
    try {
      result = fn(stores, t);
    } catch (e) {
      try { t.abort(); } catch { /* már lezárult */ }
      reject(e);
    }
  });
}

export function getAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export function getOne(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function deleteDB(name) {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
