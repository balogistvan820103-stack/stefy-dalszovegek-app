// Háttérképek előkészítése: a fájl fejlécének felismerése, kicsinyített megnyitás, JPEG-be tömörítés,
// és érthető magyar hibaüzenetek (a valódi okkal + a technikai hibanévvel).
// Nincs külső könyvtár: amit a böngésző nem tud megnyitni (pl. HEIC, RAW), arra tanácsot adunk.
// A processImage a kiválasztáskor már egyszer beolvasott, memóriabeli másolatot kapja (fileread.js).

import { NOT_READABLE_IMAGE } from './fileread.js';

/** Hiba, amelynek az üzenete már magyar, a felhasználónak szól; a tech a technikai hibanév. */
export class ImageError extends Error {
  constructor(message, tech = '') {
    super(message);
    this.name = 'ImageError';
    this.tech = tech;
  }
}

const RAW_EXT = ['dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'orf', 'rw2', 'raf', 'pef', 'srw', 'x3f', 'raw', 'rwl', '3fr', 'erf', 'kdc', 'mrw', 'iiq'];
const HEIC_EXT = ['heic', 'heif', 'hif'];

// Ennyi megapixel fölött egy sikertelen megnyitás oka szinte biztosan a memória.
const BIG_MP = 40;

const ext = (name) => String(name || '').toLowerCase().split('.').pop();
const ascii = (b, from, len) => String.fromCharCode(...b.subarray(from, from + len));

async function readBytes(file, start, len) {
  const buf = await file.slice(start, start + len).arrayBuffer();
  return new Uint8Array(buf);
}

/** EXIF tájolás (1–8) egy APP1 „Exif” szegmens tartalmából. */
function exifOrientation(b) {
  if (b.length < 14 || ascii(b, 0, 4) !== 'Exif') return 1;
  const t = 6; // a TIFF-fejléc kezdete
  const le = b[t] === 0x49; // 'II' = little-endian
  const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  const ifd = t + u32(t + 4);
  if (ifd + 2 > b.length) return 1;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 10 > b.length) break;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

async function sniffJpeg(file) {
  let pos = 2;
  let orientation = 1;
  // a szegmenseken lépkedünk (csak a fejléceket olvassuk be, a képadatot nem)
  for (let guard = 0; guard < 400 && pos < file.size; guard++) {
    const h = await readBytes(file, pos, 4);
    if (h.length < 4 || h[0] !== 0xff) break;
    const m = h[1];
    if (m === 0xff) { pos += 1; continue; } // kitöltő bájt
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { pos += 2; continue; }
    if (m === 0xd9 || m === 0xda) break; // kép vége / képadat kezdete
    const len = (h[2] << 8) | h[3];
    if (len < 2) break;
    if (m === 0xe1 && orientation === 1) {
      orientation = exifOrientation(await readBytes(file, pos + 4, Math.min(len - 2, 65536)));
    }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const f = await readBytes(file, pos + 4, 6);
      return { format: 'jpeg', height: (f[1] << 8) | f[2], width: (f[3] << 8) | f[4], orientation };
    }
    pos += 2 + len;
  }
  return { format: 'jpeg', width: 0, height: 0, orientation };
}

/**
 * A kép formátumának és (tájolás szerinti) méretének megállapítása a fájl fejlécéből –
 * a kép megnyitása nélkül, így egy 200 megapixeles fotónál is csak néhány kilobájtot olvas.
 * Visszaad: { format, width, height, orientation } (ismeretlen méretnél 0).
 */
export async function sniffImage(file) {
  const b = await readBytes(file, 0, 64);
  const e = ext(file.name);
  let r = { format: 'unknown', width: 0, height: 0, orientation: 1 };
  const be32 = (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const le16 = (o) => b[o] | (b[o + 1] << 8);
  const le32 = (o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) | 0;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    r = await sniffJpeg(file);
  } else if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') {
    r = { format: 'png', width: be32(16), height: be32(20), orientation: 1 };
  } else if (b.length >= 10 && ascii(b, 0, 3) === 'GIF') {
    r = { format: 'gif', width: le16(6), height: le16(8), orientation: 1 };
  } else if (b.length >= 26 && ascii(b, 0, 2) === 'BM') {
    r = { format: 'bmp', width: Math.abs(le32(18)), height: Math.abs(le32(22)), orientation: 1 };
  } else if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const c = ascii(b, 12, 4);
    if (c === 'VP8 ') r = { format: 'webp', width: le16(26) & 0x3fff, height: le16(28) & 0x3fff, orientation: 1 };
    else if (c === 'VP8L') {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      r = { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, orientation: 1 };
    } else if (c === 'VP8X') {
      r = { format: 'webp', width: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, height: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1, orientation: 1 };
    } else r = { format: 'webp', width: 0, height: 0, orientation: 1 };
  } else if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brands = ascii(b, 8, Math.min(b.length - 8, Math.max(8, be32(0) - 8)));
    if (/avi[fs]/.test(brands)) r.format = 'avif';
    else if (/crx /.test(brands)) r.format = 'raw';
    else if (/hei[cxms]|hev[cx]|mif1|msf1/.test(brands)) r.format = 'heic';
  } else if (b.length >= 4 && ((ascii(b, 0, 2) === 'II' && (b[2] === 0x2a || b[2] === 0x55 || ascii(b, 2, 2) === 'RO')) || (ascii(b, 0, 2) === 'MM' && b[3] === 0x2a))) {
    r.format = RAW_EXT.includes(e) ? 'raw' : 'tiff';
  } else if (ascii(b, 0, 8) === 'FUJIFILM') {
    r.format = 'raw';
  }
  if (r.format === 'unknown') {
    if (HEIC_EXT.includes(e)) r.format = 'heic';
    else if (RAW_EXT.includes(e)) r.format = 'raw';
  }
  // 5–8: a fotó 90°-kal elforgatva van tárolva → a megjelenített szélesség/magasság felcserélődik
  if (r.orientation >= 5 && r.width && r.height) r = { ...r, width: r.height, height: r.width };
  return r;
}

const TO_JPG = 'Tipp: nyisd meg a képet a telefon galériájában, és mentsd el / oszd meg JPG-ként (vagy készíts róla képernyőképet), majd azt válaszd ki.';

function unsupportedError(format, tech) {
  if (format === 'heic') {
    return new ImageError(`A kép HEIC formátumú (iPhone- és egyes Android-fotók), ezt ez a böngésző nem tudja megnyitni. ${TO_JPG}`, tech || 'HEIC');
  }
  if (format === 'raw') {
    return new ImageError(`A kép RAW (nyers, profi fényképezőgépes) formátumú, ezt a böngésző nem tudja megnyitni. Alakítsd át JPG-vé a galériában vagy egy képszerkesztőben, és azt válaszd ki.`, tech || 'RAW');
  }
  if (format === 'tiff' || format === 'avif') {
    return new ImageError(`A kép ${format.toUpperCase()} formátumú, ezt ez a böngésző nem tudja megnyitni. ${TO_JPG}`, tech || format.toUpperCase());
  }
  return new ImageError('A képet nem sikerült megnyitni: lehet, hogy sérült, vagy nem kép. Válassz JPG, PNG vagy WEBP formátumú képet.', tech || 'unknown-format');
}

function tooBigError(mp, tech) {
  const size = mp ? ` (kb. ${Math.round(mp)} megapixeles)` : '';
  return new ImageError(`A kép túl nagy felbontású${size}, a készülék memóriája nem elég a megnyitásához. Kicsinyítsd le a galériában vagy egy képszerkesztőben (vagy készíts róla képernyőképet), és azt válaszd ki.`, tech || 'out-of-memory');
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(Object.assign(new Error('decode'), { name: 'EncodingError' })); };
    img.src = url;
  });
}

const errName = (e) => (e && (e.name && e.name !== 'Error' ? e.name : e.message)) || 'Error';

/**
 * A kép megnyitása – lehetőleg már kicsinyítve, hogy a nagy felbontású (50–200 MP-es, panoráma)
 * fotók se fogyasszák el a tablet memóriáját. Visszaad: { source, w, h, cleanup }.
 */
async function decode(file, info, maxSide) {
  const errors = [];
  const hasBitmap = typeof createImageBitmap === 'function';
  if (hasBitmap && info.width && info.height) {
    const scale = Math.min(1, maxSide / Math.max(info.width, info.height));
    const tw = Math.max(1, Math.round(info.width * scale));
    const th = Math.max(1, Math.round(info.height * scale));
    for (const [rw, rh] of [[tw, th], [th, tw]]) {
      try {
        const bmp = await createImageBitmap(file, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high' });
        if (bmp.width === tw && bmp.height === th) return { source: bmp, w: tw, h: th, cleanup: () => bmp.close?.() };
        // A böngésző a kicsinyítést a tájolás (EXIF) alkalmazása előtt végezte → a második
        // körben felcserélt méretekkel kérjük. Ha a kicsinyítést figyelmen kívül hagyta, a
        // teljes méretű képet használjuk.
        if (bmp.width === th && bmp.height === tw && th !== tw) { bmp.close?.(); continue; }
        return { source: bmp, w: bmp.width, h: bmp.height, cleanup: () => bmp.close?.() };
      } catch (e) { errors.push(e); break; }
    }
  }
  if (hasBitmap) {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, w: bmp.width, h: bmp.height, cleanup: () => bmp.close?.() };
    } catch (e) { errors.push(e); }
  }
  try {
    const { img, url } = await loadImageElement(file);
    return { source: img, w: img.naturalWidth, h: img.naturalHeight, cleanup: () => URL.revokeObjectURL(url) };
  } catch (e) { errors.push(e); }
  const err = new Error('decode');
  err.tech = errors.map(errName).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'EncodingError';
  throw err;
}

/**
 * Kép ellenőrzése és előkészítése (legfeljebb maxSide px, JPEG). Hibánál ImageError-t dob
 * magyar üzenettel – a hívó ilyenkor NEM módosítja a korábbi képet.
 */
export async function processImage(file, maxSide = 2400) {
  if (!file) throw new ImageError('Nem választottál ki képet.', 'no-file');
  if (file.size === 0) throw new ImageError('A kiválasztott kép üres vagy sérült (0 bájt).', 'empty-file');
  let info;
  try { info = await sniffImage(file); } catch (e) {
    throw new ImageError(NOT_READABLE_IMAGE, errName(e));
  }
  if (info.format === 'unknown' && file.type && !file.type.startsWith('image/')) {
    throw new ImageError('A kiválasztott fájl nem kép. Válassz JPG, PNG vagy WEBP formátumú képet.', file.type);
  }
  const mp = (info.width * info.height) / 1e6;
  let d;
  try {
    d = await decode(file, info, maxSide);
  } catch (e) {
    if (['heic', 'raw', 'tiff', 'avif'].includes(info.format)) throw unsupportedError(info.format, `${info.format.toUpperCase()} · ${e.tech}`);
    if (mp >= BIG_MP || /memory|RangeError/i.test(e.tech || '')) throw tooBigError(mp, e.tech);
    throw unsupportedError(info.format, e.tech);
  }
  try {
    if (!d.w || !d.h) throw new ImageError('A kép mérete érvénytelen (0 képpont) – valószínűleg sérült a fájl.', 'zero-size');
    const scale = Math.min(1, maxSide / Math.max(d.w, d.h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(d.w * scale));
    canvas.height = Math.max(1, Math.round(d.h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw tooBigError(mp, 'canvas-context');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    try {
      ctx.drawImage(d.source, 0, 0, canvas.width, canvas.height);
    } catch (e) {
      throw (mp >= BIG_MP ? tooBigError(mp, errName(e)) : new ImageError('A kép feldolgozása nem sikerült – valószínűleg sérült. Próbálj másik képet.', errName(e)));
    }
    d.cleanup();
    d.cleanup = () => {};
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    canvas.width = canvas.height = 0; // a memória azonnali felszabadítása (főleg iPaden fontos)
    if (!blob || blob.size < 100) throw tooBigError(mp, 'toBlob-null');
    return blob;
  } finally {
    d.cleanup();
  }
}

/**
 * Bármilyen háttérkép-hiba (megnyitás vagy mentés) felhasználónak szóló, magyar szövege.
 * Visszaad: { text, tech }.
 */
export function describeImageError(err) {
  if (err instanceof ImageError || err?.name === 'FileReadError') return { text: err.message, tech: err.tech };
  const name = errName(err);
  if (/quota/i.test(`${err?.name} ${err?.message}`)) {
    return { text: 'Kevés a szabad hely a készüléken, ezért a képet nem sikerült elmenteni. Szabadíts fel helyet (pl. törölj régi fotókat, videókat vagy nem használt alkalmazásokat), és próbáld újra.', tech: name };
  }
  return { text: `A háttérkép beállítása nem sikerült. ${err?.message && !/^[A-Za-z]/.test(err.message) ? err.message : 'Próbáld újra, vagy válassz másik képet.'}`, tech: name };
}
