// Alkalmazásállapot és adatműveletek. A teljes gyűjtemény memóriában is megvan,
// így a keresés és a rendezés több ezer dalnál is azonnali.

import { openDB, tx, getAll } from './db.js';
import { norm, uid, collator, todayISO } from './util.js';

export const DEFAULT_DB = 'stefy-dalszovegek';

export const TAG_COLORS = ['#3b82f6', '#a855f7', '#f59e0b', '#14b8a6', '#ef4444', '#ec4899', '#f97316', '#22c55e', '#6366f1', '#06b6d4', '#eab308', '#d946ef'];

export const DEFAULTS = Object.freeze({
  reader: {
    fontFamily: 'sans',
    fontSize: 30,
    lineHeight: 1.5,
    fontWeight: '500',
    align: 'left',
    overlay: 0.6,
    highlightSections: true,
    refColor: '#fbbf24',
  },
  home: {
    title: { text: 'STEFY-BAND', size: 60, color: '#ffd166', align: 'center', x: 50, y: 33 },
    subtitle: { text: 'DALSZÖVEG', size: 28, color: '#2ee6d6', align: 'center', x: 50, y: 55 },
    slogan: { text: 'Mindig veled a színpadon.', size: 20, color: '#f5d0fe', align: 'center', x: 50, y: 73 },
    overlay: 0.35,
  },
  app: {
    wakeLock: false,
    performLock: false,
    showArtist: false,
    showNext: true,
    swipeBack: true,
    listTitleSize: 19,
    songsTab: 'all',
    tagFilter: null,
    sorts: { all: 'title', favorites: 'title', tag: 'title' },
  },
});

export const SORTS = {
  manual: 'Kézi sorrend',
  title: 'Cím (ABC)',
  recent: 'Legutóbb használt',
  favorites: 'Kedvencek elöl',
  added: 'Hozzáadás ideje',
};

let db = null;
let maxOrder = 0;
const searchIdx = new Map();
const listeners = new Set();

export const state = {
  songs: new Map(),
  tags: new Map(),
  setlists: new Map(),
  settings: clone(DEFAULTS),
  recent: [],
};

export function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

export function deepMerge(def, val) {
  if (!isObj(def)) return val === undefined ? def : val;
  const out = clone(def);
  if (!isObj(val)) return out;
  for (const k of Object.keys(val)) {
    out[k] = isObj(def[k]) && isObj(val[k]) ? deepMerge(def[k], val[k]) : val[k];
  }
  return out;
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } }

/* ---------------- Inicializálás ---------------- */

export async function init(dbName = DEFAULT_DB) {
  if (db) { try { db.close(); } catch { /* */ } }
  db = await openDB(dbName);
  await reload();
}

export function getDB() { return db; }

export async function reload() {
  const [songs, tags, setlists, settings] = await Promise.all([
    getAll(db, 'songs'), getAll(db, 'tags'), getAll(db, 'setlists'), getAll(db, 'settings'),
  ]);
  state.songs = new Map(songs.map((s) => [s.id, s]));
  state.tags = new Map(tags.map((t) => [t.id, t]));
  state.setlists = new Map(setlists.map((l) => [l.id, l]));
  state.settings = clone(DEFAULTS);
  state.recent = [];
  for (const rec of settings) {
    if (rec.key === 'recent') state.recent = Array.isArray(rec.value) ? rec.value.filter((id) => state.songs.has(id)).slice(0, 20) : [];
    else if (rec.key in DEFAULTS) state.settings[rec.key] = deepMerge(DEFAULTS[rec.key], rec.value);
  }
  maxOrder = 0;
  for (const s of state.songs.values()) if (Number(s.order) > maxOrder) maxOrder = Number(s.order);
  rebuildIndex();
  emit('all');
}

/* ---------------- Keresési index ---------------- */

function indexSong(s) {
  const tagNames = (s.tagIds || []).map((id) => state.tags.get(id)?.name || '').join(' ');
  searchIdx.set(s.id, {
    t: norm(s.title),
    m: norm(`${s.artist || ''} ${tagNames}`),
    l: norm(s.lyrics),
  });
}

function rebuildIndex() {
  searchIdx.clear();
  for (const s of state.songs.values()) indexSong(s);
}

/* ---------------- Dalok ---------------- */

function cleanText(v, max = 300) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function cleanLyrics(v) {
  return String(v ?? '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
}

export function getSong(id) { return state.songs.get(id) || null; }

export async function saveSong(input) {
  const now = Date.now();
  const existing = input.id ? state.songs.get(input.id) : null;
  const song = existing
    ? { ...existing }
    : { id: uid('s_'), createdAt: now, lastOpenedAt: null, favorite: false, order: maxOrder + 1, tagIds: [] };
  song.title = cleanText(input.title) || 'Névtelen dal';
  song.artist = cleanText(input.artist);
  song.lyrics = cleanLyrics(input.lyrics);
  if (Array.isArray(input.tagIds)) song.tagIds = [...new Set(input.tagIds)].filter((id) => state.tags.has(id));
  if (typeof input.favorite === 'boolean') song.favorite = input.favorite;
  song.updatedAt = now;
  await tx(db, 'songs', 'readwrite', (s) => { s.songs.put(song); });
  state.songs.set(song.id, song);
  if (Number(song.order) > maxOrder) maxOrder = Number(song.order);
  indexSong(song);
  emit('songs');
  return song;
}

export async function deleteSong(id) {
  if (!state.songs.has(id)) return;
  const changedLists = [];
  for (const l of state.setlists.values()) {
    if (l.songIds.includes(id)) changedLists.push({ ...l, songIds: l.songIds.filter((x) => x !== id), updatedAt: Date.now() });
  }
  const recent = state.recent.filter((x) => x !== id);
  await tx(db, ['songs', 'setlists', 'settings'], 'readwrite', (s) => {
    s.songs.delete(id);
    for (const l of changedLists) s.setlists.put(l);
    s.settings.put({ key: 'recent', value: recent });
  });
  state.songs.delete(id);
  searchIdx.delete(id);
  for (const l of changedLists) state.setlists.set(l.id, l);
  state.recent = recent;
  emit('songs');
}

/** Több dal módosítása egyetlen tranzakcióban. fn(song) → módosított másolat. */
export async function bulkUpdateSongs(ids, fn) {
  const changed = ids.map((id) => state.songs.get(id)).filter(Boolean).map((s) => fn({ ...s, tagIds: [...(s.tagIds || [])] }));
  if (!changed.length) return 0;
  await tx(db, 'songs', 'readwrite', (st) => { for (const s of changed) st.songs.put(s); });
  for (const s of changed) { state.songs.set(s.id, s); indexSong(s); }
  emit('songs');
  return changed.length;
}

/** Több dal törlése egyetlen tranzakcióban (a fellépés-listákról és a legutóbbiak közül is). */
export async function bulkDeleteSongs(ids) {
  const del = new Set(ids.filter((id) => state.songs.has(id)));
  if (!del.size) return 0;
  const changedLists = [];
  for (const l of state.setlists.values()) {
    if (l.songIds.some((x) => del.has(x))) changedLists.push({ ...l, songIds: l.songIds.filter((x) => !del.has(x)), updatedAt: Date.now() });
  }
  const recent = state.recent.filter((x) => !del.has(x));
  await tx(db, ['songs', 'setlists', 'settings'], 'readwrite', (s) => {
    for (const id of del) s.songs.delete(id);
    for (const l of changedLists) s.setlists.put(l);
    s.settings.put({ key: 'recent', value: recent });
  });
  for (const id of del) { state.songs.delete(id); searchIdx.delete(id); }
  for (const l of changedLists) state.setlists.set(l.id, l);
  state.recent = recent;
  emit('songs');
  return del.size;
}

export async function toggleFavorite(id, value) {
  const s = state.songs.get(id);
  if (!s) return null;
  const song = { ...s, favorite: typeof value === 'boolean' ? value : !s.favorite };
  await tx(db, 'songs', 'readwrite', (st) => { st.songs.put(song); });
  state.songs.set(id, song);
  emit('songs');
  return song;
}

export async function markOpened(id) {
  const s = state.songs.get(id);
  if (!s) return;
  const song = { ...s, lastOpenedAt: Date.now() };
  const recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, 20);
  await tx(db, ['songs', 'settings'], 'readwrite', (st) => {
    st.songs.put(song);
    st.settings.put({ key: 'recent', value: recent });
  });
  state.songs.set(id, song);
  state.recent = recent;
}

/**
 * Kézi sorrend módosítása egy (akár szűrt) részhalmazon belül: a részhalmaz
 * dalai az eddig elfoglalt sorszámaikat kapják meg az új sorrendben.
 */
export async function reorderSongs(idsInNewOrder) {
  const songs = idsInNewOrder.map((id) => state.songs.get(id)).filter(Boolean);
  const orders = songs.map((s) => Number(s.order) || 0).sort((a, b) => a - b);
  // ütköző sorszámok esetén egyedivé tesszük
  for (let i = 1; i < orders.length; i++) if (orders[i] <= orders[i - 1]) orders[i] = orders[i - 1] + 1;
  const changed = [];
  songs.forEach((s, i) => { if (s.order !== orders[i]) changed.push({ ...s, order: orders[i] }); });
  if (!changed.length) return;
  await tx(db, 'songs', 'readwrite', (st) => { for (const s of changed) st.songs.put(s); });
  for (const s of changed) {
    state.songs.set(s.id, s);
    if (s.order > maxOrder) maxOrder = s.order;
  }
  emit('songs');
}

function sorter(sort) {
  const byTitle = (a, b) => collator.compare(a.title, b.title) || collator.compare(a.artist || '', b.artist || '');
  switch (sort) {
    case 'manual': return (a, b) => (a.order - b.order) || byTitle(a, b);
    case 'recent': return (a, b) => ((b.lastOpenedAt || 0) - (a.lastOpenedAt || 0)) || byTitle(a, b);
    case 'favorites': return (a, b) => (Number(!!b.favorite) - Number(!!a.favorite)) || byTitle(a, b);
    case 'added': return (a, b) => ((b.createdAt || 0) - (a.createdAt || 0)) || byTitle(a, b);
    default: return byTitle;
  }
}

/**
 * Dalok lekérdezése. tab: all|favorites|recent|tag
 * Visszatérés: [{ song, match }] ahol match: 'title' | 'meta' | 'lyrics' | null
 */
export function querySongs({ query = '', tab = 'all', tagId = null, sort = 'title' } = {}) {
  let list;
  if (tab === 'recent') list = state.recent.map((id) => state.songs.get(id)).filter(Boolean);
  else {
    list = Array.from(state.songs.values());
    if (tab === 'favorites') list = list.filter((s) => s.favorite);
    else if (tab === 'tag' && tagId) list = list.filter((s) => s.tagIds?.includes(tagId));
  }
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    if (tab !== 'recent') list.sort(sorter(sort));
    return list.map((song) => ({ song, match: null }));
  }
  const q = tokens.join(' ');
  const out = [];
  for (const song of list) {
    const ix = searchIdx.get(song.id);
    if (!ix) continue;
    let inTitle = 0; let ok = true; let inMeta = 0;
    for (const t of tokens) {
      if (ix.t.includes(t)) inTitle++;
      else if (ix.m.includes(t)) inMeta++;
      else if (!ix.l.includes(t)) { ok = false; break; }
    }
    if (!ok) continue;
    let score;
    let match;
    if (inTitle === tokens.length) { score = ix.t.startsWith(q) ? 0 : 1; match = 'title'; }
    else if (inTitle + inMeta === tokens.length) { score = 2; match = 'meta'; }
    else { score = inTitle ? 3 : 4; match = 'lyrics'; }
    out.push({ song, match, score });
  }
  const cmp = sorter(tab === 'recent' ? 'recent' : sort);
  out.sort((a, b) => (a.score - b.score) || cmp(a.song, b.song));
  return out;
}

/* ---------------- Címkék ---------------- */

export function tagsSorted() {
  return Array.from(state.tags.values()).sort((a, b) => collator.compare(a.name, b.name));
}

export function tagCount(tagId) {
  let n = 0;
  for (const s of state.songs.values()) if (s.tagIds?.includes(tagId)) n++;
  return n;
}

export function findTagByName(name) {
  const n = norm(name.trim());
  for (const t of state.tags.values()) if (norm(t.name) === n) return t;
  return null;
}

export async function createTag(name) {
  const clean = cleanText(name, 60);
  if (!clean) throw new Error('A címke neve nem lehet üres.');
  const existing = findTagByName(clean);
  if (existing) return existing;
  const tag = { id: uid('t_'), name: clean, color: TAG_COLORS[state.tags.size % TAG_COLORS.length], createdAt: Date.now() };
  await tx(db, 'tags', 'readwrite', (s) => { s.tags.put(tag); });
  state.tags.set(tag.id, tag);
  emit('tags');
  return tag;
}

export async function updateTag(id, { name, color }) {
  const t = state.tags.get(id);
  if (!t) throw new Error('A címke nem található.');
  const next = { ...t };
  if (name !== undefined) {
    const clean = cleanText(name, 60);
    if (!clean) throw new Error('A címke neve nem lehet üres.');
    const dup = findTagByName(clean);
    if (dup && dup.id !== id) throw new Error('Már létezik ilyen nevű címke.');
    next.name = clean;
  }
  if (color) next.color = color;
  await tx(db, 'tags', 'readwrite', (s) => { s.tags.put(next); });
  state.tags.set(id, next);
  rebuildIndex();
  emit('tags');
  return next;
}

export async function deleteTag(id) {
  const changed = [];
  for (const s of state.songs.values()) {
    if (s.tagIds?.includes(id)) changed.push({ ...s, tagIds: s.tagIds.filter((x) => x !== id) });
  }
  const app = { ...state.settings.app };
  if (app.tagFilter === id) app.tagFilter = null;
  await tx(db, ['tags', 'songs', 'settings'], 'readwrite', (st) => {
    st.tags.delete(id);
    for (const s of changed) st.songs.put(s);
    st.settings.put({ key: 'app', value: app });
  });
  state.tags.delete(id);
  for (const s of changed) state.songs.set(s.id, s);
  state.settings.app = app;
  rebuildIndex();
  emit('tags');
}

export function songColor(song) {
  const t = song.tagIds?.length ? state.tags.get(song.tagIds[0]) : null;
  if (t?.color) return t.color;
  let h = 0;
  for (const ch of song.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

/* ---------------- Fellépés-listák ---------------- */

export function setlistsSorted() {
  const today = todayISO();
  const all = Array.from(state.setlists.values());
  const upcoming = all.filter((l) => l.date && l.date >= today).sort((a, b) => a.date.localeCompare(b.date) || collator.compare(a.name, b.name));
  const past = all.filter((l) => !(l.date && l.date >= today)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt - a.createdAt));
  return { upcoming, past };
}

async function putSetlist(l) {
  await tx(db, 'setlists', 'readwrite', (s) => { s.setlists.put(l); });
  state.setlists.set(l.id, l);
  emit('setlists');
  return l;
}

export async function createSetlist({ name, date }) {
  const now = Date.now();
  return putSetlist({ id: uid('l_'), name: cleanText(name, 120) || 'Új fellépés', date: date || '', songIds: [], createdAt: now, updatedAt: now });
}

export async function updateSetlist(id, patch) {
  const l = state.setlists.get(id);
  if (!l) throw new Error('A lista nem található.');
  const next = { ...l, updatedAt: Date.now() };
  if (patch.name !== undefined) next.name = cleanText(patch.name, 120) || l.name;
  if (patch.date !== undefined) next.date = patch.date || '';
  if (Array.isArray(patch.songIds)) next.songIds = [...new Set(patch.songIds)].filter((x) => state.songs.has(x));
  return putSetlist(next);
}

export async function deleteSetlist(id) {
  await tx(db, 'setlists', 'readwrite', (s) => { s.setlists.delete(id); });
  state.setlists.delete(id);
  emit('setlists');
}

export async function duplicateSetlist(id) {
  const l = state.setlists.get(id);
  if (!l) throw new Error('A lista nem található.');
  const now = Date.now();
  return putSetlist({ ...clone(l), id: uid('l_'), name: `${l.name} (másolat)`, createdAt: now, updatedAt: now });
}

/** Több dal hozzáadása: duplikátum nem kerül fel, az újak a végére kerülnek. */
export async function addSongsToSetlist(id, songIds) {
  const l = state.setlists.get(id);
  if (!l) throw new Error('A lista nem található.');
  const present = new Set(l.songIds);
  const toAdd = [];
  let skipped = 0;
  for (const sid of songIds) {
    if (!state.songs.has(sid)) continue;
    if (present.has(sid)) { skipped++; continue; }
    present.add(sid);
    toAdd.push(sid);
  }
  if (toAdd.length) await putSetlist({ ...l, songIds: [...l.songIds, ...toAdd], updatedAt: Date.now() });
  return { added: toAdd.length, skipped };
}

export async function removeFromSetlist(id, songId) {
  const l = state.setlists.get(id);
  if (!l) return;
  await putSetlist({ ...l, songIds: l.songIds.filter((x) => x !== songId), updatedAt: Date.now() });
}

export function setlistSongs(id) {
  const l = state.setlists.get(id);
  if (!l) return [];
  return l.songIds.map((sid) => state.songs.get(sid)).filter(Boolean);
}

/* ---------------- Beállítások ---------------- */

export function settings(section) { return state.settings[section]; }

export async function saveSettings(section, value) {
  state.settings[section] = deepMerge(DEFAULTS[section], value);
  await tx(db, 'settings', 'readwrite', (s) => { s.settings.put({ key: section, value: state.settings[section] }); });
  emit('settings:' + section);
}

export async function patchSettings(section, patch) {
  return saveSettings(section, { ...state.settings[section], ...patch });
}

/* ---------------- Média (háttérképek) ---------------- */

export async function getMedia(key) {
  const rec = await new Promise((resolve, reject) => {
    const r = db.transaction('media', 'readonly').objectStore('media').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return rec || null;
}

export async function setMedia(key, blob) {
  const rec = { key, blob, type: blob.type, size: blob.size, updatedAt: Date.now() };
  await tx(db, 'media', 'readwrite', (s) => { s.media.put(rec); });
  emit('media:' + key);
  return rec;
}

export async function deleteMedia(key) {
  await tx(db, 'media', 'readwrite', (s) => { s.media.delete(key); });
  emit('media:' + key);
}

export async function allMedia() { return getAll(db, 'media'); }

/* ---------------- Export / import alapjai ---------------- */

export function exportData() {
  const strip = (s) => ({ ...s });
  return {
    app: 'stefy-dalszovegek',
    format: 1,
    exportedAt: new Date().toISOString(),
    songs: Array.from(state.songs.values()).map(strip),
    tags: Array.from(state.tags.values()).map(strip),
    setlists: Array.from(state.setlists.values()).map(strip),
    settings: clone(state.settings),
    recent: [...state.recent],
  };
}

/**
 * Importterv véglegesítése EGYETLEN tranzakcióban: ha bármi hibát dob,
 * semmi sem változik a meglévő adatokon.
 */
export async function commitImport(plan) {
  await tx(db, ['songs', 'tags', 'setlists', 'settings', 'media'], 'readwrite', (s) => {
    if (plan.clearFirst) {
      s.songs.clear();
      s.tags.clear();
      s.setlists.clear();
      s.settings.clear();
      if (plan.media) s.media.clear();
    }
    for (const t of plan.tags || []) s.tags.put(t);
    for (const so of plan.songs || []) s.songs.put(so);
    for (const l of plan.setlists || []) s.setlists.put(l);
    if (plan.settings) for (const k of Object.keys(plan.settings)) s.settings.put({ key: k, value: plan.settings[k] });
    if (plan.recent) s.settings.put({ key: 'recent', value: plan.recent });
    if (plan.media) for (const m of plan.media) s.media.put(m);
  });
  await reload();
  emit('media:bg-reader');
  emit('media:bg-home');
}

/* ---------------- Pillanatképek (import előtti biztonsági mentés) ---------------- */

export async function saveSnapshot(label) {
  const snap = { id: uid('snap_'), createdAt: Date.now(), label, data: exportData() };
  const all = await getAll(db, 'snapshots');
  all.sort((a, b) => b.createdAt - a.createdAt);
  const remove = all.slice(4); // a legújabb 4 + az új = 5 marad
  await tx(db, 'snapshots', 'readwrite', (s) => {
    for (const r of remove) s.snapshots.delete(r.id);
    s.snapshots.put(snap);
  });
  return snap;
}

export async function listSnapshots() {
  const all = await getAll(db, 'snapshots');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteSnapshot(id) {
  await tx(db, 'snapshots', 'readwrite', (s) => { s.snapshots.delete(id); });
}

export function stats() {
  let favorites = 0;
  for (const s of state.songs.values()) if (s.favorite) favorites++;
  return { songs: state.songs.size, tags: state.tags.size, setlists: state.setlists.size, favorites };
}
