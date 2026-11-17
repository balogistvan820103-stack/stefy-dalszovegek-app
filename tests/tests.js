// Automatikus tesztek az adatréteghez – ideiglenes, külön teszt-adatbázisban.

import * as store from '../js/store.js';
import * as backup from '../js/backup.js';
import { deleteDB } from '../js/db.js';

const DB = `stefy-dalszovegek-TESZT-${Date.now()}`;
const out = document.getElementById('out');
const results = [];

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} – várt: ${JSON.stringify(b)}, kapott: ${JSON.stringify(a)}`); }

async function test(name, fn) {
  const li = document.createElement('li');
  try { await fn(); li.className = 'ok'; li.textContent = `✔ ${name}`; results.push(true); }
  catch (e) { li.className = 'fail'; li.textContent = `✘ ${name}: ${e.message}`; results.push(false); console.error(name, e); }
  out.appendChild(li);
}

const titles = (arr) => arr.map((x) => x.song.title);

await store.init(DB);

let a; let b; let c; let rock; let lassu;

await test('Dal felvétele, alapértékek, időbélyegek', async () => {
  a = await store.saveSong({ title: '  Csillagok  ', artist: 'Teszt Együttes', lyrics: '[Refrén]\r\nSzáll a dal, száll az ének\r\n' });
  assert(a.id && a.createdAt && a.updatedAt, 'hiányzó azonosító/idő');
  eq(a.title, 'Csillagok', 'cím tisztítása');
  eq(a.lyrics, '[Refrén]\nSzáll a dal, száll az ének', 'sorvégek egységesítése');
  eq(a.favorite, false, 'kedvenc alapértéke');
  await new Promise((r) => setTimeout(r, 5));
  b = await store.saveSong({ title: 'Álmodj velem', lyrics: 'Éjjel a csillagos ég alatt' });
  await new Promise((r) => setTimeout(r, 5));
  c = await store.saveSong({ title: 'Balaton nyár', artist: 'Valaki', lyrics: 'Hullámok' });
});

await test('Dal szerkesztése és újratöltés utáni megmaradása', async () => {
  const before = store.getSong(a.id).updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  await store.saveSong({ ...store.getSong(a.id), lyrics: 'Új szöveg\nmásodik sor' });
  await store.reload();
  eq(store.getSong(a.id).lyrics, 'Új szöveg\nmásodik sor', 'módosított szöveg');
  assert(store.getSong(a.id).updatedAt > before, 'módosítás ideje frissül');
});

await test('Címkék: létrehozás, duplikátum-védelem, hozzárendelés, átnevezés', async () => {
  rock = await store.createTag('Rock');
  lassu = await store.createTag('Lassú');
  const again = await store.createTag('rock');
  eq(again.id, rock.id, 'azonos nevű címke ne jöjjön létre újra');
  await store.saveSong({ ...store.getSong(a.id), tagIds: [rock.id, lassu.id] });
  await store.saveSong({ ...store.getSong(c.id), tagIds: [rock.id] });
  eq(store.tagCount(rock.id), 2, 'rock címke darabszám');
  await store.updateTag(rock.id, { name: 'Rock & Roll' });
  let threw = false;
  try { await store.updateTag(lassu.id, { name: 'rock & roll' }); } catch { threw = true; }
  assert(threw, 'ütköző átnevezés hibát dob');
});

await test('Keresés címben, előadóban, címkében, szövegben – ékezet nélkül is', async () => {
  eq(titles(store.querySongs({ query: 'almodj' })), ['Álmodj velem'], 'cím ékezet nélkül');
  eq(titles(store.querySongs({ query: 'teszt egyuttes' })), ['Csillagok'], 'előadó');
  eq(titles(store.querySongs({ query: 'roll' })).sort(), ['Balaton nyár', 'Csillagok'], 'átnevezett címke');
  const r = store.querySongs({ query: 'csillagos' });
  eq(titles(r), ['Álmodj velem'], 'teljes szöveg');
  eq(r[0].match, 'lyrics', 'találat helye: szöveg');
  eq(titles(store.querySongs({ query: 'csillag' })), ['Csillagok', 'Álmodj velem'], 'címtalálat előrébb');
  eq(store.querySongs({ query: 'nincsilyen' }).length, 0, 'nincs találat');
});

await test('Rendezés: ABC, hozzáadás ideje, kedvencek elöl, legutóbb használt', async () => {
  eq(titles(store.querySongs({ sort: 'title' })), ['Álmodj velem', 'Balaton nyár', 'Csillagok'], 'magyar ABC');
  eq(titles(store.querySongs({ sort: 'added' })), ['Balaton nyár', 'Álmodj velem', 'Csillagok'], 'legújabb elöl');
  await store.toggleFavorite(c.id);
  eq(titles(store.querySongs({ sort: 'favorites' }))[0], 'Balaton nyár', 'kedvenc elöl');
  eq(titles(store.querySongs({ tab: 'favorites' })), ['Balaton nyár'], 'kedvencek fül');
  await store.markOpened(b.id);
  eq(titles(store.querySongs({ sort: 'recent' }))[0], 'Álmodj velem', 'legutóbb használt elöl');
});

await test('Kézi sorrend húzás után, újratöltés után is megmarad (szűrt részhalmaz is)', async () => {
  eq(titles(store.querySongs({ sort: 'manual' })), ['Csillagok', 'Álmodj velem', 'Balaton nyár'], 'kezdeti sorrend = felvétel sorrendje');
  await store.reorderSongs([c.id, a.id, b.id]);
  await store.reload();
  eq(titles(store.querySongs({ sort: 'manual' })), ['Balaton nyár', 'Csillagok', 'Álmodj velem'], 'új sorrend');
  // csak a "Rock & Roll" címkés dalok átrendezése (Balaton, Csillagok) – a többi helye nem változik
  await store.reorderSongs([a.id, c.id]);
  eq(titles(store.querySongs({ sort: 'manual' })), ['Csillagok', 'Balaton nyár', 'Álmodj velem'], 'részhalmaz-átrendezés');
});

await test('Utolsó 20 megnyitott dal', async () => {
  const ids = [];
  for (let i = 0; i < 23; i++) ids.push((await store.saveSong({ title: `Gyors dal ${i}`, lyrics: 'x' })).id);
  for (const id of ids) await store.markOpened(id);
  await store.reload();
  eq(store.state.recent.length, 20, 'legfeljebb 20');
  eq(store.state.recent[0], ids[22], 'legutóbbi elöl');
  eq(store.querySongs({ tab: 'recent' }).length, 20, 'legutóbbi fül');
  for (const id of ids) await store.deleteSong(id);
});

let list;
await test('Fellépés-lista: létrehozás, többdalos hozzáadás, duplikátum kiszűrése, sorrend', async () => {
  list = await store.createSetlist({ name: 'Esküvő', date: '2026-12-31' });
  let r = await store.addSongsToSetlist(list.id, [b.id, a.id]);
  eq(r, { added: 2, skipped: 0 }, 'első hozzáadás');
  r = await store.addSongsToSetlist(list.id, [a.id, c.id, c.id]);
  eq(r, { added: 1, skipped: 2 }, 'duplikátum nem kerül fel');
  eq(store.state.setlists.get(list.id).songIds, [b.id, a.id, c.id], 'új dalok a végére, a sorrend megmarad');
  await store.updateSetlist(list.id, { songIds: [c.id, b.id, a.id] });
  await store.reload();
  eq(store.state.setlists.get(list.id).songIds, [c.id, b.id, a.id], 'húzásos sorrend megmarad újratöltés után');
});

await test('Fellépés-lista duplikálása és eltávolítás', async () => {
  const copy = await store.duplicateSetlist(list.id);
  assert(copy.id !== list.id, 'új azonosító');
  eq(copy.songIds, store.state.setlists.get(list.id).songIds, 'azonos dalok');
  await store.removeFromSetlist(copy.id, b.id);
  eq(store.state.setlists.get(copy.id).songIds, [c.id, a.id], 'eltávolítás');
  eq(store.state.setlists.get(list.id).songIds.length, 3, 'az eredeti nem változik');
  await store.deleteSetlist(copy.id);
});

await test('Címke törlése: a dalok megmaradnak, a címke lekerül róluk', async () => {
  await store.deleteTag(lassu.id);
  assert(!store.getSong(a.id).tagIds.includes(lassu.id), 'címke lekerült');
  assert(store.getSong(a.id), 'dal megmaradt');
});

await test('Beállítások mentése (70 px betű, betűstílus, sortávolság) újratöltés után is', async () => {
  await store.saveSettings('reader', { ...store.settings('reader'), fontSize: 70, fontFamily: 'serif', lineHeight: 1.9 });
  await store.patchSettings('app', { wakeLock: true });
  await store.reload();
  eq(store.settings('reader').fontSize, 70, 'betűméret');
  eq(store.settings('reader').fontFamily, 'serif', 'betűstílus');
  eq(store.settings('reader').lineHeight, 1.9, 'sortávolság');
  eq(store.settings('app').wakeLock, true, 'ébren tartás');
});

await test('Háttérképek külön kulccsal tárolódnak', async () => {
  await store.setMedia('bg-reader', new Blob(['olvaso'], { type: 'image/jpeg' }));
  await store.setMedia('bg-home', new Blob(['kezdo'], { type: 'image/jpeg' }));
  await store.setMedia('bg-reader', new Blob(['olvaso2'], { type: 'image/jpeg' }));
  eq(await (await store.getMedia('bg-home')).blob.text(), 'kezdo', 'a kezdőkép nem változik az olvasó hátterének cseréjekor');
  eq(await (await store.getMedia('bg-reader')).blob.text(), 'olvaso2', 'olvasó háttér cserélődött');
  eq((await store.allMedia()).length, 2, 'mindkét kép listázható');
});

await test('Háttérkép: a régi (Blob) formában mentett kép is betöltődik; az új forma minden böngészőben menthető', async () => {
  const raw = await new Promise((resolve, reject) => {
    const r = store.getDB().transaction('media', 'readonly').objectStore('media').get('bg-home');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  assert(raw.data instanceof ArrayBuffer && !raw.blob, 'az új kép ArrayBuffer-ként tárolódik (Safari-barát)');
  let legacyOk = null;
  try {
    await new Promise((resolve, reject) => {
      const t = store.getDB().transaction('media', 'readwrite');
      t.objectStore('media').put({ key: 'bg-regi-proba', blob: new Blob(['regi'], { type: 'image/png' }), type: 'image/png', size: 4, updatedAt: 1 });
      t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
    });
    legacyOk = true;
  } catch { legacyOk = false; /* ez a böngésző Blob-ot nem is tud menteni – itt régi formátumú kép sem lehet */ }
  if (legacyOk) {
    const m = await store.getMedia('bg-regi-proba');
    eq([await m.blob.text(), m.blob.type], ['regi', 'image/png'], 'régi Blob-os kép olvasható');
    await store.deleteMedia('bg-regi-proba');
  }
  const li = document.createElement('li');
  li.textContent = `ℹ régi (Blob) formátum ebben a böngészőben: ${legacyOk ? 'menthető és olvasható' : 'nem menthető (ezért kell az új forma)'}`;
  out.appendChild(li);
});

let exported;
await test('Teljes export – minden adat benne van', async () => {
  exported = await backup.buildExport({ includeMedia: true });
  eq(exported.app, 'stefy-dalszovegek', 'azonosító');
  eq(exported.songs.length, 3, 'dalok');
  eq(exported.tags.length, 1, 'címkék');
  eq(exported.setlists.length, 1, 'listák');
  eq(exported.settings.reader.fontSize, 70, 'beállítások');
  assert(exported.media['bg-reader'].data.startsWith('data:image/jpeg;base64,'), 'háttérkép');
  assert(exported.songs.some((s) => s.favorite), 'kedvenc');
});

await test('Hibás fájl: érthető hiba, a meglévő adatok nem változnak', async () => {
  const before = JSON.stringify(store.exportData().songs);
  for (const bad of ['nem json {', '{"valami": 1}', '[]', '{"songs": "x"}']) {
    let err = null;
    try { backup.parseBackup(bad); } catch (e) { err = e; }
    assert(err instanceof backup.ImportError, `hibát kell dobnia: ${bad}`);
  }
  eq(JSON.stringify(store.exportData().songs), before, 'adatok változatlanok');
});

await test('Import előnézet (összegzés) helyes', async () => {
  const p = backup.parseBackup(JSON.stringify(exported));
  eq(p.summary.songs, 3, 'dalok száma');
  eq(p.summary.setlists, 1, 'listák');
  eq(p.summary.tags, 1, 'címkék');
  eq(p.summary.favorites, 1, 'kedvencek');
  eq(p.summary.hasSettings, true, 'beállítások');
  eq(p.summary.media.length, 2, 'képek');
});

await test('Import – meglévők megtartása: nem keletkezik duplikátum', async () => {
  const p = backup.parseBackup(JSON.stringify(exported));
  const res = await backup.applyImport(p.data, 'keep');
  eq(res.songsAdded, 0, 'nincs új dal');
  eq(store.state.songs.size, 3, 'dalszám változatlan');
});

await test('Import – hozzáfűzés: új dalok bekerülnek, azonos dalok nem duplázódnak', async () => {
  const extra = JSON.parse(JSON.stringify(exported));
  extra.songs.push({ id: a.id, title: 'Teljesen új dal', lyrics: 'új', tagIds: [] }); // ütköző azonosító, eltérő tartalom
  extra.songs.push({ title: 'Régi formátumú dal', text: 'régi szöveg', tags: ['Népdal'] }); // tűrt régi mezőnevek
  const p = backup.parseBackup(JSON.stringify(extra));
  const res = await backup.applyImport(p.data, 'append');
  eq(res.songsAdded, 2, 'két új dal');
  eq(store.state.songs.size, 5, 'összesen 5 dal');
  assert(store.findTagByName('Népdal'), 'új címke név alapján létrejött');
  eq(store.getSong(a.id).title, 'Csillagok', 'a meglévő dal nem íródott felül');
  const imported = [...store.state.setlists.values()].find((l) => l.name.includes('(importált)'));
  assert(imported && imported.songIds.length === 3, 'importált lista a dalokkal');
});

await test('Pillanatkép készül import előtt, és visszaállítható', async () => {
  const snaps = await store.listSnapshots();
  assert(snaps.length >= 2, 'pillanatképek');
  await backup.restoreSnapshot(snaps[0]); // a hozzáfűzés előtti állapot
  eq(store.state.songs.size, 3, 'visszaállt 3 dalra');
});

await test('Teljes visszaállítás: pontosan a fájl tartalma, sorrendekkel és beállításokkal', async () => {
  await store.saveSong({ title: 'Ez el fog tűnni', lyrics: 'x' });
  await store.saveSettings('reader', { ...store.settings('reader'), fontSize: 20 });
  const p = backup.parseBackup(JSON.stringify(exported));
  await backup.applyImport(p.data, 'replace');
  eq(store.state.songs.size, 3, '3 dal');
  assert(!store.querySongs({ query: 'el fog tunni' }).length, 'a régi dal eltűnt');
  eq(store.settings('reader').fontSize, 70, 'beállítások visszaálltak');
  eq(store.state.setlists.get(list.id).songIds, [c.id, b.id, a.id], 'lista sorrendje');
  eq(titles(store.querySongs({ sort: 'manual' })), ['Csillagok', 'Balaton nyár', 'Álmodj velem'], 'kézi sorrend');
  eq(await (await store.getMedia('bg-home')).blob.text(), 'kezdo', 'kezdőkép visszaállt');
});

await test('Sikertelen tranzakció: semmi sem változik (atomikus import)', async () => {
  const before = store.state.songs.size;
  let failed = false;
  try {
    await store.commitImport({ clearFirst: true, songs: [{ id: 'x1', title: 'A' }, { title: 'kulcs nélkül' }], tags: [], setlists: [] });
  } catch { failed = true; }
  assert(failed, 'a hibás terv hibát dob');
  await store.reload();
  eq(store.state.songs.size, before, 'az adatok érintetlenek');
});

await test('Dal törlése: a fellépés-listákról is lekerül', async () => {
  await store.deleteSong(b.id);
  assert(!store.getSong(b.id), 'törölve');
  assert(!store.state.setlists.get(list.id).songIds.includes(b.id), 'listáról lekerült');
});

await test('TXT-import: fájlnév = cím, almappa = címke, Windows-1250 kódolás, duplikátum kihagyása', async () => {
  const mk = (name, content, path, bytes) => {
    const f = new File([bytes || content], name, { type: 'text/plain' });
    if (path) Object.defineProperty(f, 'webkitRelativePath', { value: path });
    return f;
  };
  // "Árvíztűrő" Windows-1250 bájtokkal: Á=0xC1 r v í=0xED z t ű=0xFB r ő=0xF5
  const cp1250 = new Uint8Array([0xc1, 0x72, 0x76, 0xed, 0x7a, 0x74, 0xfb, 0x72, 0xf5, 0x0d, 0x0a, 0x6d, 0xe1, 0x73, 0x6f, 0x64, 0x69, 0x6b]);
  const files = [
    mk('Zöld_ablakos_kicsi_ház.txt', 'Zöld ablakos kicsi ház\nelső sor\nmásodik sor', 'Dalok/Csárdás/Zöld_ablakos_kicsi_ház.txt'),
    mk('Régi kódolás.txt', '', 'Dalok/Mulatós/Régi kódolás.txt', cp1250),
    mk('Csillagok.txt', 'Új szöveg\nmásodik sor', 'Dalok/Csillagok.txt'), // már meglévő dal tartalma
    mk('kep.jpg', 'x', 'Dalok/kep.jpg'),
  ];
  const { readTxtFiles, applyTxtImport } = await import('../js/txtimport.js');
  const res = await readTxtFiles(files);
  eq(res.summary.txt, 3, 'TXT-fájlok');
  eq(res.skippedFiles.length, 1, 'nem TXT kimarad');
  const z = res.data.songs.find((s) => s.title === 'Zöld ablakos kicsi ház');
  assert(z, 'cím a fájlnévből (aláhúzás → szóköz)');
  eq(z.lyrics, 'első sor\nmásodik sor', 'az első sorban ismételt cím nem duplázódik');
  const r = res.data.songs.find((s) => s.title === 'Régi kódolás');
  eq(r.lyrics, 'Árvíztűrő\nmásodik', 'Windows-1250 helyes dekódolása');
  eq(res.summary.tagNames.sort(), ['Csárdás', 'Mulatós'], 'almappák → címkék');
  const before = store.state.songs.size;
  const out = await applyTxtImport(res.data);
  eq(out.songsAdded, 2, 'két új dal');
  eq(out.songsSkipped, 1, 'a meglévő dal kimaradt');
  eq(store.state.songs.size, before + 2, 'dalszám');
  eq(store.querySongs({ query: 'csardas' }).length, 1, 'címke kereshető');
});

await test('Word-dokumentumok (DOCX, régi DOC, ODT, RTF) beolvasása – valódi Worddel készült fájlok', async () => {
  const { readTxtFiles } = await import('../js/txtimport.js');
  const expected = '[1. versszak]\nÁrvíztűrő tükörfúrógép, ő és ű betűkkel\nCsengess be hozzám az éjjel\nSzól a nóta\ttabulátorral\n\n[Refrén]\n„Idézőjel” – gondolatjel… ÁÉÍÓÖŐÚÜŰ';
  const files = [];
  for (const ext of ['docx', 'doc', 'odt', 'rtf']) {
    const name = `Csengess be hozzám.${ext}`;
    const blob = await (await fetch(`fixtures/${encodeURIComponent(name)}`)).blob();
    files.push(new File([blob], name));
  }
  files.push(new File(['x'], '~$engess be hozzám.docx')); // Word zárolófájl – ki kell maradnia
  const res = await readTxtFiles(files);
  eq(res.errors, [], 'nincs olvasási hiba');
  eq(res.summary.txt, 4, 'négy dokumentum (a zárolófájl kimaradt)');
  for (const s of res.data.songs) {
    eq(s.title, 'Csengess be hozzám', 'cím a fájlnévből');
    eq(s.lyrics, expected, `szöveg helyes (${s.title})`);
  }
  eq(res.summary.newSongs, 1, 'a négy azonos tartalmú dokumentumból egy dal lesz');
});

await test('Fotózás: felismert szöveg tisztítása, cím az első sorból, versszakhatárok a sorközökből', async () => {
  const ocr = await import('../js/ocr.js');
  eq(ocr.cleanOcrText(`  Elsõ  sor 



második   sor  
`), `Első sor

második sor`, 'szóközök, sorvégek, õ → ő');
  const sp = ocr.splitTitle(`
12. Esik az eső, még sincs sár.
Csak a babám udvarán
Elhordanám`);
  eq(sp.title, 'Esik az eső, még sincs sár', 'cím: sorszám és záró pont nélkül');
  eq(sp.rest, `Csak a babám udvarán
Elhordanám`, 'a szöveg a cím nélkül');
  const L = (text, y) => ({ text, bbox: { y0: y, y1: y + 30 } });
  // ritka sorköz (minden sor 75 px), egyetlen nagyobb köz a versszakok között
  const t = ocr.textFromLines([L('a', 0), L('b', 75), L('c', 150), L('d', 300), L('e', 375)]);
  eq(t, `a
b
c

d
e`, 'üres sor csak a valódi versszakhatárnál');
  eq(ocr.textFromLines([L('egy', 0)]), '', 'egy sornál a nyers szöveget használjuk');
});

await test('Refrénjel felismerése: R, R:, R., Ref., Refr, Refrén, Refren, [Refrén] – és a Rózsa NEM jel', async () => {
  const { refrainMarker: m } = await import('../js/lyrics.js');
  const yes = {
    // jel egyedül a sorban
    'R': ['Refrén', ''], 'r': ['Refrén', ''], 'R:': ['Refrén', ''], 'R.': ['Refrén', ''], ' R. ': ['Refrén', ''],
    'Ref': ['Refrén', ''], 'Ref.': ['Refrén', ''], 'REF:': ['Refrén', ''], 'Refr.': ['Refrén', ''], 'refr:': ['Refrén', ''],
    'Refrén': ['Refrén', ''], 'refrén:': ['Refrén', ''], 'REFRÉN.': ['Refrén', ''], 'Refren': ['Refrén', ''], 'refren:': ['Refrén', ''],
    '[Refrén]': ['Refrén', ''], '[refren]': ['Refrén', ''], '[Ref.]': ['Refrén', ''], '[R]': ['Refrén', ''], '[REFR]': ['Refrén', ''],
    'Refrén 2': ['Refrén 2', ''], '[Refrén 2x]': ['Refrén 2×', ''], 'Refrén: 2x': ['Refrén 2×', ''], 'R 2x': ['Refrén 2×', ''], 'R2:': ['Refrén 2', ''],
    // jel a refrén első sorának elején
    'R: Szól a nóta': ['Refrén', 'Szól a nóta'], 'R. Szól a nóta': ['Refrén', 'Szól a nóta'], 'r:Rózsa, rózsa': ['Refrén', 'Rózsa, rózsa'],
    'Ref. Mindig veled': ['Refrén', 'Mindig veled'], 'Refrén: Az a szép': ['Refrén', 'Az a szép'], '[Refrén] Ölembe ült': ['Refrén', 'Ölembe ült'],
    'Refr.: Ha átölel': ['Refrén', 'Ha átölel'],
  };
  for (const [line, [label, rest]] of Object.entries(yes)) {
    const r = m(line);
    assert(r, `jelnek kell lennie: „${line}”`);
    eq([r.label, r.rest], [label, rest], `„${line}”`);
  }
  const no = ['Rózsa, rózsa, piros rózsa', 'Rózsa', 'Reggel', 'R betűvel kezdődik', 'Refréneztünk egész este', 'Referencia', 'Ref ma este',
    'Rám néztél egy mosollyal', 'R Szól a nóta', 'Refrénnel együtt', '[1. versszak]', '[Versszak]', '', '   ', 'A fülembe muzsikál'];
  for (const line of no) eq(m(line), null, `nem lehet jel: „${line}”`);
});

await test('Refrén kiterjedése: a jeltől az üres sorig vagy a következő jelig; jel után szöveg nélkül címke', async () => {
  const { parseLyrics } = await import('../js/lyrics.js');
  const kinds = (t) => parseLyrics(t).map((p) => `${p.kind}:${p.text}`);
  eq(kinds('Első sor\nR:\nSzól a nóta\nhajnalig szól\n\nVers2\nRózsa nyílik'),
    ['line:Első sor', 'ref-label:Refrén', 'ref-line:Szól a nóta', 'ref-line:hajnalig szól', 'gap:', 'line:Vers2', 'line:Rózsa nyílik'], 'külön sorban álló R:');
  eq(kinds('R: Szól a nóta\nhajnalig\nRef. Másik refrén\nsor\n\nVége'),
    ['ref-line:Szól a nóta', 'ref-line:hajnalig', 'ref-line:Másik refrén', 'ref-line:sor', 'gap:', 'line:Vége'], 'jel a sor elején, új jelnél új refrén');
  eq(parseLyrics('R: Szól a nóta')[0].mark, 'R:', 'a sor eleji jel megmarad kis címkeként');
  eq(kinds('Vers\n\nRefrén\n\nVers2'), ['line:Vers', 'gap:', 'ref-label:Refrén', 'gap:', 'line:Vers2'], 'jel után nincs szöveg → címke');
  eq(kinds('[Refrén]\nA\n[2. versszak]\nB'), ['ref-label:Refrén', 'ref-line:A', 'section:2. versszak', 'line:B'], 'más szakaszcímke lezárja a refrént');
  eq(kinds('Rózsa\nRózsa'), ['line:Rózsa', 'line:Rózsa'], 'Rózsa nem indít refrént');
});

await test('Refrén megjelenítése: kiemelés be/ki, szöveg nem vész el, HTML-biztonság', async () => {
  const { lyricsHTML } = await import('../js/components.js');
  const song = 'Vers <b>egy</b>\nR:\nRef & sor\nmásik\n\nRózsa nyílik\nRefrén\n';
  const on = lyricsHTML(song, true);
  const box = document.createElement('div'); box.innerHTML = on;
  eq(box.querySelectorAll('.lyr-ref').length, 2, 'két refrénblokk');
  eq([...box.querySelectorAll('.lyr-ref .lyr-ref-label')].map((x) => x.textContent), ['Refrén', 'Refrén'], 'címkék');
  eq([...box.querySelectorAll('.lyr-ref:first-child ~ * , .lyr-ref')][0].textContent.includes('Ref & sor'), true, 'a refrén sora a blokkban');
  assert(!box.querySelector('b'), 'a beírt HTML nem értelmeződik');
  assert(box.textContent.includes('Vers <b>egy</b>'), 'a beírt szöveg pontosan látszik');
  assert(!box.querySelector('.lyr-ref')?.textContent.includes('Rózsa'), 'a Rózsa sor nincs a refrénben');
  const off = document.createElement('div'); off.innerHTML = lyricsHTML(song, false);
  eq(off.querySelectorAll('.lyr-ref, .lyr-ref-label, .lyr-sec').length, 0, 'kikapcsolva nincs kiemelés');
  eq([...off.querySelectorAll('.lyr-l')].map((d) => d.textContent), song.split('\n'), 'kikapcsolva minden sor változatlan');
  const rm = document.createElement('div'); rm.innerHTML = lyricsHTML('R: Szól a nóta', true);
  eq(rm.querySelector('.lyr-ref-mark')?.textContent, 'R:', 'sor eleji jel kis címkeként');
});

await test('Szerkesztő „Refrén” gombja: [Refrén] a kijelölés elé, üres sor utána, ha kell', async () => {
  const { markRefrain: mk } = await import('../js/lyrics.js');
  const t = 'Vers1\nVers2\nSzól a nóta\nhajnalig szól\nVers3';
  const a = t.indexOf('Szól a nóta'); const b = t.indexOf('hajnalig szól') + 4;
  let r = mk(t, a, b);
  eq(r.text, 'Vers1\nVers2\n[Refrén]\nSzól a nóta\nhajnalig szól\n\nVers3', 'kijelölt sorok elé jel, utánuk üres sor');
  eq(r.text.slice(r.selStart, r.selEnd), '[Refrén]\nSzól a nóta\nhajnalig szól', 'a kijelölés a megjelölt refrénre kerül');
  r = mk('Vers\n\nSzól a nóta\nhajnalig szól\n\nVers', 9, 9);
  eq(r.text, 'Vers\n\n[Refrén]\nSzól a nóta\nhajnalig szól\n\nVers', 'kurzorral a versszakban: az egész versszak, fölös üres sor nélkül');
  r = mk('A\nB', 0, 3);
  eq(r.text, '[Refrén]\nA\nB', 'a dal végén nem kell üres sor');
  eq(mk('[Refrén]\nA', 10, 10).changed, false, 'a már megjelölt refrént nem jelöli újra');
  eq(mk('A\n\nB', 2, 2).changed, false, 'üres soron nem csinál semmit');
});

await test('„Ezt már játszottuk”: este reggel 6-ig tart, jelölés/visszavonás, új este, másnap magától törlődik', async () => {
  const night = await import('../js/night.js');
  eq(night.nightKey(new Date(2026, 10, 11, 21, 45)), '2026-11-11', 'este 21:45 → aznapi este');
  eq(night.nightKey(new Date(2026, 10, 12, 1, 30)), '2026-11-11', 'éjjel 1:30 → még az előző este');
  eq(night.nightKey(new Date(2026, 10, 12, 6, 5)), '2026-11-12', 'reggel 6:05 → új nap');
  const songsBefore = JSON.stringify(store.exportData().songs);
  await night.newNight();
  await night.setPlayed(a.id, true);
  assert(night.isPlayed(a.id), 'jelölve');
  await night.setPlayed(a.id, false);
  assert(!night.isPlayed(a.id), 'visszavonva');
  await night.setPlayed(a.id, true);
  await night.setPlayed(c.id, true);
  eq(night.playedCount(), 2, 'két dal lejátszva');
  await night.newNight();
  eq(night.playedCount(), 0, '„Új este” mindent töröl');
  // régi este szimulálása: a tárolt dátum tegnapi
  await night.setPlayed(a.id, true);
  await store.saveSettings('night', { ...store.settings('night'), date: '2000-01-01' });
  assert(!night.isPlayed(a.id), 'régi este jelölése már nem számít');
  await night.ensureFresh();
  eq(store.settings('night').played, [], 'és a következő megnyitáskor törlődik');
  eq(JSON.stringify(store.exportData().songs), songsBefore, 'a dalok nem változtak');
});

await test('Két hasáb: versszakok egyben maradnak; csak fekvő tableten és csak ha nem fér ki', async () => {
  const { lyricsHTML, fitColumns } = await import('../js/components.js');
  const song = 'V1a\nV1b\n\nR: Ref a\nref b\n\nV2a\nV2b\nV2c';
  for (const hl of [true, false]) {
    const box = document.createElement('div'); box.innerHTML = lyricsHTML(song, hl);
    eq([...box.children].map((c) => (c.classList.contains('lyr-st') ? `[${c.querySelectorAll('.lyr-l').length}]` : 'gap')), ['[2]', 'gap', '[2]', 'gap', '[3]'], `versszak-blokkok (kiemelés: ${hl})`);
  }
  // méretfüggés: tesztelés valódi elemen, változtatható ablakmérettel
  const lyr = document.createElement('div'); lyr.className = 'lyrics';
  lyr.innerHTML = lyricsHTML(Array.from({ length: 40 }, (_, i) => `sor ${i}`).join('\n'));
  lyr.style.cssText = 'font-size:30px;line-height:1.5;position:absolute;left:-9999px;width:900px';
  document.body.appendChild(lyr);
  const realW = Object.getOwnPropertyDescriptor(window, 'innerWidth'); const realH = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const size = (w, h) => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: w }); Object.defineProperty(window, 'innerHeight', { configurable: true, value: h }); };
  try {
    size(1280, 800); eq(fitColumns(lyr, 600), true, 'fekvő tablet, nem fér ki → két hasáb');
    eq(fitColumns(lyr, 99999), false, 'fekvő tablet, kifér → egy hasáb');
    size(800, 1280); eq(fitColumns(lyr, 600), false, 'álló tablet → egy hasáb');
    size(412, 915); eq(fitColumns(lyr, 600), false, 'álló telefon → egy hasáb');
    size(915, 412); eq(fitColumns(lyr, 300), false, 'fekvő telefon → egy hasáb');
    size(1280, 800); await store.patchSettings('app', { twoColumns: false });
    eq(fitColumns(lyr, 600), false, 'kikapcsolva → egy hasáb');
    await store.patchSettings('app', { twoColumns: true });
  } finally {
    if (realW) Object.defineProperty(window, 'innerWidth', realW); else delete window.innerWidth;
    if (realH) Object.defineProperty(window, 'innerHeight', realH); else delete window.innerHeight;
    lyr.remove();
  }
});

await test('Vendégkérés: a dal a következő helyre kerül, duplikáció nélkül; a mentett lista nem változik', async () => {
  const night = await import('../js/night.js');
  const N = night.insertNext;
  eq(N(['a', 'b', 'c', 'd'], 1, 'x'), { ids: ['a', 'b', 'x', 'c', 'd'], idx: 1, moved: false, isCurrent: false }, 'új dal a jelenlegi után');
  eq(N(['a', 'b', 'c', 'd'], 1, 'd').ids, ['a', 'b', 'd', 'c'], 'listán későbbi dal előrehozva, nem kétszer');
  eq(N(['a', 'b', 'c', 'd'], 2, 'a'), { ids: ['b', 'c', 'a', 'd'], idx: 1, moved: true, isCurrent: false }, 'már elhangzott dal újra: a jelenlegi dal ugyanaz marad');
  eq(N(['a', 'b'], 0, 'a').isCurrent, true, 'a most szóló dalt nem helyezi át');
  eq(N(['a', 'b'], 1, 'x').ids, ['a', 'b', 'x'], 'utolsó dal után a végére');
  await night.newNight();
  const l = store.state.setlists.get(list.id);
  const saved = [...l.songIds];
  const extra = (await store.saveSong({ title: 'Vendég kérte', lyrics: 'kérés' })).id;
  const r = N(night.tonightIds(l), 0, extra);
  await night.setTonightOrder(l, r.ids, extra);
  eq(night.tonightIds(l), [saved[0], extra, ...saved.slice(1)], 'ma esti sorrend');
  eq(store.state.setlists.get(list.id).songIds, saved, 'a mentett lista változatlan');
  assert(night.requestedSet(list.id).has(extra), 'kérésként jelölve');
  await store.reload();
  eq(night.tonightIds(store.state.setlists.get(list.id)), [saved[0], extra, ...saved.slice(1)], 'újraindítás után is megmarad aznap este');
  await night.clearTonightOrder(list.id);
  eq(night.tonightIds(store.state.setlists.get(list.id)), saved, 'visszaállítható a mentett sorrend');
  await store.deleteSong(extra);
});

await test('Tömeges műveletek: kedvenc, címke, törlés egy lépésben', async () => {
  const ids = store.querySongs({ query: 'zold ablakos' }).concat(store.querySongs({ query: 'regi kodolas' })).map((x) => x.song.id);
  eq(ids.length, 2, 'két kijelölt dal');
  await store.bulkUpdateSongs(ids, (s) => ({ ...s, favorite: true }));
  assert(ids.every((id) => store.getSong(id).favorite), 'mind kedvenc');
  const t = await store.createTag('Tömeges');
  await store.bulkUpdateSongs(ids, (s) => ({ ...s, tagIds: [...new Set([...s.tagIds, t.id])] }));
  eq(store.tagCount(t.id), 2, 'címke mindkettőn');
  await store.addSongsToSetlist(list.id, ids);
  const n = await store.bulkDeleteSongs(ids);
  eq(n, 2, 'két dal törölve');
  assert(!store.state.setlists.get(list.id).songIds.some((x) => ids.includes(x)), 'listáról is lekerültek');
  await store.reload();
  assert(!ids.some((id) => store.getSong(id)), 'újratöltés után sincsenek meg');
});

/* ---------------- Akkordok és transzponálás ---------------- */

await test('Akkordfelismerés: valódi akkordnevek igen, [Refrén] / [R] / [1. versszak] / [Intro] nem', async () => {
  const { isChord, parseChordLine, isChordOnlyLine } = await import('../js/chords.js');
  for (const c of ['Am', 'E', 'H', 'Hm', 'B', 'Bb', 'F#m7', 'C#', 'Ebm', 'Cmaj7', 'Gsus4', 'Dsus2', 'Cdim', 'Caug', 'C6', 'Am9', 'Cadd9', 'D/F#', 'Am/G', 'E7#9', 'Dm7b5', 'C(add9)', 'G7']) assert(isChord(c), `akkord: ${c}`);
  for (const c of ['Refrén', 'R', 'Ref', '1. versszak', 'Versszak', 'Intro', 'Outro', 'Bridge', 'Coda', 'Hook', 'Dal', 'Add', 'am', '', '2x', 'Am Dm']) assert(!isChord(c), `nem akkord: ${c}`);
  eq(parseChordLine('[Am]Csengess be [E]hozzám'), { text: 'Csengess be hozzám', chords: [{ pos: 0, name: 'Am' }, { pos: 12, name: 'E' }] }, 'sor szétbontása');
  eq(parseChordLine('[Refrén] [Am]Szól').text, '[Refrén] Szól', 'a címke a szövegben marad');
  assert(isChordOnlyLine('[Am] [Dm] [E]'), 'csak akkordokból álló sor');
  assert(!isChordOnlyLine('[Refrén]') && !isChordOnlyLine('[1. versszak]') && !isChordOnlyLine('[Am]szó'), 'címke vagy szöveges sor nem akkordsor');
  const { parseLyrics } = await import('../js/lyrics.js');
  const kinds = (t) => parseLyrics(t).map((p) => p.kind);
  eq(kinds('[Refrén]\n[R]\n[1. versszak]\n[Intro]\n[Am] [Dm] [E]\n[Am]\n[Am]Csengess be'), ['ref-label', 'ref-label', 'section', 'section', 'chords', 'chords', 'line'], 'címkék maradnak címkék, az akkordsor akkordsor');
  eq(parseLyrics('[Refrén]\n[Am] [E]\n[Am]Szól a nóta')[1], { kind: 'chords', text: '[Am] [E]', ref: true, i: 1 }, 'refrénen belüli akkordsor a refrénhez tartozik');
});

await test('Transzponálás: 12 lépés után az eredeti jön vissza (magyar és nemzetközi jelöléssel)', async () => {
  const { transposeChord, normShift, shiftLabel, chordFormatter } = await import('../js/chords.js');
  for (const notation of ['hu', 'intl']) {
    for (const c of ['C', 'C#m', 'Db', 'D7', 'Eb', 'E', 'F', 'F#m7', 'G', 'Ab', 'Am', 'H7', 'Hm', 'Bb', 'D/F#', 'Cmaj7/E', 'Gsus4', 'Dm7b5']) {
      let x = c; let shift = 0;
      for (let i = 0; i < 12; i++) { shift = normShift(shift + 1); x = transposeChord(c, shift, notation); }
      eq(shift, 0, 'eltolás 12 lépés után');
      eq(x, transposeChord(c, 0, notation), `${notation}: ${c} (12 × +1)`);
      let y = 0; for (let i = 0; i < 12; i++) y = normShift(y - 1);
      eq(y, 0, '12 × −1');
    }
  }
  eq([shiftLabel(2), shiftLabel(-1), shiftLabel(0), shiftLabel(12), shiftLabel(13)], ['+2', '−1', '0', '0', '+1'], 'eltolás kiírása');
  const f = chordFormatter('[Am]Csengess be [E]hozzám', 2, 'hu');
  eq([f('Am'), f('E'), f('Dm'), f('G7')], ['Hm', 'F#', 'Em', 'A7'], 'Am → Hm (+2)');
  eq(chordFormatter('[Am]x', -2, 'hu')('Am'), 'Gm', '−2');
});

await test('H/B: magyar jelölésnél H = fehér, B = fekete; nemzetközinél B = fehér, Bb = fekete', async () => {
  const { transposeChord: t, notePc, chordFormatter, rootChoices } = await import('../js/chords.js');
  eq([notePc('H', '', 'hu'), notePc('B', '', 'hu'), notePc('B', 'b', 'hu')], [11, 10, 10], 'magyar: H, B, Bb');
  eq([notePc('B', '', 'intl'), notePc('B', 'b', 'intl'), notePc('H', '', 'intl')], [11, 10, 11], 'nemzetközi: B, Bb (és a H is értelmezhető)');
  eq([t('H', 1, 'hu'), t('B', 1, 'hu'), t('A', 1, 'hu', true), t('H', -1, 'hu', true)], ['C', 'H', 'B', 'B'], 'magyar transzponálás');
  eq([t('B', 1, 'intl'), t('Bb', 1, 'intl'), t('A', 1, 'intl', true), t('B', -1, 'intl', true)], ['C', 'B', 'Bb', 'Bb'], 'nemzetközi transzponálás');
  eq([t('B', 0, 'hu'), t('Bb', 0, 'hu'), t('H7', 0, 'intl'), t('Bb', 0, 'intl')], ['B', 'B', 'B7', 'Bb'], 'eltolás nélkül a jelölést követi');
  // E-dúr dal +1 → F-dúr: a fekete billentyű B (magyar) / Bb (nemzetközi), nem A#
  eq(chordFormatter('[E]x [A]y [H7]z', 1, 'hu')('A'), 'B', 'F-dúrban B, nem A# (magyar)');
  eq(chordFormatter('[E]x [A]y [H7]z', 1, 'intl')('A'), 'Bb', 'F-dúrban Bb, nem A# (nemzetközi)');
  eq(chordFormatter('[E]x [A]y [H7]z', 1, 'hu')('H7'), 'C7', 'H7 → C7');
  // C-dúr +2 → D-dúr (keresztes): F → G, C# marad keresztes
  eq(chordFormatter('[C]x [F]y [H]z', 2, 'hu')('H'), 'C#', 'D-dúrban C#');
  eq(chordFormatter('[Am]x', 5, 'hu')('Am'), 'Dm', 'Am +5 → Dm');
  eq(chordFormatter('[Am]x [E]y', 1, 'hu')('E'), 'F', 'B-moll (b) hangnem: E → F');
  eq(chordFormatter('[Dm]x [A]y', 1, 'hu')('A'), 'B', 'esz-moll: bével');
  eq(rootChoices('hu'), ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'B', 'H'], 'választó: magyar');
  eq(rootChoices('intl').slice(-2), ['Bb', 'B'], 'választó: nemzetközi');
});

await test('Akkordok megjelenítése: a szó fölött, zárójel nélkül, ki/be kapcsolható, sor végén is', async () => {
  const { lyricsHTML } = await import('../js/components.js');
  const box = document.createElement('div');
  box.innerHTML = lyricsHTML('[1. versszak]\n[Am]Csengess be [E]hozzám\nCsen[G]gess [C]\n\n[Refrén]\n[Am] [Dm] [E]\n[F]Szól a nóta', true, { chords: true, notation: 'hu' });
  assert(!box.textContent.includes('[Am]') && !/\[(Am|E|G|C|Dm|F)\]/.test(box.textContent), 'szögletes zárójeles akkord nem látszik');
  eq(box.querySelector('.lyr-sec')?.textContent, '1. versszak', 'a címke megmarad');
  eq(box.querySelector('.lyr-ref-label')?.textContent, 'Refrén', 'a refrénjel megmarad');
  const cols = [...box.querySelectorAll('.ch-w')].map((w) => [w.querySelector('.ch').textContent, w.textContent.slice(w.querySelector('.ch').textContent.length)]);
  eq(cols.slice(0, 4), [['Am', 'Csengess'], ['E', 'hozzám'], ['G', 'gess'], ['C', ' ']], 'akkord a szó / szótag elején, sor végén is');
  eq(box.querySelectorAll('.ch-word')[2].textContent.replace('G', ''), 'Csengess', 'a szótagra tett akkord a szót nem vágja ketté');
  assert(box.querySelector('.lyr-ref .lyr-chordrow'), 'akkordsor a refrénben');
  eq([...box.querySelectorAll('.lyr-chordrow .cn')].map((x) => x.textContent), ['Am', 'Dm', 'E'], 'akkordsor');
  const off = document.createElement('div');
  off.innerHTML = lyricsHTML('[Am]Csengess be [E]hozzám\n[Am] [E]\nmásik', true, { chords: false });
  eq(off.querySelectorAll('.ch, .cn, .lyr-chordrow').length, 0, 'kikapcsolva nincs akkord');
  eq([...off.querySelectorAll('.lyr-l')].map((d) => d.textContent), ['Csengess be hozzám', 'másik'], 'kikapcsolva a szöveg zárójel nélkül, az akkordsor eltűnik');
  const tr = document.createElement('div');
  tr.innerHTML = lyricsHTML('[Am]Csengess be [E]hozzám', true, { shift: 2, notation: 'hu' });
  eq([...tr.querySelectorAll('.cn')].map((x) => x.textContent), ['Hm', 'F#'], 'transzponálva jelenik meg');
  const plain = document.createElement('div');
  plain.innerHTML = lyricsHTML('[Am]Csengess <b>be</b>', false, {});
  assert(!plain.querySelector('b') && plain.textContent.includes('<b>be</b>'), 'HTML-biztonság akkordos sorban is');
  eq(plain.querySelector('.cn')?.textContent, 'Am', 'kiemelés nélkül is akkord a szó fölött');
});

await test('Transzponálás dalonként mentődik, a dalszöveg nem változik; mentésben benne van; régi mentés betöltődik', async () => {
  const lyrics = '[Am]Csengess be [E]hozzám\nma este';
  const s = await store.saveSong({ title: 'Csengess be hozzám (akkord)', lyrics });
  const before = store.getSong(s.id).updatedAt;
  await store.setTranspose(s.id, 2);
  await store.setTranspose(s.id, 14);
  await store.reload();
  eq(store.getSong(s.id).transpose, 2, 'eltolás megmarad újraindítás után (14 → 2)');
  eq(store.getSong(s.id).lyrics, lyrics, 'az elmentett szöveg NEM változik');
  eq(store.getSong(s.id).updatedAt, before, 'a módosítás ideje sem változik');
  await store.saveSong({ ...store.getSong(s.id), title: 'Csengess be hozzám (akkord)' });
  eq(store.getSong(s.id).transpose, 2, 'szerkesztés után is megmarad');
  const exp = await backup.buildExport({ includeMedia: false });
  eq(exp.songs.find((x) => x.id === s.id).transpose, 2, 'a mentésben benne van');
  const { data } = backup.parseBackup(JSON.stringify(exp));
  eq(data.songs.find((x) => x.id === s.id).transpose, 2, 'a mentésből visszatöltődik');
  const old = backup.parseBackup(JSON.stringify({ app: 'stefy-dalszovegek', format: 1, songs: [{ id: 'old1', title: 'Régi dal', lyrics: '[Am]régi' }], settings: { app: { showClock: false } } }));
  eq(old.data.songs[0].transpose, 0, 'régi mentés (eltolás nélkül): eredeti hangnem');
  eq(old.data.songs[0].lyrics, '[Am]régi', 'régi mentés szövege változatlan');
  eq(old.data.settings.app.chordNotation, 'hu', 'régi beállításoknál alapból magyar jelölés');
  eq(old.data.settings.app.showClock, false, 'a régi beállítás megmarad');
  const bad = backup.parseBackup(JSON.stringify({ songs: [{ title: 'x', lyrics: 'y', transpose: 'hibás' }] }));
  eq(bad.data.songs[0].transpose, 0, 'hibás érték → 0');
  await store.deleteSong(s.id);
});

await test('Keresés akkordos szövegben: az akkordok nem zavarnak', async () => {
  const s = await store.saveSong({ title: 'Akkordos keresőpróba', lyrics: '[Am]Csengess be [E]hozzám\nCsen[G]gess újra\n[Dm] [G7]' });
  const hit = (q) => store.querySongs({ query: q }).some((x) => x.song.id === s.id);
  assert(hit('csengess'), '„csengess” megtalálja');
  assert(hit('be hozzam'), 'kifejezés két akkord között');
  assert(hit('csengess ujra'), 'szótagra tett akkord nem vágja ketté a szót');
  assert(!hit('g7'), 'akkordnévre nem talál (nem dalszöveg)');
  await store.deleteSong(s.id);
});

await test('„Akkord a sor fölött” átalakítás: a fölötte lévő szóhoz kerül; bizonytalan sorhoz nem nyúl', async () => {
  const { convertChordLines, isPlainChordLine } = await import('../js/chords.js');
  const src = 'Am       E\nCsengess be hozzám\n\nC         G     Am\nEgy két három négy öt';
  const r = convertChordLines(src);
  eq(r.text, '[Am]Csengess [E]be hozzám\n\n[C]Egy két [G]három [Am]négy öt', 'akkordok a szavak elején');
  eq(r.changes.length, 2, 'két átalakítás');
  // 1.8.3: a jelöléses akkordsor („Intro: …”) is átalakul, de külön sor marad (nem olvad a szövegbe)
  eq(convertChordLines('Intro: Am G\nszöveg').text, 'Intro: [Am] [G]\nszöveg', 'jelöléses akkordsor külön sorként');
  eq(convertChordLines('Itt Am van G\nszöveg').changes.length, 0, 'szöveggel kevert sorhoz nem nyúl');
  eq(convertChordLines('A\nszöveg').changes.length, 0, 'egyetlen magányos betű bizonytalan: nem nyúl hozzá');
  eq(convertChordLines('Am  Dm  E\n\nszöveg').text, '[Am] [Dm] [E]\n\nszöveg', 'szöveg nélküli akkordsor → akkordsor');
  eq(convertChordLines('Am      E\nrövid').text, '[Am]rövid [E]', 'a sor végén túli akkord a sor végére');
  eq(convertChordLines('Am\n[G]már akkordos').changes.length, 1, 'akkordos szövegsorba nem olvaszt bele');
  eq(convertChordLines('Am\n[G]már akkordos').text, '[Am]\n[G]már akkordos', '…csak az akkordsort alakítja');
  eq(convertChordLines('[Am]Csengess be\nsima sor').changes.length, 0, 'a már átalakított szöveg nem változik');
  assert(isPlainChordLine('  Am   F#m7  H7  ') && isPlainChordLine('E A') && !isPlainChordLine('Anna Mari') && !isPlainChordLine('Hé Bé'), 'akkordsor-felismerés');
  eq(convertChordLines('Am\tE\nCsengess be hozzám').text, '[Am]Csengess [E]be hozzám', 'tabulátorral igazított akkordsor');
});

await test('Akkordozás mód műveletei: hozzáadás a szó elejére, csere, ◀ ▶ betűnként, törlés', async () => {
  const { setChordAt, moveChord, deleteChord } = await import('../js/chordedit.js');
  let r = setChordAt('Csengess be hozzám', null, 0, 'Am');
  eq(r, { line: '[Am]Csengess be hozzám', ci: 0 }, 'új akkord a szó elejére');
  r = setChordAt(r.line, null, 12, 'E');
  eq(r, { line: '[Am]Csengess be [E]hozzám', ci: 1 }, 'második akkord');
  r = setChordAt(r.line, 0, 0, 'Hm');
  eq(r.line, '[Hm]Csengess be [E]hozzám', 'csere');
  r = moveChord(r.line, 0, 1);
  eq(r, { line: 'C[Hm]sengess be [E]hozzám', ci: 0 }, 'egy betűvel jobbra');
  r = moveChord('Csengess[Hm] be', 0, 1);
  eq(r.line, 'Csengess [Hm]be', 'a szóközt átugorja');
  r = moveChord('Csengess [Hm]be', 0, -1);
  eq(r.line, 'Csenges[Hm]s be', 'balra is átugorja');
  eq(moveChord('[Am]x', 0, -1).line, '[Am]x', 'a sor elejénél megáll');
  eq(deleteChord('[Am]Csengess be [E]hozzám', 0), 'Csengess be [E]hozzám', 'törlés');
});

/* ---------------- Hangszer-jegyzet ---------------- */

await test('Hangszer-jegyzet: régi dal üres mezőkkel, mentés, szerkesztés után is megmarad', async () => {
  const { instLine, cleanInst, hasInst } = await import('../js/inst.js');
  const old = await store.saveSong({ title: 'Régi dal jegyzet nélkül', lyrics: 'szöveg' });
  eq(store.getSong(old.id).inst, undefined, 'régi/új dal jegyzet nélkül: nincs mező');
  eq(instLine(store.getSong(old.id)), '', 'üres jegyzetsor');
  assert(!hasInst(old), 'nincs jegyzet');
  const s = await store.saveSong({ title: 'Jegyzetes dal', lyrics: '[Dm]Egy [A7]kettő', inst: { key: ' Dm ', tempo: '120', style: 'Polka', bank: 'Lakodalom 2', button: '5', memo: 'intro 4 ütem', junk: 'x' } });
  eq(store.getSong(s.id).inst, { key: 'Dm', tempo: 120, style: 'Polka', bank: 'Lakodalom 2', button: 5, memo: 'intro 4 ütem' }, 'tisztított mezők');
  await store.saveSong({ ...store.getSong(s.id), title: 'Jegyzetes dal' });
  await store.toggleFavorite(s.id);
  await store.setTranspose(s.id, 0);
  await store.reload();
  eq(store.getSong(s.id).inst.bank, 'Lakodalom 2', 'szerkesztés / kedvenc / újraindítás után megmarad');
  eq(cleanInst({ tempo: 'gyors', button: 11, key: '' }), {}, 'érvénytelen tempó és gomb kimarad');
  eq(cleanInst({ tempo: 0, button: 0 }), {}, '0 nem érték');
  eq(cleanInst(null), {}, 'hiányzó jegyzet = üres');
  await store.deleteSong(old.id);
});

await test('Jegyzetsor: csak a kitöltött és bekapcsolt mezők; üresen nem foglal helyet', async () => {
  const { instLine, buttonLabel } = await import('../js/inst.js');
  const full = { inst: { style: 'Polka', bank: 'Lakodalom 2', button: 5, key: 'Dm', tempo: 120, memo: 'intro' } };
  eq(instLine(full), 'Lakodalom 2 · 5-ös gomb · Polka · Dm · 120 BPM · intro', 'minden mező');
  eq(instLine({ inst: { bank: 'Lakodalom 2', button: 5, key: 'Dm', tempo: 120 } }), 'Lakodalom 2 · 5-ös gomb · Dm · 120 BPM', 'csak a kitöltöttek');
  eq(instLine(full, { fields: ['bank', 'key'] }), 'Lakodalom 2 · Dm', 'csak a Beállításokban kiválasztott mezők');
  eq(instLine(full, { fields: [] }), '', 'minden mező kikapcsolva');
  eq([1, 2, 3, 5, 6, 8, 10].map(buttonLabel), ['1-es gomb', '2-es gomb', '3-as gomb', '5-ös gomb', '6-os gomb', '8-as gomb', '10-es gomb'], 'gomb toldaléka');
  const { songCardHTML } = await import('../js/components.js');
  const box = document.createElement('div');
  box.innerHTML = songCardHTML({ id: 'x1', title: 'A', ...full }) + songCardHTML({ id: 'x2', title: 'B' });
  eq(box.querySelectorAll('.song-inst').length, 1, 'üres jegyzetnél nincs elem a kártyán');
  eq(box.querySelector('.song-inst').textContent, 'Lakodalom 2 · 5-ös gomb · Polka · Dm · 120 BPM · intro', 'a kártyán a jegyzetsor');
  assert(!box.textContent.includes('[Dm]'), 'akkord nem kerül a kártyára');
});

await test('Hangnem transzponálva (H/B jelöléssel is); a mentett hangnem nem változik; javaslat az akkordokból', async () => {
  const { displayKey, instLine, suggestKey } = await import('../js/inst.js');
  eq([displayKey('Dm', 2, 'hu'), displayKey('Dm', -2, 'hu'), displayKey('Dm', 0, 'hu')], ['Em', 'Cm', 'Dm'], 'moll hangnem');
  eq([displayKey('G', 3, 'hu'), displayKey('G', 3, 'intl')], ['B', 'Bb'], 'G +3: magyar B, nemzetközi Bb (nem A#)');
  eq([displayKey('A', 2, 'hu'), displayKey('A', 2, 'intl')], ['H', 'B'], 'A +2: magyar H, nemzetközi B');
  eq([displayKey('H', 1, 'hu'), displayKey('B', 1, 'hu'), displayKey('B', 1, 'intl')], ['C', 'H', 'C'], 'H/B értelmezése a jelölés szerint');
  eq([displayKey('Hm', 0, 'intl'), displayKey('Bb', 0, 'hu')], ['Bm', 'B'], 'eltolás nélkül a jelölést követi');
  eq(displayKey('d-moll', 2, 'hu'), 'd-moll', 'nem akkordszerű hangnem változatlan');
  eq(instLine({ transpose: 2, inst: { key: 'Dm', tempo: 120 } }, { notation: 'hu' }), 'Em (+2) · 120 BPM', 'jegyzetsorban az eltolás is látszik');
  eq(instLine({ transpose: -1, inst: { tempo: 90 } }), 'Eltolás: −1 · 90 BPM', 'hangnem nélkül is látszik az eltolás');
  eq(instLine({ transpose: 2, inst: { key: 'Dm' } }, { fields: ['tempo'] }), '', 'kikapcsolt hangnem mezőnél nincs');
  const s = await store.saveSong({ title: 'Hangnem próba', lyrics: '[Dm]x', inst: { key: 'Dm' } });
  await store.setTranspose(s.id, 2);
  eq(store.getSong(s.id).inst.key, 'Dm', 'a mentett hangnem nem változik');
  eq(store.getSong(s.id).lyrics, '[Dm]x', 'a szöveg sem');
  await store.deleteSong(s.id);
  eq([suggestKey('[Dm]Egy [A7]kettő'), suggestKey('[F]a [C]b'), suggestKey('sima szöveg'), suggestKey('[Refrén]\nszöveg')], ['Dm', 'F', '', ''], 'hangnem-javaslat');
  eq([suggestKey('[B]x', 'hu'), suggestKey('[Bb]x', 'intl'), suggestKey('[H7]x', 'intl')], ['B', 'Bb', 'B'], 'javaslat a választott jelöléssel');
});

await test('Keresés a style és a bank nevére; mentésben benne van, régi mentés hibátlanul betöltődik', async () => {
  const a = await store.saveSong({ title: 'Első jegyzetes', lyrics: 'x', inst: { style: 'Polka', bank: 'Lakodalom 2', button: 3 } });
  const b = await store.saveSong({ title: 'Második jegyzetes', lyrics: 'y', inst: { style: 'Lakodalom 2', key: 'G' } });
  const c = await store.saveSong({ title: 'Harmadik jegyzet nélkül', lyrics: 'z' });
  const ids = (q) => store.querySongs({ query: q }).map((x) => x.song.id).filter((id) => [a.id, b.id, c.id].includes(id)).sort();
  eq(ids('Lakodalom 2'), [a.id, b.id].sort(), 'bank- és style-névre is (ékezet nélkül is)');
  eq(ids('lakodalom'), [a.id, b.id].sort(), 'részlet');
  eq(ids('polka'), [a.id], 'style neve');
  eq(store.querySongs({ query: 'polka' }).find((x) => x.song.id === a.id).match, 'meta', 'jelvény: előadó / címke / jegyzet');
  const exp = await backup.buildExport({ includeMedia: false });
  eq(exp.songs.find((x) => x.id === a.id).inst, { style: 'Polka', bank: 'Lakodalom 2', button: 3 }, 'a mentésben benne van');
  const back = backup.parseBackup(JSON.stringify(exp)).data.songs;
  eq(back.find((x) => x.id === b.id).inst, { key: 'G', style: 'Lakodalom 2' }, 'visszatöltődik');
  const old = backup.parseBackup(JSON.stringify({ app: 'stefy-dalszovegek', format: 1, songs: [{ id: 'o1', title: 'Régi', lyrics: 'r', favorite: true }] }));
  eq(old.data.songs[0].inst, {}, 'régi mentés: üres jegyzet');
  eq([old.data.songs[0].title, old.data.songs[0].favorite], ['Régi', true], 'régi mentés többi adata változatlan');
  const bad = backup.parseBackup(JSON.stringify({ songs: [{ title: 'x', lyrics: 'y', inst: 'hibás' }, { title: 'z', lyrics: 'w', inst: { tempo: 'gyors', bank: 5 } }] }));
  eq([bad.data.songs[0].inst, bad.data.songs[1].inst], [{}, { bank: '5' }], 'hibás jegyzet nem okoz hibát');
  for (const x of [a, b, c]) await store.deleteSong(x.id);
});

/* ---------------- DalPad: névváltás, semleges kezdőkép, üdvözlő ---------------- */

const { openDB, tx: rawTx } = await import('../js/db.js');
const tmpDBs = [];
async function withDB(seed, fn) {
  const name = `stefy-dalszovegek-TESZT-mig-${Date.now()}-${tmpDBs.length}`;
  tmpDBs.push(name);
  if (seed) { const d = await openDB(name); await rawTx(d, ['songs', 'settings', 'media'], 'readwrite', (s) => seed(s)); d.close(); }
  await store.init(name);
  try { await fn(name); } finally { store.getDB().close(); await deleteDB(name); }
}

await test('(a) Új, üres felhasználó: üdvözlő jelenik meg, semleges kezdőkép („DalPad”)', async () => {
  const welcome = await import('../js/welcome.js');
  await withDB(null, async (name) => {
    assert(store.state.fresh, 'új felhasználó');
    assert(welcome.shouldShowWelcome(), 'az üdvözlő megjelenik');
    eq(store.settings('home').title.text, 'DalPad', 'semleges főcím');
    assert(!/STEFY/i.test(JSON.stringify(store.settings('home'))), 'nincs STEFY a kezdőképen');
    await store.reload();
    assert(welcome.shouldShowWelcome(), 'újraindítás után is (amíg nem zárta le)');
    // üdvözlő lezárása zenekarnévvel (ahogy az üdvözlő teszi)
    const home = store.clone(store.settings('home')); home.title.text = 'Hajnal Zenekar';
    await store.saveSettings('home', home);
    await store.patchSettings('app', { welcomeDone: true, bandName: 'Hajnal Zenekar', chordNotation: 'intl' });
    store.getDB().close(); await store.init(name);
    assert(!store.state.fresh && !welcome.shouldShowWelcome(), 'lezárás után nem jelenik meg újra');
    eq(store.settings('home').title.text, 'Hajnal Zenekar', 'a megadott név a főcím (és nem írja felül a régi STEFY-BAND)');
    eq(store.homeDefaults().title.text, 'Hajnal Zenekar', 'alaphelyzetnél is a megadott név');
    eq(store.settings('app').chordNotation, 'intl', 'akkordjelölés elmentve');
  });
  await withDB(null, async (name) => {
    await store.patchSettings('app', { welcomeDone: true }); // mindent kihagyott
    store.getDB().close(); await store.init(name);
    eq(store.settings('home').title.text, 'DalPad', 'név nélkül „DalPad” marad (a régi kezdőkép-megőrzés nem fut rá)');
  });
});

await test('(b) Meglévő felhasználó (dalok + beállítások, kezdőkép-szerkesztés nélkül): NEM jön üdvözlő, a kezdőkép STEFY-BAND marad', async () => {
  const welcome = await import('../js/welcome.js');
  // 1.7-es állapot: dal és mentett beállítások vannak, de a kezdőkép sosem volt elmentve
  await withDB((s) => {
    s.songs.put({ id: 's_regi', title: 'Régi dalom', lyrics: '[Am]szöveg', tagIds: [], favorite: true, order: 1, createdAt: 1, updatedAt: 1 });
    s.settings.put({ key: 'app', value: { showClock: false, chordNotation: 'hu' } });
    s.settings.put({ key: 'reader', value: { fontSize: 44 } });
  }, async (name) => {
    assert(!store.state.fresh && !welcome.shouldShowWelcome(), 'nincs üdvözlő');
    eq(store.settings('home'), store.clone(store.LEGACY_HOME), 'a kezdőkép pontosan a régi (STEFY-BAND, DALSZÖVEG, szlogen)');
    eq([store.settings('app').showClock, store.settings('reader').fontSize, store.getSong('s_regi').title], [false, 44, 'Régi dalom'], 'dalok és beállítások változatlanok');
    store.getDB().close(); await store.init(name);
    eq(store.settings('home').title.text, 'STEFY-BAND', 'újraindítás után is');
    eq(store.homeDefaults().title.text, 'STEFY-BAND', 'a főcím alaphelyzete is a régi név');
  });
  // csak beállítás van (dal nincs) → akkor is meglévő felhasználó
  await withDB((s) => { s.settings.put({ key: 'reader', value: { fontSize: 50 } }); }, async () => {
    assert(!welcome.shouldShowWelcome(), 'mentett beállításnál sincs üdvözlő');
    eq(store.settings('home').title.text, 'STEFY-BAND', 'kezdőkép megőrizve');
  });
  // korábban szerkesztett (akár hiányos) kezdőkép: a saját értékek maradnak, a hiányzók a régi alapértékből
  await withDB((s) => {
    s.songs.put({ id: 's1', title: 'x', lyrics: '', tagIds: [], order: 1, createdAt: 1, updatedAt: 1 });
    s.settings.put({ key: 'home', value: { title: { text: 'Saját cím', color: '#ffffff' }, overlay: 0.5 } });
  }, async () => {
    const h = store.settings('home');
    eq([h.title.text, h.title.color, h.title.size, h.subtitle.text, h.slogan.text, h.overlay], ['Saját cím', '#ffffff', 60, 'DALSZÖVEG', 'Mindig veled a színpadon.', 0.5], 'saját + régi alapértékek');
  });
  // csak háttérkép van
  await withDB((s) => { s.media.put({ key: 'bg-home', data: new Uint8Array([120]).buffer, type: 'image/jpeg', size: 1, updatedAt: 1 }); }, async () => {
    assert(!welcome.shouldShowWelcome(), 'saját háttérképnél sincs üdvözlő');
    eq(store.settings('home').title.text, 'STEFY-BAND', 'kezdőkép megőrizve');
  });
});

await test('(c) Régi és új nevű mentésfájl is betöltődik; mentésfájl új neve; belső nevek változatlanok', async () => {
  eq(store.DEFAULT_DB, 'stefy-dalszovegek', 'adatbázis neve változatlan');
  assert(backup.exportFileName().startsWith('dalpad-mentes-') && backup.exportFileName().endsWith('.json'), 'új fájlnév');
  await withDB(null, async () => {
    await store.saveSong({ title: 'Mentett dal', lyrics: '[Am]szöveg', inst: { bank: 'B1' } });
    const data = await backup.buildExport({ includeMedia: false });
    eq(data.app, 'stefy-dalszovegek', 'a mentés belső azonosítója változatlan');
    const json = JSON.stringify(data);
    for (const fname of ['stefy-dalszovegek-mentes-2026-01-01-1200.json', backup.exportFileName()]) {
      const text = await backup.readFile(new File([json], fname, { type: 'application/json' }));
      const { data: d, summary } = backup.parseBackup(text);
      eq([d.songs[0].title, d.songs[0].inst.bank, summary.songs], ['Mentett dal', 'B1', 1], `betöltődik: ${fname}`);
    }
    // régi mentés kezdőkép-beállítással: teljes visszaállításkor a mentett kezdőkép jön vissza
    const old = { app: 'stefy-dalszovegek', format: 1, songs: [{ id: 'o', title: 'Régi', lyrics: 'r' }], settings: { home: store.clone(store.LEGACY_HOME), app: { showClock: false } } };
    const { data: od } = backup.parseBackup(JSON.stringify(old));
    await backup.applyImport(od, 'replace');
    eq(store.settings('home').title.text, 'STEFY-BAND', 'visszaállítás után a mentett kezdőkép');
    await store.reload();
    eq(store.settings('home').title.text, 'STEFY-BAND', 'és újraindítás után is');
  });
  let threw = '';
  try { backup.parseBackup('{"semmi":1}'); } catch (e) { threw = e.message; }
  assert(threw.includes('DalPad') && !threw.includes('STEFY'), 'hibaüzenet az új névvel');
});

await test('Mintadal: ismert népdal (Tavaszi szél) akkordokkal, hangszer-jegyzettel; törölhető', async () => {
  const w = await import('../js/welcome.js');
  const { hasChords } = await import('../js/chords.js');
  const { parseLyrics } = await import('../js/lyrics.js');
  await withDB(null, async () => {
    const s = await w.addSampleSong();
    const again = await w.addSampleSong();
    eq(again.id, s.id, 'nem kerül be kétszer');
    assert(s.sample && hasChords(s.lyrics), 'akkordos mintadal');
    eq([s.title, s.artist], ['Tavaszi szél vizet áraszt', 'magyar népdal'], 'cím és előadó');
    const chords = [...s.lyrics.matchAll(/\[([A-H][^\]]*)\]/g)].map((m) => m[1]);
    eq([...new Set(chords)].sort(), ['Am', 'C', 'Dm', 'E', 'G'], 'A-moll kíséret: C, G, Am, Dm, E');
    assert(parseLyrics(s.lyrics).length > 4, 'értelmezhető dalszöveg');
    assert(s.inst.bank && s.inst.key && s.inst.tempo, 'van hangszer-jegyzet');
    await store.deleteSong(s.id);
    eq(store.state.songs.size, 0, 'törölhető');
  });
});

/* ---------------- Háttérképek (1.8.2): felismerés, kicsinyítés, tájolás, hibaüzenetek ---------------- */

const img = await import('../js/image.js');

function canvasBlob(w, h, type = 'image/jpeg', paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (paint) paint(x, w, h); else { x.fillStyle = '#3366cc'; x.fillRect(0, 0, w, h); }
  return new Promise((r) => c.toBlob(r, type, 0.9));
}
async function blobSize(blob) {
  const b = await createImageBitmap(blob);
  const s = [b.width, b.height];
  b.close();
  return s;
}
// EXIF APP1 szegmens (tájolás = o) beillesztése egy JPEG elejére
async function withOrientation(jpeg, o) {
  const src = new Uint8Array(await jpeg.arrayBuffer());
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0, 0, 0];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = body.length + 2;
  const seg = [0xff, 0xe1, len >> 8, len & 0xff, ...body];
  return new Blob([src.subarray(0, 2), new Uint8Array(seg), src.subarray(2)], { type: 'image/jpeg' });
}
const asFile = (blob, name) => new File([blob], name, { type: blob.type });

await test('Háttérkép: fejléc-felismerés (JPG, PNG, WEBP, HEIC, RAW) a kép megnyitása nélkül', async () => {
  const j = await img.sniffImage(asFile(await canvasBlob(321, 123), 'a.jpg'));
  eq([j.format, j.width, j.height], ['jpeg', 321, 123], 'JPG méret');
  const p = await img.sniffImage(asFile(await canvasBlob(77, 55, 'image/png'), 'a.png'));
  eq([p.format, p.width, p.height], ['png', 77, 55], 'PNG méret');
  const wb = await canvasBlob(90, 40, 'image/webp');
  if (wb && wb.type === 'image/webp') {
    const w = await img.sniffImage(asFile(wb, 'a.webp'));
    eq([w.format, w.width, w.height], ['webp', 90, 40], 'WEBP méret');
  }
  const heic = new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0x6d, 0x69, 0x66, 0x31, 0x68, 0x65, 0x69, 0x63])], 'IMG_1234.HEIC', { type: '' });
  eq((await img.sniffImage(heic)).format, 'heic', 'HEIC felismerése');
  const dng = new File([new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])], 'kep.dng', { type: '' });
  eq((await img.sniffImage(dng)).format, 'raw', 'RAW (DNG) felismerése');
});

await test('Háttérkép: EXIF-tájolás – az álló fotó nem fordul el', async () => {
  // a tárolt kép fekvő (40×20): bal fele piros, jobb fele kék; a 6-os tájolás 90°-kal jobbra forgat
  const raw = await canvasBlob(40, 20, 'image/jpeg', (x) => { x.fillStyle = '#f00'; x.fillRect(0, 0, 20, 20); x.fillStyle = '#00f'; x.fillRect(20, 0, 20, 20); });
  const f = asFile(await withOrientation(raw, 6), 'allo.jpg');
  const s = await img.sniffImage(f);
  eq([s.orientation, s.width, s.height], [6, 20, 40], 'tájolás és megjelenített méret');
  const out = await img.processImage(f);
  eq(await blobSize(out), [20, 40], 'az eredmény álló');
  const bmp = await createImageBitmap(out);
  const c = document.createElement('canvas'); c.width = 20; c.height = 40;
  const x = c.getContext('2d'); x.drawImage(bmp, 0, 0); bmp.close();
  const top = x.getImageData(10, 5, 1, 1).data; const bottom = x.getImageData(10, 35, 1, 1).data;
  assert(top[0] > 150 && top[2] < 100, 'fent piros (helyesen elforgatva)');
  assert(bottom[2] > 150 && bottom[0] < 100, 'lent kék (helyesen elforgatva)');
});

await test('Háttérkép: nagy fotó és hosszú panoráma kicsinyítve, arányosan', async () => {
  const big = await img.processImage(asFile(await canvasBlob(4800, 3600), 'nagy.jpg'));
  eq(await blobSize(big), [2400, 1800], '4800×3600 → 2400×1800');
  const pano = await img.processImage(asFile(await canvasBlob(12000, 1500), 'panorama.jpg'));
  eq(await blobSize(pano), [2400, 300], 'panoráma 12000×1500 → 2400×300');
  const small = await img.processImage(asFile(await canvasBlob(800, 600, 'image/png'), 'kepernyokep.png'));
  eq(await blobSize(small), [800, 600], 'kis kép nem nagyobbodik');
  eq(small.type, 'image/jpeg', 'JPEG lesz belőle');
});

await test('Háttérkép: érthető magyar hibaüzenetek (HEIC, nem kép, kevés hely)', async () => {
  const heic = new File([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0x6d, 0x69, 0x66, 0x31, 0x68, 0x65, 0x69, 0x63, 1, 2, 3])], 'IMG_1234.HEIC', { type: 'image/heic' });
  let e1; try { await img.processImage(heic); } catch (e) { e1 = e; }
  assert(e1 instanceof img.ImageError, 'HEIC: ImageError');
  assert(/HEIC/.test(e1.message) && /JPG/.test(e1.message), 'HEIC: ok és tanács a szövegben');
  assert(/^HEIC/.test(e1.tech), 'HEIC: technikai név');
  let e2; try { await img.processImage(new File(['hello'], 'level.txt', { type: 'text/plain' })); } catch (e) { e2 = e; }
  assert(e2 && /nem kép/.test(e2.message), 'nem kép');
  const q = img.describeImageError(new DOMException('The quota has been exceeded.', 'QuotaExceededError'));
  assert(/Kevés a szabad hely/.test(q.text), 'kevés hely – magyarul');
  eq(q.tech, 'QuotaExceededError', 'kevés hely – technikai név');
  let e3; try { await img.processImage(new File([], 'ures.jpg', { type: 'image/jpeg' })); } catch (e) { e3 = e; }
  assert(e3 && /üres/.test(e3.message), 'üres fájl');
});

// vissza a fő teszt-adatbázishoz
await store.init(DB);

/* ---------------- Fájlbeolvasás (1.8.3): egyszer, azonnal; NotReadableError (SD-kártya) kezelése ---------------- */

const fr = await import('../js/fileread.js');
const comp = await import('../js/components.js');

// „SD-kártyás” fájl utánzása: a megadott nevű fájl beolvasása NotReadableError-ral elszáll
const realAB = File.prototype.arrayBuffer;
const realBlobAB = Blob.prototype.arrayBuffer;
const realSlice = Blob.prototype.slice;
const realRead = FileReader.prototype.readAsArrayBuffer;
const realClick = HTMLInputElement.prototype.click;
function breakReading(names) {
  const fail = (f) => f instanceof File && names.includes(f.name) && !f.__mem;
  File.prototype.arrayBuffer = function () { return fail(this) ? Promise.reject(new DOMException('A requested file could not be read', 'NotReadableError')) : realBlobAB.call(this); };
  FileReader.prototype.readAsArrayBuffer = function (b) {
    if (!fail(b)) return realRead.call(this, b);
    setTimeout(() => this.onerror?.(new ProgressEvent('error')), 0);
  };
}
function restoreReading() {
  delete File.prototype.arrayBuffer;
  FileReader.prototype.readAsArrayBuffer = realRead;
  HTMLInputElement.prototype.click = realClick;
}
// a fájlválasztó helyett a sorban következő fájlt „választja ki”, és feljegyzi az accept-et
function fakePicker(queue, accepts) {
  HTMLInputElement.prototype.click = function () {
    if (this.type !== 'file') return realClick.call(this);
    accepts.push(this.getAttribute('accept'));
    const f = queue.shift();
    const dt = new DataTransfer();
    if (f) dt.items.add(f);
    this.files = dt.files;
    setTimeout(() => this.dispatchEvent(new Event(f ? 'change' : 'cancel')), 0);
  };
}
const waitFor = async (fn, ms = 4000) => {
  for (let t = 0; t < ms; t += 50) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('időtúllépés');
};
const jpeg = async (w, h, col) => { const c = new OffscreenCanvas(w, h); const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, w, h); return c.convertToBlob({ type: 'image/jpeg' }); };

await test('Fájlbeolvasás: egyszer, egyben; FileReader tartalék; NotReadableError → érthető hiba', async () => {
  const f = new File(['hello világ'], 'a.txt', { type: 'text/plain' });
  const m = await fr.readFileOnce(f);
  eq(await m.text(), 'hello világ', 'tartalom');
  eq([m.name, m.type], ['a.txt', 'text/plain'], 'név és típus megmarad');
  // csak az arrayBuffer romlik el → FileReader-rel sikerül
  File.prototype.arrayBuffer = function () { return Promise.reject(new DOMException('x', 'NotReadableError')); };
  try { eq(await (await fr.readFileOnce(new File(['tartalék'], 'b.txt'))).text(), 'tartalék', 'FileReader-tartalék'); } finally { delete File.prototype.arrayBuffer; }
  breakReading(['sd.txt']);
  let err;
  try { await fr.readFileOnce(new File(['x'], 'sd.txt')); } catch (e) { err = e; } finally { restoreReading(); }
  assert(fr.isReadError(err), 'FileReadError');
  assert(/SD-kártyán/.test(err.message), 'egyszerű magyar szöveg');
  assert(/NotReadableError/.test(err.tech), 'technikai név');
});

await test('Fájlbeolvasás: az eredeti képfájlt csak egyszer olvassa, utána a másolattal dolgozik', async () => {
  const calls = [];
  const orig = new File([await jpeg(300, 200, '#0a0')], 'egyszer.jpg', { type: 'image/jpeg' });
  File.prototype.arrayBuffer = function () { calls.push(['arrayBuffer', this]); return realBlobAB.call(this); };
  Blob.prototype.slice = function (...a) { calls.push(['slice', this]); return realSlice.apply(this, a); };
  const accepts = [];
  fakePicker([orig], accepts);
  let copy;
  try {
    copy = await comp.pickImageFile();
    await comp.processImage(copy);
  } finally { Blob.prototype.slice = realSlice; restoreReading(); }
  const onOrig = calls.filter(([, o]) => o !== copy && o.name === 'egyszer.jpg');
  eq(onOrig.map(([k]) => k), ['arrayBuffer'], 'az eredetin csak egy teljes beolvasás');
  eq(accepts, ['image/*'], 'először a képválasztó');
});

await test('Háttérkép: NotReadableError → hibaablak „Kiválasztás a Fájlok közül” gombbal, a korábbi kép megmarad', async () => {
  const old = await jpeg(64, 64, '#123456');
  await store.setMedia('bg-reader', old);
  const oldSize = (await store.getMedia('bg-reader')).blob.size;
  breakReading(['sd.jpg']);
  const accepts = [];
  const good = new File([await jpeg(1024, 1024, '#c33')], 'jo.jpg', { type: '' }); // a Fájlok közül típus nélkül is jöhet
  fakePicker([new File([await jpeg(1024, 1024, '#c33')], 'sd.jpg', { type: 'image/jpeg' }), good], accepts);
  try {
    // 1) Mégse → semmi nem változik
    const p1 = comp.chooseBackground('bg-reader', 'kész');
    const box1 = await waitFor(() => document.querySelector('.modal'));
    const btns = [...box1.querySelectorAll('button')].map((b) => b.textContent.trim());
    assert(btns.includes('Kiválasztás a Fájlok közül'), `van „Kiválasztás a Fájlok közül” gomb (${btns.join(' / ')})`);
    assert(/SD-kártyán/.test(box1.textContent) && /korábbi kép megmaradt/.test(box1.textContent), 'érthető üzenet');
    assert(/NotReadableError/.test(box1.textContent), 'technikai hibanév');
    [...box1.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Mégse').click();
    eq(await p1, false, 'Mégse → nincs új kép');
    eq((await store.getMedia('bg-reader')).blob.size, oldSize, 'a korábbi kép megmaradt');
    await waitFor(() => !document.querySelector('.modal'));

    // 2) újra SD-s kép → hibaablak → „Kiválasztás a Fájlok közül” → sima fájlválasztó → sikerül
    fakePicker([new File([await jpeg(1024, 1024, '#c33')], 'sd.jpg', { type: 'image/jpeg' }), good], accepts);
    const p2 = comp.chooseBackground('bg-reader', 'kész');
    const box2 = await waitFor(() => document.querySelector('.modal'));
    eq((await store.getMedia('bg-reader')).blob.size, oldSize, 'a hibaablak alatt is a korábbi kép van');
    [...box2.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Kiválasztás a Fájlok közül').click();
    eq(await p2, true, 'a Fájlok közül választott kép beállítva');
    eq(accepts.slice(-2), ['image/*', null], 'a második választó nem csak képtípusra szűr');
    assert((await store.getMedia('bg-reader')).blob.size !== oldSize, 'új kép mentve');
  } finally { restoreReading(); document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove()); }
});

await test('Háttérkép: a Fájlok közül választott nem-kép fájlt elutasítja, a korábbi kép marad', async () => {
  const before = (await store.getMedia('bg-reader')).blob.size;
  const accepts = [];
  fakePicker([new File(['nem kép'], 'jegyzet.txt', { type: 'text/plain' })], accepts);
  let ok;
  try { ok = await comp.chooseBackground('bg-reader', 'kész'); } finally { restoreReading(); }
  eq(ok, false, 'nem állít be képet');
  eq((await store.getMedia('bg-reader')).blob.size, before, 'a korábbi kép megmaradt');
});

await test('Mentés visszaállítása és fájlimport: NotReadableError → érthető magyar hiba', async () => {
  breakReading(['mentes.json', 'dal.txt']);
  let e1;
  try { await backup.readFile(new File(['{}'], 'mentes.json', { type: 'application/json' })); } catch (e) { e1 = e; }
  const txt = await import('../js/txtimport.js');
  let res;
  try { res = await txt.readTxtFiles([new File(['Szöveg'], 'dal.txt', { type: 'text/plain' })]); } finally { restoreReading(); }
  assert(e1 && /SD-kártyán/.test(e1.message) && /NotReadableError/.test(e1.message), 'mentés: érthető hiba');
  assert(res.errors.length === 1 && /nem tudta beolvasni/.test(res.errors[0]), 'import: a fájl kimarad, érthető üzenettel');
  eq(res.data.songs.length, 0, 'nincs hibás dal');
});


await test('Teljesítmény: 3000 dal keresése gyors', async () => {
  const words = ['szerelem', 'éjszaka', 'hajnal', 'tánc', 'nyár', 'csillag', 'tenger', 'szív', 'zene', 'álom'];
  const songs = [];
  for (let i = 0; i < 3000; i++) {
    const lyr = Array.from({ length: 24 }, (_, j) => `${words[(i + j) % 10]} ${words[(i * 3 + j) % 10]} sor ${j}`).join('\n');
    songs.push({ id: `perf_${i}`, title: `Teljesítmény dal ${i}`, artist: '', lyrics: lyr, tagIds: [], favorite: false, order: 1000 + i, createdAt: Date.now(), updatedAt: Date.now(), lastOpenedAt: null });
  }
  await store.commitImport({ songs, tags: [], setlists: [] });
  const t0 = performance.now();
  const r = store.querySongs({ query: 'hajnal tenger' });
  const t1 = performance.now();
  store.querySongs({ sort: 'title' });
  const t2 = performance.now();
  assert(r.length > 0, 'van találat');
  assert(t1 - t0 < 150, `keresés túl lassú: ${(t1 - t0).toFixed(1)} ms`);
  assert(t2 - t1 < 150, `rendezés túl lassú: ${(t2 - t1).toFixed(1)} ms`);
  const li = document.createElement('li');
  li.textContent = `ℹ 3000 dal: keresés ${(t1 - t0).toFixed(1)} ms, ABC-rendezés ${(t2 - t1).toFixed(1)} ms`;
  out.appendChild(li);
});

/* ---------------- Kézzel írt akkordsorok (1.8.3): magyar írásmód, elválasztók, import, tömeges átalakítás ---------------- */

const ch = await import('../js/chords.js');

await test('Akkordsor: magyar írásmódok (A-moll, a-moll, Fisz-moll, Esz-dúr, Cisz) felismerése', async () => {
  const n = (t) => ch.normalizeChordToken(t);
  eq([n('A-moll'), n('a-moll'), n('Amoll'), n('A-mol'), n('C-dúr'), n('Cdur')], ['Am', 'Am', 'Am', 'Am', 'C', 'C'], 'moll/dúr');
  eq([n('Fisz-moll'), n('Cisz'), n('Esz-dúr'), n('Asz'), n('H-moll'), n('B-dúr')], ['F#m', 'C#', 'Eb', 'Ab', 'Hm', 'B'], 'magyar módosítók');
  eq([n('Am'), n('F#m7'), n('D/F#'), n('Gsus4')], ['Am', 'F#m7', 'D/F#', 'Gsus4'], 'szabványos nevek változatlanok');
  eq([n('a'), n('e'), n('Es'), n('is'), n('De'), n('Ha')], [null, null, null, null, null, null], 'hétköznapi szavak nem akkordok');
});

await test('Akkordsor: elválasztók, ismétlésjel, jelölés; nincs téves találat sima szövegen', async () => {
  for (const l of ['G   C   Am', 'A-moll   C-moll', 'a-moll  d-moll  E', 'G - C - Am', 'G, C, Am', 'G | C | D', 'G  C  Am  (2x)', 'Intro: G D', 'Ref.: C G', 'A moll   E']) {
    assert(ch.isPlainChordLine(l), `akkordsor: ${l}`);
  }
  for (const l of ['A', 'E', 'A szél fúj', 'E vers', 'Hej, de szép', 'De jó', 'Refrén:', '1.', 'Ha te tudnád', 'Esz a fene']) {
    assert(!ch.isPlainChordLine(l), `nem akkordsor: ${l}`);
  }
  eq(ch.convertChordLines('A-moll     E\nSzáll a dal ma este').text, '[Am]Száll a dal [E]ma este', 'magyar írásmód a szótag fölé');
  eq(ch.convertChordLines('G -  C   - D\nEgy  kettő három').text, '[G]Egy  [C]kettő [D]három', 'elválasztók elmaradnak');
  eq(ch.convertChordLines('Intro: G  C  (2x)\nSzöveg').text, 'Intro: [G] [C] (2x)\nSzöveg', 'jelöléses sor külön marad');
  eq(ch.convertChordLines('A moll   E\nSzáll a dal').text, '[Am]Száll a [E]dal', '„A moll” két szóban');
});

await test('Akkordsor: átalakítás után ugyanúgy transzponálható, mint a kézzel beírt akkord', async () => {
  const t = ch.convertChordLines('A-moll      D-moll    E\nTavaszi szél vizet áraszt').text;
  eq(ch.usedChords(t), ['Am', 'Dm', 'E'], 'felismert akkordok');
  const f = ch.chordFormatter(t, 2, 'hu');
  eq(ch.usedChords(t).map(f), ['Hm', 'Em', 'F#'], '+2 félhang');
  const g = ch.chordFormatter(t, -2, 'hu');
  eq(ch.usedChords(t).map(g), ['Gm', 'Cm', 'D'], '−2 félhang');
});

await test('Fájlimport: a kézzel írt akkordsorokat felismeri, és nem duplázza a régi formájú dalt', async () => {
  const txt = await import('../js/txtimport.js');
  const body = 'G        C        D\nEgy kis dal a nyárról\nEm       C       D     G\nszól a zene hajnalig';
  const res = await txt.readTxtFiles([new File([body], 'Nyári dal.txt', { type: 'text/plain' })]);
  eq(res.summary.chordSongs, 1, 'egy dalban volt akkordsor');
  const lyr = res.data.songs[0].lyrics;
  eq(lyr, '[G]Egy kis [C]dal a [D]nyárról\n[Em]szól a [C]zene [D]hajnalig [G]', 'akkordok a szótagok fölött');
  // ha a dal régi (átalakítatlan) formában már megvan, az import nem hozza be újra
  const old = await store.saveSong({ title: 'Nyári dal', lyrics: body });
  const res2 = await txt.readTxtFiles([new File([body], 'Nyári dal.txt', { type: 'text/plain' })]);
  eq(res2.summary.newSongs, 0, 'nem duplázódik');
  await store.deleteSong(old.id);
});

// takarítás: a teszt-adatbázis törlése
store.getDB().close();
await deleteDB(DB);

const passed = results.filter(Boolean).length;
const sum = document.getElementById('sum');
sum.textContent = `${passed} / ${results.length} teszt sikeres`;
sum.className = passed === results.length ? 'ok' : 'fail';
window.__TEST_RESULT__ = { passed, total: results.length };
