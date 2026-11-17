// Akkordok: felismerés, transzponálás, H/B jelölés, „akkord a sor fölött” átalakítás.
// Tiszta függvények (nincs DOM) – a tesztek közvetlenül ezeket hívják.
// A tárolt formátum: az akkord szögletes zárójelben áll ott, ahol a váltás van:
//   "[Am]Csengess be [E]hozzám"
// A transzponálás SOSEM írja át az elmentett szöveget, csak a megjelenítést.

/* ---------------- Felismerés ---------------- */

// alaphang A–H, módosítójel, utána csak ismert akkord-jelölések, végül opcionális /basszushang
const CHORD_RE = /^([A-H])([#♯b♭]?)((?:maj|min|dim|aug|sus|add|M|m|\+|°|ø|-|\(|\)|[#♯b♭]|\d)*)(?:\/([A-H])([#♯b♭]?))?$/;

/** Valódi akkordnév-e (pl. Am, F#m7, Hm, Bb, Cmaj7, Gsus4, D/F#)? A [Refrén], [R], [Intro] stb. nem az. */
export function isChord(s) {
  const t = String(s ?? '').trim();
  if (!t || t.length > 16) return false;
  const m = t.match(CHORD_RE);
  if (!m) return false;
  // a zárójelek legyenek párban
  const open = (m[3].match(/\(/g) || []).length;
  const close = (m[3].match(/\)/g) || []).length;
  return open === close;
}

const BRACKET = /\[([^[\]\n]{1,16})\]/g;

/**
 * Egy sor szétbontása: { text, chords: [{ pos, name }] }
 * text – a sor szövege a [akkord] jelek nélkül (a többi zárójeles rész, pl. [Refrén], megmarad)
 * pos  – az akkord helye a text-ben (karakterindex)
 */
export function parseChordLine(raw) {
  const src = String(raw ?? '');
  let text = ''; let last = 0;
  const chords = [];
  for (const m of src.matchAll(BRACKET)) {
    if (!isChord(m[1])) continue;
    text += src.slice(last, m.index);
    chords.push({ pos: text.length, name: m[1].trim() });
    last = m.index + m[0].length;
  }
  text += src.slice(last);
  return { text, chords };
}

/** Sor összerakása szövegből és akkordokból (a parseChordLine fordítottja). */
export function buildChordLine(text, chords) {
  const sorted = chords.map((c, i) => ({ ...c, i })).sort((a, b) => (a.pos - b.pos) || (a.i - b.i));
  let out = ''; let p = 0;
  for (const c of sorted) {
    const at = Math.max(0, Math.min(text.length, c.pos));
    out += text.slice(p, at) + `[${c.name}]`;
    p = at;
  }
  return out + text.slice(p);
}

/** A sor csak akkordokból áll (pl. "[Am] [Dm] [E]")? */
export function isChordOnlyLine(raw) {
  const { text, chords } = parseChordLine(raw);
  return chords.length > 0 && !text.trim();
}

/** Akkordok eltávolítása (keresés, előnézet, kikapcsolt akkordok). A címkék ([Refrén]) megmaradnak. */
export function stripChords(text) {
  return String(text ?? '').replace(BRACKET, (all, inner) => (isChord(inner) ? '' : all));
}

export function hasChords(text) {
  for (const m of String(text ?? '').matchAll(BRACKET)) if (isChord(m[1])) return true;
  return false;
}

/** A dalban használt akkordok (első előfordulás sorrendjében, egyszer). */
export function usedChords(text) {
  const seen = new Set();
  for (const m of String(text ?? '').matchAll(BRACKET)) if (isChord(m[1])) seen.add(m[1].trim());
  return [...seen];
}

/* ---------------- Hangok és jelölés ---------------- */

const NAT = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, H: 11 };
const SHARP_ACC = /[#♯]/;
const FLAT_ACC = /[b♭]/;

/**
 * Hangnév → félhang (0 = C).
 * notation: 'hu' (magyar: H = fehér billentyű, B = a H alatti fekete) | 'intl' (nemzetközi: B = fehér, Bb = fekete)
 * A „H” mindkét jelölésben a fehér billentyű; magyar jelölésnél a „Bb” is a fekete billentyűt jelenti.
 */
export function notePc(letter, acc = '', notation = 'hu') {
  let pc;
  if (letter === 'B') {
    if (notation === 'intl') pc = 11;
    else return SHARP_ACC.test(acc) ? 11 : 10; // magyar: B = Bb = a fekete billentyű
  } else pc = NAT[letter];
  if (pc === undefined) return null;
  if (SHARP_ACC.test(acc)) pc += 1;
  else if (FLAT_ACC.test(acc)) pc -= 1;
  return (pc + 12) % 12;
}

const NAMES = {
  hu: { sharp: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'H'], flat: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'B', 'H'] },
  intl: { sharp: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'], flat: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] },
};

export function noteName(pc, flat, notation = 'hu') {
  const n = NAMES[notation === 'intl' ? 'intl' : 'hu'];
  return (flat ? n.flat : n.sharp)[((pc % 12) + 12) % 12];
}

/** A 12 alaphang a választóhoz (a hangnemekben szokásos írásmóddal). */
export function rootChoices(notation = 'hu') {
  const flatPcs = new Set([3, 8, 10]); // Eb, Ab, B/Bb – a többi feketét kereszttel
  return Array.from({ length: 12 }, (_, pc) => noteName(pc, flatPcs.has(pc), notation));
}

/** Eltolás egységesítése: -11 … +11 (12 lépés = eredeti). */
export function normShift(n) {
  const v = Math.trunc(Number(n) || 0) % 12;
  return v === 0 ? 0 : v; // a -0-t is 0-ra
}

export function shiftLabel(n) {
  const v = normShift(n);
  return v > 0 ? `+${v}` : (v < 0 ? `−${-v}` : '0');
}

function parts(name) {
  const m = String(name ?? '').trim().match(CHORD_RE);
  if (!m) return null;
  return { root: m[1], acc: m[2], suffix: m[3], bass: m[4] || '', bassAcc: m[5] || '' };
}

const isMinorSuffix = (s) => /^(m(?!aj)|min|-)/.test(s || '');

// dúr hangnemek, amelyekben bé az előjegyzés: F, B(b), Eb, Ab, Db
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1]);

/** A célhangnemben bével (true) vagy kereszttel (false) írjuk-e a hangokat. */
export function keyPrefersFlats(pc, minor) {
  if (minor) { const rel = (pc + 3) % 12; return FLAT_MAJOR.has(rel) || rel === 6; } // esz-moll bével
  return FLAT_MAJOR.has(pc);
}

/** A dal hangneme az első akkord alapján: { pc, minor } vagy null. */
export function songKey(text, notation = 'hu') {
  for (const m of String(text ?? '').matchAll(BRACKET)) {
    const p = isChord(m[1]) && parts(m[1]);
    if (p) return { pc: notePc(p.root, p.acc, notation), minor: isMinorSuffix(p.suffix) };
  }
  return null;
}

/**
 * Akkord kiírása eltolással és a választott jelöléssel.
 * flats: a célhangnem bés-e (null = döntsön az akkord maga). Eltolás nélkül
 * az eredeti írásmód (kereszt/bé) marad, csak a B/H betű követi a jelölést.
 */
export function transposeChord(name, shift = 0, notation = 'hu', flats = null) {
  const p = parts(name);
  if (!p) return String(name ?? '');
  const s = normShift(shift);
  const one = (letter, acc) => {
    const pc = notePc(letter, acc, notation);
    let flat;
    if (s === 0) flat = !SHARP_ACC.test(acc); // eredeti írásmód; módosítójel nélkül mindegy (magyar B = bé)
    else flat = flats ?? keyPrefersFlats((notePc(p.root, p.acc, notation) + s + 12) % 12, isMinorSuffix(p.suffix));
    return noteName(pc + s + 12, flat, notation);
  };
  return one(p.root, p.acc) + p.suffix + (p.bass ? `/${one(p.bass, p.bassAcc)}` : '');
}

/**
 * Megjelenítő a dal egészére: a hangnem (kereszt/bé) a dal első akkordjából és az eltolásból jön.
 * Visszaad: name => kiírandó név
 */
export function chordFormatter(text, shift = 0, notation = 'hu') {
  const s = normShift(shift);
  if (!s) return (name) => transposeChord(name, 0, notation);
  const key = songKey(text, notation);
  const flats = key ? keyPrefersFlats((key.pc + s + 12) % 12, key.minor) : null;
  return (name) => transposeChord(name, s, notation, flats);
}

/** Az akkord részei a választóhoz: { root (megjelenített név), suffix, bass } */
export function chordParts(name, notation = 'hu') {
  const p = parts(name);
  if (!p) return null;
  const root = transposeChord(p.root + p.acc, 0, notation);
  const bass = p.bass ? transposeChord(p.bass + p.bassAcc, 0, notation) : '';
  return { root, suffix: p.suffix, bass };
}

/* ---------------- „Akkord a sor fölött” → tárolási forma ---------------- */

// Magyar írásmódok kézzel írt akkordlapokon: „A-moll”, „a-moll”, „Amoll”, „A-mol”, „C-dúr”,
// „Fisz-moll”, „Cisz”, „Esz-dúr”, „Asz” … → szabványos név (Am, C, F#m, C#, Eb, Ab).
const HU_ACC = { isz: '#', is: '#', esz: 'b', es: 'b', sz: 'b', s: 'b', '#': '#', '♯': '#', b: 'b', '♭': 'b' };
const HU_NAME = /^([A-Ha-h])(isz|esz|sz|is|es|s|#|♯|b|♭)?(?:-?(moll|mol|dúr|dur))?(\d*)$/i;

/**
 * Egy kézzel írt akkord-szó szabványos neve, vagy null, ha nem akkord.
 * A sima, már szabványos neveket (Am, F#m7, D/F#) változatlanul adja vissza.
 */
export function normalizeChordToken(tok) {
  const t = String(tok ?? '').trim();
  if (isChord(t)) return t;
  const m = t.match(HU_NAME);
  if (!m) return null;
  const [, letter, acc = '', mode = '', num] = m;
  const lower = letter === letter.toLowerCase();
  const accKey = acc.toLowerCase();
  // csak akkor fogadjuk el, ha egyértelműen akkord: van „moll/dúr”, vagy magyar módosító (isz/esz/sz) nagybetűvel
  if (!mode && !(['isz', 'esz', 'sz'].includes(accKey) && !lower)) return null;
  if (lower && !mode) return null;
  if (['is', 'es', 's'].includes(accKey) && !mode) return null;
  // „Esz”, „Asz” = E-bé, A-bé („Eesz” nincs); „Hesz” helyett a magyarban B
  const out = letter.toUpperCase() + (HU_ACC[accKey] || '') + (/^mol/i.test(mode) ? 'm' : '') + num;
  return isChord(out) ? out : null;
}

const SEP_TOKEN = /^[-–—|,;.:/]+$/;
const REPEAT_TOKEN = /^\(?(?:\d+\s*[x×]|[x×]\s*\d+)\)?[.,]?$/i;
// jelölés: a zenei szavak magukban is („Intro”, „Ref.”), a többi csak ponttal/kettősponttal/zárójelben („Vers:”, „1.”)
const LABEL_TOKEN = /^(?:\(?(?:ref|refr|refrén|refren|intro|outro|közjáték|kozjatek|bridge|szóló|szolo|solo)\.?:?\)?|(?:kj|átvezetés|atvezetes|vége|vege|befejezés|befejezes|előjáték|elojatek|utójáték|utojatek|vers|versszak|\d+)(?:\.:?|:)|\((?:kj|vers|versszak|vége|vege|\d+\.?)\))$/i;
const MODE_TOKEN = /^-?(moll|mol|dúr|dur)$/i;

/**
 * Akkordsor elemzése: { chords: [{ col, name }], extras } vagy null, ha nem akkordsor.
 * Akkordsor: csak akkordokból áll, köztük lehetnek elválasztók („-”, „|”, „,”), ismétlésjel („2x”, „(x2)”)
 * és rövid jelölés („Intro:”, „Ref.:”). extras = van-e benne ismétlésjel vagy jelölés.
 * Ha nem biztos (pl. egyetlen magányos betű: „A”, „E”), nem tekinti akkordsornak.
 */
export function analyzeChordLine(line) {
  const src = expandTabs(String(line ?? ''));
  if (!src.trim() || src.includes('[') || src.includes(']')) return null;
  const chords = [];
  let extras = false;
  let seps = 0;
  for (const m of src.matchAll(/\S+/g)) {
    const raw = m[0];
    const last = chords[chords.length - 1];
    if (MODE_TOKEN.test(raw) && last && !last.moded) { // „A moll” két szóban
      const n = normalizeChordToken(`${last.raw}-${raw.replace(/^-/, '')}`);
      if (n) { last.name = n; last.moded = true; continue; }
    }
    const core = raw.replace(/[,;]+$/, '');
    const name = normalizeChordToken(core);
    if (name) { chords.push({ col: m.index, name, raw: core }); continue; }
    if (SEP_TOKEN.test(raw)) { seps++; continue; }
    if (REPEAT_TOKEN.test(raw) || LABEL_TOKEN.test(raw)) { extras = true; continue; }
    return null;
  }
  if (!chords.length) return null;
  if (chords.length === 1 && !extras && !seps && /^[A-H]$/.test(chords[0].raw)) return null;
  return { chords: chords.map(({ col, name }) => ({ col, name })), extras };
}

/** Csak akkordokból álló (zárójel nélküli) sor-e, pl. "Am      Dm    E" vagy "A-moll - C - E (2x)". */
export function isPlainChordLine(line) {
  return analyzeChordLine(line) !== null;
}

const expandTabs = (s) => {
  let out = '';
  for (const ch of s) out += ch === '\t' ? ' '.repeat(8 - (out.length % 8)) : ch;
  return out;
};

/** Egy akkordsor elhelyezése az alatta lévő szövegsorban: minden akkord a fölötte lévő szóhoz kerül. */
export function mergeChordLine(chordLine, textLine) {
  let text = expandTabs(textLine);
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ s: m.index, e: m.index + m[0].length }));
  const used = new Set();
  const chords = [];
  for (const { col, name } of analyzeChordLine(chordLine)?.chords || []) {
    let pos;
    const w = words.find((x) => col >= x.s && col < x.e) || words.find((x) => x.s > col);
    if (!w) pos = -1; // a sor vége után
    else if (!used.has(w.s)) { pos = w.s; used.add(w.s); } else pos = Math.max(w.s, Math.min(col, w.e - 1));
    chords.push({ pos, name });
  }
  if (chords.some((c) => c.pos < 0)) {
    if (text && !/\s$/.test(text)) text += ' ';
    for (const c of chords) if (c.pos < 0) c.pos = text.length;
  }
  return buildChordLine(text, chords);
}

/**
 * Akkordsor átalakítása szöveg nélkül: "Am   Dm  E" → "[Am] [Dm] [E]".
 * Az ismétlésjel és a jelölés megmarad: "Intro: G C (2x)" → "Intro: [G] [C] (2x)"; az elválasztók elmaradnak.
 */
export function bracketChordLine(chordLine) {
  const a = analyzeChordLine(chordLine);
  if (!a) return String(chordLine ?? '');
  const out = [];
  const src = expandTabs(String(chordLine));
  const byCol = new Map(a.chords.map((c) => [c.col, c.name]));
  let skipMode = false;
  for (const m of src.matchAll(/\S+/g)) {
    if (byCol.has(m.index)) { out.push(`[${byCol.get(m.index)}]`); skipMode = true; continue; }
    if (skipMode && MODE_TOKEN.test(m[0])) { skipMode = false; continue; } // a „moll” már a névben van
    skipMode = false;
    if (SEP_TOKEN.test(m[0])) continue;
    out.push(m[0]);
  }
  return out.join(' ');
}

/**
 * A teljes dal átalakítása. Visszaad: { text, changes: [{ line, before, after }] }
 * Az akkordsort az alatta álló szövegsorral vonja össze; ha alatta nincs szövegsor,
 * akkord-sorrá alakítja ("[Am] [Dm]"). Ha a szövegsorban már vannak [akkordok], nem nyúl hozzá.
 */
export function convertChordLines(text) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  const changes = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const a = analyzeChordLine(l);
    if (!a) { out.push(l); continue; }
    const next = lines[i + 1];
    // ismétlésjeles / jelöléses sor („Intro: G C”, „G C (2x)”) külön akkordsor marad, nem olvad a szövegbe
    const nextIsText = !a.extras && next !== undefined && next.trim() && !isPlainChordLine(next) && !hasChords(next)
      && !/^\s*\[[^\]]*\]\s*$/.test(next);
    if (nextIsText) {
      const merged = mergeChordLine(l, next);
      changes.push({ line: i, before: `${l}\n${next}`, after: merged });
      out.push(merged);
      i++;
    } else {
      const row = bracketChordLine(l);
      changes.push({ line: i, before: l, after: row });
      out.push(row);
    }
  }
  return { text: out.join('\n'), changes };
}
