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

// takarítás: a teszt-adatbázis törlése
store.getDB().close();
await deleteDB(DB);

const passed = results.filter(Boolean).length;
const sum = document.getElementById('sum');
sum.textContent = `${passed} / ${results.length} teszt sikeres`;
sum.className = passed === results.length ? 'ok' : 'fail';
window.__TEST_RESULT__ = { passed, total: results.length };
