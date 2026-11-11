// „Aznap esti” állapot: lejátszott dalok és a fellépés-listák aznap esti sorrendje (vendégkérések).
// Egy „este” délután 6 órától másnap reggel 6 óráig tart, így az éjfél utáni dalok is ugyanahhoz
// az estéhez tartoznak; reggel 6 után az új nap első használatakor minden jelölés magától törlődik.
// A mentett dalok és fellépés-listák SOSEM változnak ettől.

import * as store from './store.js';

export const config = { playSeconds: 60, dayStartHour: 6 };

/** Az este azonosítója (YYYY-MM-DD): reggel 6 óráig az előző nap számít. */
export function nightKey(d = new Date()) {
  const x = new Date(d.getTime() - config.dayStartHour * 3600 * 1000);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

const empty = (date) => ({ date, played: [], order: {} });

function read() {
  const n = store.settings('night') || {};
  const key = nightKey();
  if (n.date !== key) return null; // régi este – üresnek tekintjük, írásnál felülíródik
  return n;
}

async function write(n) {
  await store.saveSettings('night', n);
}

/** Ha az elmentett este már elmúlt, törli (pl. másnap reggel az első megnyitáskor). */
export async function ensureFresh() {
  const n = store.settings('night') || {};
  const key = nightKey();
  if (n.date !== key && (n.played?.length || Object.keys(n.order || {}).length || n.date)) await write(empty(key));
}

/* ---------------- Lejátszott dalok ---------------- */

export function playedSet() { return new Set(read()?.played || []); }
export function isPlayed(songId) { return playedSet().has(songId); }
export function playedCount() { return read()?.played?.length || 0; }

export async function setPlayed(songId, on = true) {
  const n = read() || empty(nightKey());
  const set = new Set(n.played);
  if (on) set.add(songId); else set.delete(songId);
  await write({ ...n, date: nightKey(), played: [...set] });
}

/** „Új este – jelölések törlése”: a lejátszott jelölések ÉS az aznap esti sorrendek törlése. */
export async function newNight() {
  await write(empty(nightKey()));
}

/* ---------------- Aznap esti sorrend (vendégkérések) ---------------- */

/**
 * A lista aznap esti sorrendje (dal-azonosítók). Ha nincs eltérés, a mentett sorrend.
 * A mentett listán azóta történt változásokat is követi: törölt dal kimarad, új dal a végére kerül.
 */
export function tonightIds(list) {
  const saved = (list?.songIds || []).filter((id) => store.state.songs.has(id));
  const o = read()?.order?.[list?.id];
  if (!o) return saved;
  const allowed = new Set([...saved, ...(o.requested || [])]);
  const ids = [...new Set(o.ids)].filter((id) => allowed.has(id) && store.state.songs.has(id));
  for (const id of saved) if (!ids.includes(id)) ids.push(id);
  return ids;
}

export function requestedSet(listId) { return new Set(read()?.order?.[listId]?.requested || []); }
export function hasTonightOrder(listId) { return !!read()?.order?.[listId]; }

/**
 * Tiszta függvény: a dal a jelenlegi utáni helyre kerül.
 * Ha már szerepel a sorrendben, áthelyezi (nem kerül fel kétszer). Visszaad: { ids, idx, moved }
 */
export function insertNext(ids, idx, songId) {
  const out = [...ids];
  let cur = idx;
  const at = out.indexOf(songId);
  if (at === cur) return { ids: out, idx: cur, moved: false, isCurrent: true };
  if (at >= 0) { out.splice(at, 1); if (at < cur) cur--; }
  out.splice(cur + 1, 0, songId);
  return { ids: out, idx: cur, moved: at >= 0, isCurrent: false };
}

export async function setTonightOrder(list, ids, requestedId) {
  const n = read() || empty(nightKey());
  const prev = n.order?.[list.id];
  const requested = new Set(prev?.requested || []);
  if (requestedId && !list.songIds.includes(requestedId)) requested.add(requestedId);
  await write({ ...n, date: nightKey(), order: { ...(n.order || {}), [list.id]: { ids, requested: [...requested] } } });
}

export async function clearTonightOrder(listId) {
  const n = read();
  if (!n?.order?.[listId]) return;
  const order = { ...n.order };
  delete order[listId];
  await write({ ...n, order });
}
