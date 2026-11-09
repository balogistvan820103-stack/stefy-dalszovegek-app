// TXT-fájlok tömeges importja (több fájl vagy teljes mappa almappákkal).
// A fájlnévből lesz a dal címe, a tartalomból a dalszöveg, az almappa neve címke lesz.

import * as backup from './backup.js';
import * as store from './store.js';
import { uid, norm, esc, toast, modal } from './util.js';
import { tile } from './icons.js';
import { DOC_EXT, documentToText } from './docread.js';

// TXT + Word (docx, doc) + OpenDocument + RTF; a MIME-típusok az Android fájlválasztó miatt kellenek
const ACCEPT = '.txt,.docx,.doc,.odt,.rtf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,application/rtf,text/rtf';

const isTxt = (f) => /\.txt$/i.test(f.name) || (f.type === 'text/plain' && !/\.[^./]+$/.test(f.name));
const isDoc = (f) => DOC_EXT.test(f.name);
const isTempFile = (f) => /^~\$/.test(f.name) || /^\._/.test(f.name); // Word zárolófájl, macOS-melléktermék

export const folderPickSupported = (() => {
  try { return 'webkitdirectory' in document.createElement('input'); } catch { return false; }
})();

/** Fájlválasztó több fájlhoz vagy mappához. Visszaad: File[] (üres, ha megszakították). */
export function pickMany({ folder = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (folder) { input.webkitdirectory = true; input.setAttribute('webkitdirectory', ''); }
    else input.accept = ACCEPT;
    input.style.display = 'none';
    const done = (files) => { resolve(files); input.remove(); };
    input.addEventListener('change', () => done(Array.from(input.files || [])), { once: true });
    input.addEventListener('cancel', () => done([]), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/** Kódolás felismerése: UTF-8, különben Windows-1250 (régi magyar Windows-os szövegfájlok). */
export async function decodeText(file) {
  const buf = await file.arrayBuffer();
  let bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try { return new TextDecoder('windows-1250').decode(bytes); } catch { return new TextDecoder('latin1').decode(bytes); }
  }
}

export function titleFromName(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Névtelen dal';
}

/**
 * Fájlok beolvasása importálható adattá.
 * Visszaad: { data, summary, skippedFiles[] }
 */
export async function readTxtFiles(files) {
  // .txt, Word (.docx/.doc), .odt, .rtf – vagy kiterjesztés nélküli szövegfájl
  const txt = files.filter((f) => !isTempFile(f) && (isTxt(f) || isDoc(f)));
  const skippedFiles = files.filter((f) => !txt.includes(f)).map((f) => f.webkitRelativePath || f.name);
  const tagsByName = new Map();
  const songs = [];
  const errors = [];
  let order = 0;
  // ABC-sorrendben (mappán belül is), hogy kiszámítható legyen
  txt.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, 'hu'));
  for (const f of txt) {
    try {
      const doc = isDoc(f);
      if (f.size > (doc ? 30 : 2) * 1024 * 1024) { errors.push(`${f.name}: túl nagy`); continue; }
      let text = (doc ? await documentToText(f, decodeText) : await decodeText(f)).replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '');
      if (!text.trim()) { errors.push(`${f.name}: üres dokumentum, kimarad`); continue; }
      const title = titleFromName(f.name);
      // ha a szöveg első sora maga a cím, azt nem duplázzuk
      const lines = text.split('\n');
      if (lines.length > 1 && norm(lines[0].trim()) === norm(title)) text = lines.slice(1).join('\n');
      const tagIds = [];
      const parts = (f.webkitRelativePath || '').split('/').slice(1, -1); // a gyökérmappa nem címke
      for (const p of parts) {
        const name = p.trim();
        if (!name) continue;
        const key = norm(name);
        if (!tagsByName.has(key)) tagsByName.set(key, { id: uid('t_'), name, color: store.TAG_COLORS[tagsByName.size % store.TAG_COLORS.length], createdAt: Date.now() });
        tagIds.push(tagsByName.get(key).id);
      }
      const now = Date.now();
      songs.push({ id: uid('s_'), title, artist: '', lyrics: store.cleanLyrics(text), tagIds, favorite: false, order: ++order, createdAt: now, updatedAt: now, lastOpenedAt: null });
    } catch (e) {
      errors.push(`${f.name}: ${e.message || 'nem olvasható'}`);
    }
  }
  const tags = [...tagsByName.values()];
  const data = { songs, tags, setlists: [], settings: null, recent: null, media: [] };
  const plan = songs.length ? backup.planImport(data, 'append') : null;
  return {
    data,
    errors,
    skippedFiles,
    summary: {
      files: files.length,
      txt: txt.length,
      newSongs: plan ? plan.result.songsAdded : 0,
      duplicates: plan ? plan.result.songsSkipped : 0,
      newTags: plan ? plan.result.tagsAdded : 0,
      tagNames: tags.map((t) => t.name),
      sample: songs.slice(0, 6).map((s) => s.title),
    },
  };
}

export async function applyTxtImport(data) {
  return backup.applyImport(data, 'append');
}

/** Teljes folyamat: fájlválasztás → előnézet → import. Igazat ad vissza, ha történt import. */
export async function txtImportFlow({ folder = false } = {}) {
  if (folder && !folderPickSupported) {
    toast('Ez a böngésző nem tud mappát megnyitni. Használd a „Fájlok tömeges importálása” gombot, és jelöld ki egyszerre az összes dalfájlt.', 'error', 7000);
    return false;
  }
  const files = await pickMany({ folder });
  if (!files.length) return false;
  toast(`${files.length} fájl beolvasása…`, 'info', 1500);
  let res;
  try { res = await readTxtFiles(files); } catch (e) {
    toast(`A fájlok beolvasása nem sikerült: ${e.message}`, 'error', 6000);
    return false;
  }
  const s = res.summary;
  if (!s.txt) {
    await modal({ title: 'Nincs importálható fájl', body: '<p>A kiválasztott helyen nem találtam .txt fájlt. A meglévő adataid nem változtak.</p>', buttons: [{ label: 'Rendben', value: true, kind: 'primary' }] });
    return false;
  }
  const body = `
    <div class="import-summary">
      <div class="sum-grid">
        <span>${tile('folder', 'orange', 'tile-sm')} <b>${s.txt}</b> dalfájl</span>
        <span>${tile('songs', 'blue', 'tile-sm')} <b>${s.newSongs}</b> új dal</span>
        <span>${tile('copy', 'teal', 'tile-sm')} <b>${s.duplicates}</b> már megvan</span>
        <span>${tile('tag', 'pink', 'tile-sm')} <b>${s.newTags}</b> új címke</span>
      </div>
      ${s.tagNames.length ? `<p class="small">Az almappák nevéből címke lesz: ${s.tagNames.slice(0, 12).map(esc).join(', ')}${s.tagNames.length > 12 ? '…' : ''}</p>` : ''}
      ${s.sample.length ? `<p class="muted small">Például: ${s.sample.map(esc).join(', ')}…</p>` : ''}
      ${res.skippedFiles.length ? `<p class="muted small">${res.skippedFiles.length} nem támogatott fájl (pl. kép) kimarad.</p>` : ''}
      ${res.errors.length ? `<p class="warn-text small">${res.errors.slice(0, 5).map(esc).join('<br>')}</p>` : ''}
      <p class="muted small">A dal címe a fájl neve lesz, a szövege a fájl tartalma. A teljesen azonos dalok nem kerülnek be újra. Import előtt automatikus pillanatkép készül.</p>
    </div>`;
  const ok = await modal({
    title: 'Import előnézet',
    body,
    wide: true,
    buttons: [{ label: 'Mégse', value: false, kind: 'ghost' }, { label: `${s.newSongs} dal importálása`, value: true, kind: 'primary' }],
  });
  if (ok !== true) return false;
  if (!s.newSongs) { toast('Minden dal megvolt már – nem történt változás.', 'info'); return false; }
  try {
    const r = await applyTxtImport(res.data);
    toast(`Import kész: ${r.songsAdded} új dal${r.songsSkipped ? `, ${r.songsSkipped} már megvolt` : ''}${r.tagsAdded ? `, ${r.tagsAdded} új címke` : ''}.`, 'success', 6000);
    return true;
  } catch (e) {
    await modal({ title: 'Az import nem sikerült', body: `<p class="err-text">${esc(e.message)}</p><p class="muted">A meglévő adataid nem változtak.</p>`, buttons: [{ label: 'Rendben', value: true, kind: 'primary' }] });
    return false;
  }
}
