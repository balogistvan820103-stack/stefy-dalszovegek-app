// Hangszer-jegyzet dalonként (billentyűs hangszerekhez – Yamaha, Korg, Roland stb.):
// hangnem, tempó, style/ritmus, regisztráció (bank + gomb), rövid megjegyzés.
// Tiszta függvények (nincs DOM, nincs tároló) – a tesztek közvetlenül ezeket hívják.
// Régi dalokban nincs ilyen mező: ott egyszerűen minden üres.

import { isChord, songKey, keyPrefersFlats, noteName, notePc, transposeChord, normShift, shiftLabel } from './chords.js';

/** A jegyzetsor mezői a megjelenítés sorrendjében: [kulcs, felirat a Beállításokban] */
export const INST_FIELDS = [
  ['bank', 'Regisztráció: bank'],
  ['button', 'Regisztráció: gomb'],
  ['style', 'Style / ritmus'],
  ['key', 'Hangnem'],
  ['tempo', 'Tempó (BPM)'],
  ['memo', 'Megjegyzés'],
];
export const INST_KEYS = INST_FIELDS.map(([k]) => k);

const txt = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (v, min, max) => {
  const n = Math.round(Number(String(v ?? '').replace(',', '.')));
  return Number.isFinite(n) && n >= min && n <= max && String(v ?? '').trim() !== '' ? n : null;
};

/**
 * Bemenet egységesítése: csak a kitöltött mezők maradnak meg.
 * { key, tempo (20–400), style, bank, button (1–10), memo }
 */
export function cleanInst(v) {
  const o = v && typeof v === 'object' ? v : {};
  const out = {};
  const key = txt(o.key, 12); if (key) out.key = key;
  const tempo = int(o.tempo, 20, 400); if (tempo !== null) out.tempo = tempo;
  const style = txt(o.style, 60); if (style) out.style = style;
  const bank = txt(o.bank, 60); if (bank) out.bank = bank;
  const button = int(o.button, 1, 10); if (button !== null) out.button = button;
  const memo = txt(o.memo, 120); if (memo) out.memo = memo;
  return out;
}

export function hasInst(song) { return Object.keys(cleanInst(song?.inst)).length > 0; }

/** Magyar toldalék a gomb számához: 1-es, 3-as, 5-ös, 6-os … */
export function buttonLabel(n) {
  const suf = { 1: 'es', 2: 'es', 3: 'as', 4: 'es', 5: 'ös', 6: 'os', 7: 'es', 8: 'as', 9: 'es', 10: 'es' }[n] || 'es';
  return `${n}-${suf} gomb`;
}

/** Hangnem-javaslat az akkordok alapján (pl. „Dm”), vagy '' ha nincs akkord. Csak javaslat. */
export function suggestKey(lyrics, notation = 'hu') {
  const k = songKey(lyrics, notation);
  if (!k) return '';
  return noteName(k.pc, keyPrefersFlats(k.pc, k.minor), notation) + (k.minor ? 'm' : '');
}

/**
 * A kiírandó hangnem az eltolással: pl. „Dm” +2 → „Em”. A mentett hangnem nem változik.
 * Ha a mező nem akkordszerű (pl. „d-moll”), változatlanul marad.
 */
export function displayKey(key, shift = 0, notation = 'hu') {
  const k = String(key ?? '').trim();
  const s = normShift(shift);
  if (!k) return '';
  if (!isChord(k)) return k;
  if (!s) return transposeChord(k, 0, notation);
  const m = k.match(/^([A-H])([#♯b♭]?)(.*)$/);
  const minor = /^(m(?!aj)|min|-)/.test(m[3]);
  const target = (notePc(m[1], m[2], notation) + s + 12) % 12;
  return transposeChord(k, s, notation, keyPrefersFlats(target, minor));
}

/**
 * A jegyzetsor darabjai, csak a kitöltött és bekapcsolt mezőkkel.
 * opt: { fields: a megjelenítendő mezők kulcsai, notation: 'hu' | 'intl', shift: a dal eltolása }
 * Eltolásnál a hangnem az eltolt hangnem, mellette az eltolás (pl. „Em (+2)”); ha nincs megadott hangnem,
 * akkor is látszik az eltolás („Eltolás: +2”), hogy a hangszeren is át lehessen állítani.
 */
export function instParts(song, { fields = INST_KEYS, notation = 'hu', shift } = {}) {
  const i = cleanInst(song?.inst);
  const on = new Set(fields);
  const s = normShift(shift ?? song?.transpose);
  const out = [];
  for (const k of INST_KEYS) {
    if (!on.has(k)) continue;
    if (k === 'key') {
      if (i.key) out.push(s ? `${displayKey(i.key, s, notation)} (${shiftLabel(s)})` : displayKey(i.key, 0, notation));
      else if (s) out.push(`Eltolás: ${shiftLabel(s)}`);
    } else if (k === 'button') { if (i.button) out.push(buttonLabel(i.button)); }
    else if (k === 'tempo') { if (i.tempo) out.push(`${i.tempo} BPM`); }
    else if (i[k]) out.push(i[k]);
  }
  return out;
}

export function instLine(song, opt) { return instParts(song, opt).join(' · '); }

/** Kereshető szöveg: a style és a bank neve. */
export function instSearchText(song) {
  const i = cleanInst(song?.inst);
  return [i.style, i.bank].filter(Boolean).join(' ');
}
