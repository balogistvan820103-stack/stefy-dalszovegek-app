// Teljes JSON-mentés, ellenőrzött import és importterv-készítés.

import * as store from './store.js';
import { uid, norm, todayISO } from './util.js';

export class ImportError extends Error {}

const MAX_FILE = 200 * 1024 * 1024;

/* ---------------- Export ---------------- */

async function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function buildExport({ includeMedia = true } = {}) {
  const data = store.exportData();
  if (includeMedia) {
    const media = await store.allMedia();
    data.media = {};
    for (const m of media) {
      if (m.blob) data.media[m.key] = { type: m.blob.type || m.type || 'image/jpeg', data: await blobToDataURL(m.blob) };
    }
  }
  return data;
}

export function exportFileName() {
  const d = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `stefy-dalszovegek-mentes-${todayISO()}-${hm}.json`;
}

export async function exportBlob(opts) {
  const data = await buildExport(opts);
  return new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}

/* ---------------- Import: beolvasás és ellenőrzés ---------------- */

const str = (v, max = 100000) => (typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : '')).slice(0, max);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const ts = (v) => {
  if (Number.isFinite(v) && v > 0) return Number(v);
  if (typeof v === 'string') { const t = Date.parse(v); if (Number.isFinite(t)) return t; }
  return null;
};
const pick = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };

export async function readFile(file) {
  if (!file) throw new ImportError('Nem választottál ki fájlt.');
  if (file.size > MAX_FILE) throw new ImportError('A fájl túl nagy (legfeljebb 200 MB lehet).');
  if (file.size === 0) throw new ImportError('A fájl üres.');
  try { return await file.text(); } catch { throw new ImportError('A fájlt nem sikerült beolvasni.'); }
}

/**
 * Szöveg → ellenőrzött, egységes adatstruktúra. Hibás fájlnál ImportError-t dob,
 * a meglévő adatokat nem érinti.
 */
export function parseBackup(text, { allowEmpty = false } = {}) {
  let raw;
  try { raw = JSON.parse(text); } catch {
    throw new ImportError('A fájl nem érvényes JSON-mentés. Ellenőrizd, hogy a megfelelő fájlt választottad-e ki.');
  }
  if (!raw || typeof raw !== 'object') throw new ImportError('A fájl nem tartalmaz értelmezhető adatot.');
  const songsRaw = Array.isArray(raw) ? raw : pick(raw, ['songs', 'dalok', 'items']);
  if (!Array.isArray(songsRaw)) throw new ImportError('A fájlban nem található dallista („songs”). Ez nem STEFY dalszöveg-mentés.');

  const warnings = [];
  const tags = [];
  const tagIds = new Set();
  const tagByName = new Map();
  const addTag = (t) => { tags.push(t); tagIds.add(t.id); tagByName.set(norm(t.name), t); };

  if (Array.isArray(raw.tags)) {
    for (const t of raw.tags) {
      if (!t || typeof t !== 'object') continue;
      const name = str(t.name, 60).trim();
      if (!name) continue;
      if (tagByName.has(norm(name))) continue;
      let id = str(t.id, 80) || uid('t_');
      if (tagIds.has(id)) id = uid('t_');
      addTag({ id, name, color: /^#[0-9a-f]{3,8}$/i.test(t.color) ? t.color : store.TAG_COLORS[tags.length % store.TAG_COLORS.length], createdAt: ts(t.createdAt) || Date.now() });
    }
  }

  const songs = [];
  const songIds = new Set();
  let skipped = 0;
  songsRaw.forEach((r, i) => {
    if (!r || typeof r !== 'object') { skipped++; return; }
    const title = str(pick(r, ['title', 'name', 'cim', 'cím', 'title_hu']), 300).replace(/\s+/g, ' ').trim();
    const lyrics = str(pick(r, ['lyrics', 'text', 'content', 'body', 'szoveg', 'szöveg', 'dalszoveg', 'dalszöveg']));
    if (!title && !lyrics.trim()) { skipped++; return; }
    let id = str(r.id, 80) || uid('s_');
    if (songIds.has(id)) id = uid('s_');
    songIds.add(id);
    let tIds = [];
    if (Array.isArray(r.tagIds)) tIds = r.tagIds.map((x) => str(x, 80)).filter((x) => tagIds.has(x));
    const tagNames = Array.isArray(r.tags) ? r.tags : (Array.isArray(r.cimkek) ? r.cimkek : []);
    for (const n of tagNames) {
      const name = str(n, 60).trim();
      if (!name) continue;
      let t = tagByName.get(norm(name));
      if (!t) { t = { id: uid('t_'), name, color: store.TAG_COLORS[tags.length % store.TAG_COLORS.length], createdAt: Date.now() }; addTag(t); }
      tIds.push(t.id);
    }
    const now = Date.now();
    songs.push({
      id,
      title: title || `Névtelen dal ${i + 1}`,
      artist: str(pick(r, ['artist', 'performer', 'eloado', 'előadó']), 300).trim(),
      lyrics: store.cleanLyrics(lyrics),
      tagIds: [...new Set(tIds)],
      favorite: !!pick(r, ['favorite', 'kedvenc', 'fav']),
      order: num(r.order) ?? i + 1,
      createdAt: ts(r.createdAt) || now,
      updatedAt: ts(r.updatedAt) || ts(r.createdAt) || now,
      lastOpenedAt: ts(r.lastOpenedAt),
    });
  });
  if (skipped) warnings.push(`${skipped} hibás vagy üres dalbejegyzés kimarad.`);

  const setlists = [];
  if (Array.isArray(raw.setlists)) {
    const lIds = new Set();
    for (const l of raw.setlists) {
      if (!l || typeof l !== 'object') continue;
      let id = str(l.id, 80) || uid('l_');
      if (lIds.has(id)) id = uid('l_');
      lIds.add(id);
      const ids = Array.isArray(l.songIds) ? [...new Set(l.songIds.map((x) => str(x, 80)))].filter((x) => songIds.has(x)) : [];
      const date = /^\d{4}-\d{2}-\d{2}$/.test(l.date) ? l.date : '';
      setlists.push({ id, name: str(l.name, 120).trim() || 'Fellépés', date, songIds: ids, createdAt: ts(l.createdAt) || Date.now(), updatedAt: ts(l.updatedAt) || Date.now() });
    }
  }

  let settings = null;
  if (raw.settings && typeof raw.settings === 'object') {
    settings = {};
    for (const k of Object.keys(store.DEFAULTS)) {
      if (raw.settings[k] && typeof raw.settings[k] === 'object') settings[k] = store.deepMerge(store.DEFAULTS[k], raw.settings[k]);
    }
    if (!Object.keys(settings).length) settings = null;
  }

  const recent = Array.isArray(raw.recent) ? raw.recent.map((x) => str(x, 80)).filter((x) => songIds.has(x)).slice(0, 20) : null;

  const media = [];
  if (raw.media && typeof raw.media === 'object') {
    for (const key of ['bg-reader', 'bg-home']) {
      const m = raw.media[key];
      if (m && typeof m.data === 'string' && /^data:image\/(png|jpe?g|webp|gif|avif);base64,/i.test(m.data)) media.push({ key, dataURL: m.data });
      else if (m) warnings.push(`A(z) „${key === 'bg-home' ? 'kezdőképernyő' : 'dalszöveg'}” háttérképe hibás, kimarad.`);
    }
  }

  const summary = {
    app: str(raw.app, 60) || (Array.isArray(raw) ? 'ismeretlen (dallista)' : 'ismeretlen'),
    exportedAt: ts(raw.exportedAt),
    songs: songs.length,
    favorites: songs.filter((s) => s.favorite).length,
    tags: tags.length,
    setlists: setlists.length,
    setlistSongs: setlists.reduce((n, l) => n + l.songIds.length, 0),
    hasSettings: !!settings,
    media: media.map((m) => m.key),
    sampleTitles: songs.slice(0, 6).map((s) => s.title),
  };
  if (!allowEmpty && !songs.length && !setlists.length && !tags.length) throw new ImportError('A fájl nem tartalmaz importálható dalt, címkét vagy listát.');
  return { data: { songs, tags, setlists, settings, recent, media }, summary, warnings };
}

function dataURLToBlob(dataURL) {
  const [head, b64] = dataURL.split(',');
  const type = (head.match(/^data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// azonos cím + azonos szöveg = ugyanaz a dal (az előadó hiánya pl. TXT-importnál ne okozzon duplikátumot)
const contentKey = (s) => `${norm(s.title).trim()}\u0000${norm(s.lyrics).replace(/\s+/g, ' ').trim()}`;

/**
 * Importterv: mode = 'keep' | 'append' | 'replace'
 *  - keep:    csak az új elemek kerülnek be; azonosító- vagy tartalomegyezésnél a meglévő marad.
 *  - append:  minden importált dal bekerül (azonos tartalmú duplikátumok kivételével), ütközésnél új azonosítóval.
 *  - replace: minden jelenlegi adat cseréje a fájl tartalmára.
 */
export function planImport(data, mode) {
  const media = data.media?.length
    ? data.media.map((m) => { const blob = dataURLToBlob(m.dataURL); return { key: m.key, blob, type: blob.type, size: blob.size, updatedAt: Date.now() }; })
    : null;

  if (mode === 'replace') {
    const { DEFAULTS, deepMerge } = store;
    const settings = {};
    for (const k of Object.keys(DEFAULTS)) settings[k] = deepMerge(DEFAULTS[k], data.settings?.[k] || {});
    return {
      clearFirst: true,
      tags: data.tags,
      songs: data.songs,
      setlists: data.setlists,
      settings,
      recent: data.recent || [],
      media,
      result: { songsAdded: data.songs.length, songsSkipped: 0, tagsAdded: data.tags.length, setlistsAdded: data.setlists.length },
    };
  }

  const { state } = store;
  // címkék összefésülése név szerint
  const tagMap = new Map();
  const newTags = [];
  const existingByName = new Map();
  for (const t of state.tags.values()) existingByName.set(norm(t.name), t);
  for (const t of data.tags) {
    const ex = existingByName.get(norm(t.name));
    if (ex) { tagMap.set(t.id, ex.id); continue; }
    let id = t.id;
    if (state.tags.has(id)) id = uid('t_');
    const nt = { ...t, id, color: t.color || store.TAG_COLORS[(state.tags.size + newTags.length) % store.TAG_COLORS.length] };
    newTags.push(nt);
    existingByName.set(norm(nt.name), nt);
    tagMap.set(t.id, id);
  }

  const byContent = new Map();
  for (const s of state.songs.values()) byContent.set(contentKey(s), s.id);
  let maxOrder = 0;
  for (const s of state.songs.values()) maxOrder = Math.max(maxOrder, Number(s.order) || 0);

  const songMap = new Map();
  const newSongs = [];
  let skipped = 0;
  const sortedImport = [...data.songs].sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const s of sortedImport) {
    const ck = contentKey(s);
    if (mode === 'keep' && state.songs.has(s.id)) { songMap.set(s.id, s.id); skipped++; continue; }
    if (byContent.has(ck)) { songMap.set(s.id, byContent.get(ck)); skipped++; continue; }
    let id = s.id;
    if (state.songs.has(id) || newSongs.some((x) => x.id === id)) id = uid('s_');
    const ns = { ...s, id, order: ++maxOrder, tagIds: s.tagIds.map((t) => tagMap.get(t)).filter(Boolean) };
    newSongs.push(ns);
    byContent.set(ck, id);
    songMap.set(s.id, id);
  }

  const existingListNames = new Set(Array.from(state.setlists.values()).map((l) => norm(l.name)));
  const newLists = [];
  for (const l of data.setlists) {
    if (mode === 'keep' && state.setlists.has(l.id)) continue;
    let id = l.id;
    if (state.setlists.has(id)) id = uid('l_');
    let name = l.name;
    if (existingListNames.has(norm(name))) name = `${name} (importált)`;
    const songIds = [...new Set(l.songIds.map((x) => songMap.get(x)).filter(Boolean))];
    newLists.push({ ...l, id, name, songIds });
  }

  return {
    clearFirst: false,
    tags: newTags,
    songs: newSongs,
    setlists: newLists,
    settings: null,
    recent: null,
    media: null,
    result: { songsAdded: newSongs.length, songsSkipped: skipped, tagsAdded: newTags.length, setlistsAdded: newLists.length },
  };
}

/** Teljes import: előtte automatikus pillanatkép készül a jelenlegi állapotról. */
export async function applyImport(data, mode) {
  const plan = planImport(data, mode);
  await store.saveSnapshot(mode === 'replace' ? 'Teljes visszaállítás előtt' : 'Import előtt');
  await store.commitImport(plan);
  return plan.result;
}

export async function restoreSnapshot(snap) {
  const { data } = parseBackup(JSON.stringify(snap.data), { allowEmpty: true });
  const plan = planImport({ ...data, media: [] }, 'replace');
  plan.media = null; // a háttérképek maradnak
  await store.saveSnapshot('Pillanatkép visszaállítása előtt');
  await store.commitImport(plan);
}
