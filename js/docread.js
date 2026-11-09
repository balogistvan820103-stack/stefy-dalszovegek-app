// Szöveg kinyerése dokumentumfájlokból – teljesen helyben, internet és külső könyvtár nélkül.
// Támogatott: Word (.docx), régi Word 97–2003 (.doc), OpenDocument (.odt), Rich Text (.rtf).

export const DOC_EXT = /\.(docx|docm|doc|odt|rtf)$/i;

export class DocError extends Error {}

/* ---------------- ZIP (docx, odt) ---------------- */

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new DocError('Ez a böngésző túl régi a Word-fájlok kicsomagolásához. Frissítsd a Chrome-ot.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzipEntry(buf, wanted) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new DocError('A fájl sérült vagy nem Word-dokumentum.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= u8.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name !== wanted) continue;
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = u8.subarray(start, start + csize);
    if (method === 0) return data;
    if (method === 8) return inflateRaw(data);
    throw new DocError('Nem támogatott tömörítés a dokumentumban.');
  }
  return null;
}

function parseXml(bytes) {
  const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(bytes), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new DocError('A dokumentum belső szerkezete hibás.');
  return doc;
}

/** DOCX: word/document.xml bekezdései, sortörései, tabulátorai. */
export async function docxToText(buf) {
  const xml = await unzipEntry(buf, 'word/document.xml');
  if (!xml) throw new DocError('Ez nem Word (.docx) dokumentum, vagy sérült.');
  const doc = parseXml(xml);
  const body = doc.getElementsByTagNameNS('*', 'body')[0] || doc.documentElement;
  const out = [];
  const walk = (node, line) => {
    for (const ch of node.childNodes) {
      if (ch.nodeType !== 1) continue;
      const ln = ch.localName;
      if (ln === 'Fallback' || ln === 'delText' || ln === 'instrText' || ln === 'footnoteReference') continue;
      if (ln === 't') line.push(ch.textContent);
      else if (ln === 'tab') line.push('\t');
      else if (ln === 'br' || ln === 'cr') line.push('\n');
      else if (ln === 'noBreakHyphen') line.push('-');
      else if (ln === 'p') { const l = []; walk(ch, l); if (line === out) out.push(l.join('')); else line.push(l.join(''), '\n'); }
      else walk(ch, line);
    }
  };
  walk(body, out);
  return out.join('\n');
}

/** ODT: content.xml */
export async function odtToText(buf) {
  const xml = await unzipEntry(buf, 'content.xml');
  if (!xml) throw new DocError('Ez nem OpenDocument (.odt) dokumentum, vagy sérült.');
  const doc = parseXml(xml);
  const out = [];
  const walk = (node, line) => {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) { line.push(ch.nodeValue); continue; }
      if (ch.nodeType !== 1) continue;
      const ln = ch.localName;
      if (ln === 'p' || ln === 'h') { const l = []; walk(ch, l); if (line === out) out.push(l.join('')); else line.push(l.join(''), '\n'); }
      else if (ln === 'line-break') line.push('\n');
      else if (ln === 'tab') line.push('\t');
      else if (ln === 's') line.push(' '.repeat(Number(ch.getAttribute('text:c') || ch.getAttributeNS('*', 'c') || 1)));
      else if (ln === 'annotation' || ln === 'note') continue;
      else walk(ch, line);
    }
  };
  const text = doc.getElementsByTagNameNS('*', 'text')[0];
  const root = text && text.localName === 'text' && text.parentNode?.localName === 'body' ? text : (doc.getElementsByTagNameNS('*', 'body')[0] || doc.documentElement);
  walk(root, out);
  return out.join('\n');
}

/* ---------------- RTF ---------------- */

export function rtfToText(src) {
  if (!src.startsWith('{\\rtf')) throw new DocError('Ez nem RTF-dokumentum.');
  let cp = 'windows-1250';
  const ansicpg = src.match(/\\ansicpg(\d+)/);
  if (ansicpg) cp = `windows-${ansicpg[1]}`;
  let dec;
  try { dec = new TextDecoder(cp); } catch { dec = new TextDecoder('windows-1252'); }
  const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'fldinst', 'object', 'filetbl', 'revtbl', 'mmathPr']);
  const out = [];
  const stack = [];
  let skip = false; let uc = 1; let pendingSkip = 0; let bytes = [];
  const flush = () => { if (bytes.length) { out.push(dec.decode(new Uint8Array(bytes))); bytes = []; } };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { stack.push({ skip, uc }); continue; }
    if (c === '}') { flush(); const s = stack.pop(); if (s) { skip = s.skip; uc = s.uc; } continue; }
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?|^\\'([0-9a-fA-F]{2})|^\\(.)/.exec(src.slice(i, i + 40));
      if (!m) continue;
      i += m[0].length - 1;
      if (m[3]) { if (pendingSkip > 0) { pendingSkip--; continue; } if (!skip) bytes.push(parseInt(m[3], 16)); continue; }
      if (m[4]) {
        if (m[4] === '*') { skip = true; continue; }
        if (!skip) { flush(); if (m[4] === '~') out.push(' '); else if (m[4] === '-') { /* feltételes elválasztás */ } else if (m[4] === '_') out.push('-'); else if ('\\{}'.includes(m[4])) out.push(m[4]); else if (m[4] === '\n' || m[4] === '\r') out.push('\n'); }
        continue;
      }
      const word = m[1]; const arg = m[2] !== undefined ? Number(m[2]) : null;
      if (SKIP.has(word)) { skip = true; continue; }
      if (skip) continue;
      flush();
      if (word === 'par' || word === 'line' || word === 'sect' || word === 'row') out.push('\n');
      else if (word === 'tab' || word === 'cell') out.push('\t');
      else if (word === 'emdash') out.push('—');
      else if (word === 'endash') out.push('–');
      else if (word === 'lquote') out.push('‘');
      else if (word === 'rquote') out.push('’');
      else if (word === 'ldblquote') out.push('„');
      else if (word === 'rdblquote') out.push('”');
      else if (word === 'bullet') out.push('•');
      else if (word === 'uc' && arg !== null) uc = arg;
      else if (word === 'u' && arg !== null) { out.push(String.fromCharCode(arg < 0 ? arg + 65536 : arg)); pendingSkip = uc; }
      continue;
    }
    if (c === '\r' || c === '\n') continue;
    if (skip) continue;
    if (pendingSkip > 0) { pendingSkip--; continue; }
    bytes.push(c.charCodeAt(0) & 0xff);
  }
  flush();
  return out.join('');
}

/* ---------------- Régi Word 97–2003 (.doc) ---------------- */

function cfbReadStreams(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  if (dv.getUint32(0, true) !== 0xe011cfd0 || dv.getUint32(4, true) !== 0xe11ab1a1) throw new DocError('Ez nem régi Word (.doc) dokumentum, vagy sérült.');
  const secSize = 1 << dv.getUint16(30, true);
  const miniSize = 1 << dv.getUint16(32, true);
  const dirStart = dv.getUint32(48, true);
  const cutoff = dv.getUint32(56, true);
  const miniFatStart = dv.getUint32(60, true);
  let difatSec = dv.getUint32(68, true);
  const fatSectors = [];
  for (let i = 0; i < 109; i++) { const s = dv.getUint32(76 + i * 4, true); if (s < 0xfffffffa) fatSectors.push(s); }
  const secOff = (s) => (s + 1) * secSize;
  let guard = 0;
  while (difatSec < 0xfffffffa && guard++ < 1000) {
    const o = secOff(difatSec);
    for (let i = 0; i < secSize / 4 - 1; i++) { const s = dv.getUint32(o + i * 4, true); if (s < 0xfffffffa) fatSectors.push(s); }
    difatSec = dv.getUint32(o + secSize - 4, true);
  }
  const fat = [];
  for (const s of fatSectors) { const o = secOff(s); for (let i = 0; i < secSize / 4; i++) fat.push(dv.getUint32(o + i * 4, true)); }
  const chain = (start, table) => { const out = []; let s = start; let g = 0; while (s < 0xfffffffa && g++ < 1e6) { out.push(s); s = table[s]; } return out; };
  const readBig = (start, size) => {
    const out = new Uint8Array(size); let p = 0;
    for (const s of chain(start, fat)) { const o = secOff(s); const n = Math.min(secSize, size - p); if (n <= 0) break; out.set(u8.subarray(o, o + n), p); p += n; }
    return out;
  };
  const dirSecs = chain(dirStart, fat);
  const entries = [];
  for (const s of dirSecs) {
    const o = secOff(s);
    for (let k = 0; k < secSize / 128; k++) {
      const e = o + k * 128;
      const nlen = dv.getUint16(e + 64, true);
      const name = nlen ? new TextDecoder('utf-16le').decode(u8.subarray(e, e + Math.max(0, nlen - 2))) : '';
      entries.push({ name, type: u8[e + 66], start: dv.getUint32(e + 116, true), size: dv.getUint32(e + 120, true) });
    }
  }
  const root = entries.find((e) => e.type === 5);
  const miniStream = root ? readBig(root.start, root.size) : new Uint8Array(0);
  const miniFat = [];
  if (miniFatStart < 0xfffffffa) for (const s of chain(miniFatStart, fat)) { const o = secOff(s); for (let i = 0; i < secSize / 4; i++) miniFat.push(dv.getUint32(o + i * 4, true)); }
  const get = (name) => {
    const e = entries.find((x) => x.type === 2 && x.name === name);
    if (!e) return null;
    if (e.size >= cutoff) return readBig(e.start, e.size);
    const out = new Uint8Array(e.size); let p = 0;
    for (const s of chain(e.start, miniFat)) { const o = s * miniSize; const n = Math.min(miniSize, e.size - p); if (n <= 0) break; out.set(miniStream.subarray(o, o + n), p); p += n; }
    return out;
  };
  return { get };
}

const CP1252_HI = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };

export function docToText(buf) {
  const cfb = cfbReadStreams(buf);
  const wd = cfb.get('WordDocument');
  if (!wd) throw new DocError('A .doc fájlban nem található Word-szöveg.');
  const w = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
  if (w.getUint16(0, true) !== 0xa5ec) throw new DocError('Nagyon régi (Word 6/95) vagy nem támogatott .doc formátum. Mentsd el Wordben .docx-ként.');
  const flags = w.getUint16(0x0a, true);
  if (flags & 0x0100) throw new DocError('Jelszóval védett Word-dokumentum – nem olvasható be.');
  const table = cfb.get(flags & 0x0200 ? '1Table' : '0Table');
  if (!table) throw new DocError('A .doc fájl táblázat-adatfolyama hiányzik.');
  const ccpText = w.getUint32(0x4c, true);
  const fcClx = w.getUint32(0x1a2, true);
  const lcbClx = w.getUint32(0x1a6, true);
  const t = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let p = fcClx; const end = fcClx + lcbClx;
  while (p < end && table[p] === 0x01) p += 3 + t.getUint16(p + 1, true);
  if (table[p] !== 0x02) throw new DocError('A .doc fájl szövegtáblája nem olvasható.');
  const lcb = t.getUint32(p + 1, true);
  const plc = p + 5;
  const n = (lcb - 4) / 12;
  let text = '';
  for (let i = 0; i < n && text.length < ccpText; i++) {
    const cpStart = t.getUint32(plc + i * 4, true);
    const cpEnd = t.getUint32(plc + (i + 1) * 4, true);
    const pcd = plc + (n + 1) * 4 + i * 8;
    const fcRaw = t.getUint32(pcd + 2, true);
    const compressed = (fcRaw & 0x40000000) !== 0;
    const fc = fcRaw & 0x3fffffff;
    const len = cpEnd - cpStart;
    if (compressed) {
      const off = fc / 2;
      for (let k = 0; k < len; k++) { const b = wd[off + k]; text += CP1252_HI[b] || String.fromCharCode(b); }
    } else {
      text += new TextDecoder('utf-16le').decode(wd.subarray(fc, fc + len * 2));
    }
  }
  text = text.slice(0, ccpText);
  // mezőkódok: \x13 utasítás \x14 eredmény \x15 → csak az eredmény marad
  text = text.replace(/\x13[^\x13\x14\x15]*\x14/g, '').replace(/\x13[^\x13\x14\x15]*\x15/g, '').replace(/[\x14\x15]/g, '');
  return text.replace(/\r/g, '\n').replace(/[\x0b\x0c]/g, '\n').replace(/\x07/g, '\t').replace(/[\x00-\x08\x0e-\x1f]/g, '');
}

/* ---------------- Közös belépési pont ---------------- */

export async function documentToText(file, decodeText) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  let text;
  if (name.endsWith('.docx') || name.endsWith('.docm')) text = await docxToText(buf);
  else if (name.endsWith('.odt')) text = await odtToText(buf);
  else if (name.endsWith('.rtf')) text = rtfToText(await decodeText(file));
  else if (name.endsWith('.doc')) {
    // néha a .doc valójában docx vagy rtf – a tartalom alapján döntünk
    const head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
    if (head[0] === 0x50 && head[1] === 0x4b) text = await docxToText(buf);
    else if (head[0] === 0x7b && head[1] === 0x5c) text = rtfToText(await decodeText(file));
    else text = docToText(buf);
  } else throw new DocError('Ismeretlen dokumentumformátum.');
  return text.replace(/ /g, ' ').replace(/\n{4,}/g, '\n\n\n');
}
