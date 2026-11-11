// Gyors visszamenőleges ellenőrzés a FUTÓ alkalmazásban (csak a tesztkörnyezetben használd!).
// Használat a böngésző konzoljából:  (await import('/tests/smoke.js')).runSmoke()
// Ellenőrzi: pedál (billentyűs lapozás fellépés módban), képernyő ébren tartása, keresés,
// mentés (export), refrénkiemelés. Szükség esetén két próbadalt és egy próbalistát vesz fel.

const w = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await w(50); }
  return null;
}

export async function runSmoke() {
  const store = await import('../js/store.js');
  const backup = await import('../js/backup.js');
  const wake = await import('../js/wakelock.js');
  const { lyricsHTML } = await import('../js/components.js');
  const res = {};

  // próbaadatok (csak ha még nincsenek)
  const need = ['Smoke próbadal egy', 'Smoke próbadal kettő'];
  const ids = [];
  for (const t of need) {
    const ex = [...store.state.songs.values()].find((s) => s.title === t);
    ids.push((ex || await store.saveSong({ title: t, lyrics: `${t} első sora\nR: pedálpróba refrén\nhajnalig szól\n\nzárósor kakukktojás` })).id);
  }
  let list = [...store.state.setlists.values()].find((l) => l.name === 'Smoke lista');
  if (!list) list = await store.createSetlist({ name: 'Smoke lista', date: '' });
  await store.updateSetlist(list.id, { songIds: ids });
  // a próbalista ma esti módosításait (vendégkérések) elvetjük, hogy a pedálpróba kiszámítható legyen
  try { await (await import('../js/night.js')).clearTonightOrder(list.id); } catch { /* régebbi verzióban nincs */ }

  // 1) pedál: jobbra/balra nyíl és PageDown a végén
  location.hash = '#/songs'; // ha épp ezen a fellépés-képernyőn állnánk, töltődjön újra
  await w(300);
  location.hash = `#/perform/${list.id}/0`;
  await waitFor(() => document.querySelector('.pf-pos'));
  const pos = () => document.querySelector('.pf-pos')?.textContent;
  const before = pos();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await w(200);
  const afterRight = pos();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await w(200);
  res.pedal = before === '1 / 2' && afterRight === '2 / 2' && pos() === '1 / 2' ? 'OK' : `HIBA (${before} → ${afterRight} → ${pos()})`;

  // 2) ébren tartás (a böngészőpanel nem engedi a valódit, ezért helyettesítővel)
  const had = wake.getStatus().enabled;
  const orig = navigator.wakeLock?.request;
  try {
    Object.defineProperty(navigator.wakeLock, 'request', {
      configurable: true,
      value: async () => { const s = new EventTarget(); s.released = false; s.release = async () => { s.released = true; s.dispatchEvent(new Event('release')); }; return s; },
    });
    const st = await wake.setEnabled(true);
    res.ebrenTartas = st === 'active' ? 'OK' : `HIBA (${st})`;
  } finally {
    await wake.setEnabled(had);
    if (orig) Object.defineProperty(navigator.wakeLock, 'request', { configurable: true, value: orig });
    else delete navigator.wakeLock.request;
  }

  // 3) keresés: ékezet nélkül, szövegrészletre
  const hits = store.querySongs({ query: 'kakukktojas' }).map((x) => x.song.title);
  res.kereses = need.every((t) => hits.includes(t)) ? 'OK' : `HIBA (${hits.join(', ')})`;

  // 4) mentés: a teljes export minden dalt és listát tartalmaz
  const ex = await backup.buildExport({ includeMedia: false });
  res.mentes = ex.songs.length === store.state.songs.size && ex.setlists.length === store.state.setlists.size && ex.settings?.reader ? 'OK' : 'HIBA';

  // 5) refrénkiemelés
  const box = document.createElement('div');
  box.innerHTML = lyricsHTML('Vers\nR: Szól a nóta\nhajnalig\n\nRózsa nyílik', true);
  res.refren = box.querySelectorAll('.lyr-ref').length === 1 && !box.querySelector('.lyr-ref').textContent.includes('Rózsa') ? 'OK' : 'HIBA';
  const shown = document.querySelector('.pf-lyrics .lyr-ref');
  res.refrenFellepesben = shown ? 'OK' : 'HIBA';

  location.hash = '#/songs';
  await w(300);
  res.osszesen = Object.values(res).every((v) => v === 'OK') ? 'MIND RENDBEN' : 'VAN HIBA';
  return res;
}
