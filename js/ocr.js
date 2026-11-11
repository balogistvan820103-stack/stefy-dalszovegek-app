// Szövegfelismerés (OCR) teljesen a készüléken: Tesseract + magyar „pontos” nyelvi csomag.
// Minden szükséges fájl a vendor/tesseract mappából töltődik (nincs külső szerver),
// és a service worker elmenti őket, így internet nélkül is működik.

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
export const OCR_FILES = [
  'tesseract.min.js',
  'worker.min.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'lang/hun.traineddata.gz',
].map((f) => BASE + f);

let libPromise = null;
let workerPromise = null;
let progressCb = null;

function loadLib() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = BASE + 'tesseract.min.js';
      s.onload = () => (globalThis.Tesseract ? resolve(globalThis.Tesseract) : reject(new Error('A szövegfelismerő nem töltődött be.')));
      s.onerror = () => { libPromise = null; reject(new Error('A szövegfelismerő fájljai nem érhetők el. Első használatkor internet kell a letöltésükhöz.')); };
      document.head.appendChild(s);
    });
  }
  return libPromise;
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const T = await loadLib();
      return T.createWorker('hun', 1, {
        workerPath: BASE + 'worker.min.js',
        corePath: BASE,
        langPath: BASE + 'lang',
        gzip: true,
        workerBlobURL: false,
        cacheMethod: 'none', // a service worker tárolja, nem kell még egy másolat
        logger: (m) => {
          if (!progressCb) return;
          if (m.status === 'recognizing text') progressCb(0.25 + 0.75 * (m.progress || 0), 'Szöveg felismerése…');
          else progressCb(0.05 + 0.2 * (m.progress || 0), 'Felismerő előkészítése…');
        },
        errorHandler: (e) => console.warn('OCR:', e),
      });
    })().catch((e) => {
      workerPromise = null;
      throw new Error(navigator.onLine === false
        ? 'A szövegfelismerő még nincs letöltve erre a készülékre. Egyszer internetkapcsolattal kell megnyitni, utána offline is működik.'
        : `A szövegfelismerő nem indult el: ${e?.message || e}`);
    });
  }
  return workerPromise;
}

/** A felismert nyers szöveg rendbetétele (sorvégek, fölös szóközök, tipikus ékezet-melléfogások). */
export function cleanOcrText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/[õô]/g, 'ő').replace(/[ÕÔ]/g, 'Ő').replace(/[ûũ]/g, 'ű').replace(/[ÛŨ]/g, 'Ű')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
}

/**
 * Sorok összerakása a helyzetük alapján: üres sor (versszakhatár) csak oda kerül,
 * ahol a sorköz érezhetően nagyobb a szokásosnál – ritka sorközű lapnál sem lesz
 * minden sor után üres sor.
 */
export function textFromLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) return '';
  const ls = lines.map((l) => ({ text: String(l.text || '').replace(/\s+$/, ''), top: l.bbox?.y0, bottom: l.bbox?.y1 }))
    .filter((l) => l.text.trim() && Number.isFinite(l.top));
  if (ls.length < 2) return '';
  const steps = [];
  for (let i = 1; i < ls.length; i++) steps.push(ls[i].top - ls[i - 1].top);
  const pos = steps.filter((s) => s > 0).sort((a, b) => a - b);
  if (!pos.length) return '';
  // a jellemző sortávolság: az alsó harmad közepe (a versszakközök ne húzzák fel)
  const typical = pos[Math.floor(pos.length / 3)] || pos[0];
  let out = ls[0].text;
  for (let i = 1; i < ls.length; i++) out += (steps[i - 1] > typical * 1.5 ? '\n\n' : '\n') + ls[i].text;
  return out;
}

/** Első nem üres sor = javasolt cím; a többi a dalszöveg. */
export function splitTitle(text) {
  const lines = cleanOcrText(text).split('\n');
  const i = lines.findIndex((l) => l.trim());
  if (i < 0) return { title: '', rest: '', full: '' };
  const title = lines[i].trim().replace(/^[\d.\s)\-–—]+(?=\p{L})/u, '').replace(/[.:,;\s]+$/, '').slice(0, 200);
  return { title, rest: lines.slice(i + 1).join('\n').replace(/^\n+/, ''), full: lines.join('\n') };
}

/**
 * Kép (canvas vagy Blob) → szöveg. onProgress(0..1, felirat)
 * Visszaad: { text, confidence }
 */
export async function recognize(image, onProgress) {
  progressCb = onProgress || null;
  try {
    onProgress?.(0.02, 'Felismerő indítása…');
    const worker = await getWorker();
    const { data } = await worker.recognize(image);
    onProgress?.(1, 'Kész');
    return { text: cleanOcrText(textFromLines(data.lines) || data.text), confidence: Math.round(data.confidence || 0) };
  } finally {
    progressCb = null;
  }
}

/** Memória felszabadítása (pl. a fotózó képernyő elhagyásakor). */
export async function shutdown() {
  const p = workerPromise;
  workerPromise = null;
  if (p) { try { (await p).terminate(); } catch { /* */ } }
}

/** Le van-e már mentve minden a kapcsolat nélküli használathoz? */
export async function offlineReady() {
  if (!('caches' in globalThis)) return false;
  try {
    for (const url of OCR_FILES) if (!(await caches.match(url))) return false;
    return true;
  } catch { return false; }
}

/** Hiányzó fájlok letöltése az offline tárolóba (a service worker menti el őket). */
export async function prefetch(onProgress) {
  let done = 0;
  for (const url of OCR_FILES) {
    if (!(await caches.match(url).catch(() => null))) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('A letöltés nem sikerült.');
      await res.arrayBuffer();
    }
    onProgress?.(++done / OCR_FILES.length);
  }
  return offlineReady();
}
