// Kiválasztott fájlok azonnali, egyszeri beolvasása a memóriába.
// Androidon (főleg SD-kártyáról, a rendszer képválasztóján át) a fájl később – vagy darabokban
// olvasva – „NotReadableError”-ral elszállhat. Ezért a kiválasztás után rögtön, egyben olvassuk be,
// és minden további lépés (formátum-felismerés, megnyitás, feldolgozás) már ebből a másolatból dolgozik.

/** A fájl beolvasási hibája (pl. NotReadableError). A tech a technikai hibanév. */
export class FileReadError extends Error {
  constructor(message, tech = 'NotReadableError') {
    super(message);
    this.name = 'FileReadError';
    this.tech = tech;
  }
}

export const NOT_READABLE_IMAGE = 'Ezt a képet a böngésző nem tudta beolvasni (gyakran előfordul az SD-kártyán lévő képeknél). Próbáld a Fájlok közül kiválasztani, vagy másold át a képet a belső tárhelyre.';
export const NOT_READABLE_FILE = 'Ezt a fájlt a böngésző nem tudta beolvasni (gyakran előfordul az SD-kártyán lévő fájloknál). Próbáld a Fájlok közül kiválasztani, vagy másold át a fájlt a belső tárhelyre.';

const errName = (e) => (e && e.name && e.name !== 'Error' ? e.name : (e && e.message) || 'Error');

function viaFileReader(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new DOMException('A fájl nem olvasható.', 'NotReadableError'));
    r.onabort = () => reject(new DOMException('A beolvasás megszakadt.', 'AbortError'));
    r.readAsArrayBuffer(file);
  });
}

/**
 * A fájl beolvasása EGYSZER, egyben: file.arrayBuffer(), ha az nem megy, FileReader.
 * Visszaad: memóriabeli File-másolat (azonos név, típus, dátum, mappa-útvonal).
 * Hibánál FileReadError (message = magyar szöveg, tech = a böngésző hibaneve).
 */
export async function readFileOnce(file, { message = NOT_READABLE_FILE } = {}) {
  let buf;
  let first;
  try {
    buf = await file.arrayBuffer();
  } catch (e) {
    first = e;
    try { buf = await viaFileReader(file); } catch (e2) {
      const names = [errName(first), errName(e2)].filter((v, i, a) => a.indexOf(v) === i);
      throw new FileReadError(message, names.join(', '));
    }
  }
  const copy = new File([buf], file.name, { type: file.type, lastModified: file.lastModified });
  // mappaimportnál az almappa neve címke lesz – a relatív útvonal is kell
  if (file.webkitRelativePath) {
    try { Object.defineProperty(copy, 'webkitRelativePath', { value: file.webkitRelativePath }); } catch { /* nem baj */ }
  }
  return copy;
}

export const isReadError = (e) => e instanceof FileReadError;
