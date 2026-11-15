// Közös felületi építőelemek: dalkártya, dalszöveg-megjelenítés, betűpanel, háttérképek.

import * as store from './store.js';
import { esc, debounce, clamp, modal, toast, confirmBox } from './util.js';
import { icon } from './icons.js';
import { parseLyrics, markRefrain } from './lyrics.js';
import { parseChordLine, isChordOnlyLine, hasChords, chordFormatter } from './chords.js';
import { isPlayed } from './night.js';
import { instLine } from './inst.js';

/** A dal hangszer-jegyzetsora a Beállítások szerint ('' ha ki van kapcsolva vagy nincs kitöltve). */
export function songInstLine(song, shift) {
  const app = store.settings('app');
  if (app.showInst === false) return '';
  return instLine(song, { fields: Array.isArray(app.instFields) ? app.instFields : undefined, notation: app.chordNotation || 'hu', shift });
}

/** Jegyzetsor HTML a listákba (üresen nem foglal helyet). */
export function instLineHTML(song, cls = 'song-inst') {
  const t = songInstLine(song);
  return t ? `<span class="${cls}">${esc(t)}</span>` : '';
}

/* ---------------- Betűtípusok (csak a készüléken lévő rendszerbetűk – offline is működik) ---------------- */

export const FONTS = {
  sans: { label: 'Modern', css: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  serif: { label: 'Klasszikus talpas', css: 'Georgia, "Noto Serif", "Times New Roman", serif' },
  condensed: { label: 'Keskeny', css: '"Roboto Condensed", "Arial Narrow", sans-serif-condensed, "Segoe UI", sans-serif' },
  poster: { label: 'Plakát', css: 'Impact, Haettenschweiler, "Arial Black", sans-serif-condensed, sans-serif' },
  rounded: { label: 'Barátságos', css: '"Trebuchet MS", "Verdana", "Nunito", sans-serif' },
  mono: { label: 'Írógép', css: '"Courier New", "Roboto Mono", "Droid Sans Mono", monospace' },
  casual: { label: 'Kézírásos', css: '"Comic Sans MS", "Comic Neue", casual, cursive' },
  slab: { label: 'Vastag talpas', css: 'Rockwell, "Roboto Slab", "Noto Serif", serif-monospace, serif' },
};

export const FONT_MIN = 14;
export const FONT_MAX = 70;

export function applyReaderStyle(el, r = store.settings('reader')) {
  el.style.setProperty('--lyr-font', (FONTS[r.fontFamily] || FONTS.sans).css);
  el.style.setProperty('--lyr-size', `${clamp(Number(r.fontSize) || 30, FONT_MIN, FONT_MAX)}px`);
  el.style.setProperty('--lyr-lh', String(clamp(Number(r.lineHeight) || 1.5, 1, 2.6)));
  el.style.setProperty('--lyr-weight', r.fontWeight || '500');
  el.style.setProperty('--lyr-align', r.align || 'left');
  el.style.setProperty('--lyr-overlay', String(clamp(Number(r.overlay ?? 0.6), 0, 0.95)));
  const ref = /^#[0-9a-f]{6}$/i.test(r.refColor || '') ? r.refColor : REF_COLORS[0];
  el.style.setProperty('--ref', ref);
  // a címke betűszíne a háttérszín világosságához igazodik, hogy mindig olvasható legyen
  const [R, G, B] = [1, 3, 5].map((i) => parseInt(ref.slice(i, i + 2), 16));
  el.style.setProperty('--ref-ink', (0.299 * R + 0.587 * G + 0.114 * B) > 150 ? '#1a1200' : '#ffffff');
}

/** Választható refrénkiemelő színek (az első az alapértelmezett). */
export const REF_COLORS = ['#fbbf24', '#2dd4bf', '#60a5fa', '#c084fc', '#f472b6', '#fb7185', '#fb923c', '#4ade80', '#ffffff'];

/* ---------------- Dalszöveg HTML ---------------- */

/* ---------------- Akkordok a szöveg fölött ---------------- */

/**
 * Egy sor(részlet) HTML-je akkordokkal. Az akkord a szó (vagy szótag) kezdete fölé kerül:
 * a szó egy nem törhető egység, benne az akkordos darab egy kis „oszlop” (fent akkord, lent szöveg),
 * így az akkordok sosem fedik egymást, és tördeléskor is a saját szavuk fölött maradnak.
 *  ch.show  – akkordok látszanak-e (ha nem, csak a szöveg marad, zárójelek nélkül)
 *  ch.fmt   – akkordnév → kiírt név (transzponálás, H/B)
 *  ch.tap   – Akkordozás mód: minden szó koppintható (data-l: sor, data-s: hely a sorban)
 *  li, off, cOff – a sor sorszáma, és a részlet kezdete a teljes sorban (szöveg- és akkordindex)
 */
function chordSegHTML(raw, ch, li = 0, off = 0, cOff = 0) {
  const { text, chords } = parseChordLine(raw);
  if (!ch.tap && (!chords.length || !ch.show)) return esc(text);
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ s: m.index, e: m.index + m[0].length }));
  // akkordok a megjelenítési helyük szerint (szóköz elé írt akkord a következő szó elejére kerül)
  const at = new Map();
  chords.forEach((c, k) => {
    let p = c.pos;
    if (p < text.length && /\s/.test(text[p])) { const w = words.find((x) => x.s > p); p = w ? w.s : text.length; }
    if (!at.has(p)) at.set(p, []);
    at.get(p).push({ name: c.name, ci: cOff + k });
  });
  const names = (list) => list.map((c) => `<span class="cn"${ch.tap ? ` data-l="${li}" data-ci="${c.ci}"` : ''}>${esc(ch.fmt(c.name))}</span>`).join(' ');
  const col = (list, chunk) => `<span class="ch-w"><span class="ch">${names(list)}</span>${chunk ? esc(chunk) : '&nbsp;'}</span>`;
  let html = ''; let cur = 0;
  for (const w of words) {
    html += esc(text.slice(cur, w.s));
    const bps = [...at.keys()].filter((p) => p >= w.s && p < w.e).sort((a, b) => a - b);
    const attrs = ch.tap ? ` data-l="${li}" data-s="${off + w.s}"` : '';
    if (!bps.length) html += ch.tap ? `<span class="ch-word"${attrs}>${esc(text.slice(w.s, w.e))}</span>` : esc(text.slice(w.s, w.e));
    else {
      let inner = esc(text.slice(w.s, bps[0]));
      bps.forEach((p, j) => { inner += col(at.get(p), text.slice(p, bps[j + 1] ?? w.e)); });
      html += `<span class="ch-word"${attrs}>${inner}</span>`;
    }
    cur = w.e;
  }
  html += esc(text.slice(cur));
  // a sor végén álló akkord (utána nincs szöveg)
  const end = at.get(text.length);
  if (end) html += `<span class="ch-word">${col(end, '')}</span>`;
  return html;
}

/** Csak akkordokból álló sor, pl. "[Am] [Dm] [E]". */
function chordRowHTML(raw, ch, li = 0) {
  const { chords } = parseChordLine(raw);
  return chords.map((c, k) => `<span class="ch-solo"><span class="cn"${ch.tap ? ` data-l="${li}" data-ci="${k}"` : ''}>${esc(ch.fmt(c.name))}</span></span>`).join(' ');
}

/**
 * Megjelenítés soronként. highlight = a „[Refrén] jellegű sorok színes kiemelése” kapcsoló:
 * kikapcsolva minden sor pontosan úgy jelenik meg, ahogy be van írva (az akkordok zárójele nélkül).
 * opt: { chords: akkordok látszanak (alapból igen), shift: transzponálás félhangban,
 *        notation: 'hu' | 'intl', tap: Akkordozás mód (koppintható szavak) }
 */
export function lyricsHTML(text, highlight = true, opt = {}) {
  if (!text) return '<span class="lyr-empty">Ehhez a dalhoz még nincs dalszöveg. Koppints a szerkesztés gombra a hozzáadáshoz.</span>';
  const ch = {
    show: opt.chords !== false || !!opt.tap,
    tap: !!opt.tap,
    fmt: chordFormatter(text, opt.tap ? 0 : opt.shift, opt.notation || store.settings('app').chordNotation),
  };
  const line = (inner, cls = '') => `<div class="lyr-l${cls}">${inner || '<br>'}</div>`;
  const hasCh = (raw) => ch.show && raw.includes('[') && hasChords(raw);
  // A versszakok (üres sorig tartó részek) külön blokkba kerülnek, így kéthasábos
  // nézetben a hasábhatár nem vághat ketté versszakot vagy refrént.
  let html = ''; let st = ''; let open = false;
  const close = () => { if (open) { st += '</div>'; open = false; } };
  const flush = () => { close(); if (st) { html += `<div class="lyr-st">${st}</div>`; st = ''; } };
  // kikapcsolt akkordoknál az akkordsor eltűnik; ha egy versszak csak ilyenből állt, az utána jövő üres sor sem kell
  let hidden = false;
  const textLine = (raw, li, pre = '', off = 0, cOff = 0) => { hidden = false; return line(pre + chordSegHTML(raw, ch, li, off, cOff), hasCh(raw) ? ' has-ch' : ''); };
  const chordRow = (raw, li) => { if (ch.show) return line(chordRowHTML(raw, ch, li), ' lyr-chordrow'); hidden = true; return ''; };
  const gap = () => { const skip = hidden && !st; hidden = false; flush(); if (!skip) html += line(''); };
  if (!highlight) {
    String(text).split('\n').forEach((l, i) => {
      if (!l.trim()) gap(); else if (isChordOnlyLine(l)) st += chordRow(l, i); else st += textLine(l, i);
    });
    flush();
    return html;
  }
  const lines = String(text).split('\n');
  for (const p of parseLyrics(text)) {
    if (p.ref) {
      // új jel = új refrénblokk (két egymást követő refrén külön keretet kap)
      if (p.kind === 'ref-label' || p.mark) close();
      if (!open) { st += '<div class="lyr-ref">'; open = true; }
      if (p.kind === 'ref-label') st += line(`<span class="lyr-ref-label">${esc(p.text)}</span>`);
      else if (p.kind === 'chords') st += chordRow(p.text, p.i);
      else if (p.mark) {
        // a jel utáni rész helye a teljes sorban (Akkordozás módhoz)
        const full = parseChordLine(lines[p.i]); const rest = parseChordLine(p.text);
        st += textLine(p.text, p.i, `<span class="lyr-ref-mark">${esc(p.mark)}</span> `, full.text.length - rest.text.length, full.chords.length - rest.chords.length);
      } else st += textLine(p.text, p.i);
      continue;
    }
    close();
    if (p.kind === 'gap') gap();
    else if (p.kind === 'section') st += line(`<span class="lyr-sec">${esc(p.text)}</span>`);
    else if (p.kind === 'chords') st += chordRow(p.text, p.i);
    else st += textLine(p.text, p.i);
  }
  flush();
  return html;
}

/**
 * Kéthasábos nézet: csak fekvő tableten, csak ha egy hasábban nem fér ki,
 * és csak ha a Beállításokban be van kapcsolva. avail = a rendelkezésre álló magasság (px).
 * Visszaad: true, ha két hasábra váltott.
 */
export function fitColumns(lyr, avail) {
  if (!lyr) return false;
  lyr.classList.remove('two-col');
  if (store.settings('app').twoColumns === false) return false;
  const W = window.innerWidth; const H = window.innerHeight;
  // telefon (álló és fekvő) és álló tablet: mindig egy hasáb
  if (!(W > H && W >= 900 && H >= 560)) return false;
  if (!(avail > 0) || lyr.scrollHeight <= avail) return false;
  lyr.classList.add('two-col');
  return true;
}

/* ---------------- Dalkártya ---------------- */

export function songCardHTML(song, { draggable = false, match = null, showArtist = store.settings('app').showArtist, href, selectable = false, selected = false } = {}) {
  const badge = match === 'lyrics' ? '<span class="match-badge">szövegben</span>' : (match === 'meta' ? '<span class="match-badge meta">előadó / címke / jegyzet</span>' : '');
  const played = isPlayed(song.id);
  return `<div class="song-card${song.favorite ? ' is-fav' : ''}${selected ? ' is-selected' : ''}${played ? ' is-played' : ''}" data-id="${esc(song.id)}" style="--accent:${esc(store.songColor(song))}"${selectable ? ` aria-selected="${selected}"` : ''}>
    ${selectable ? `<span class="sel-box" aria-hidden="true">${icon('check')}</span>` : ''}
    ${draggable ? `<button class="grip" type="button" aria-label="Áthelyezés húzással">${icon('grip')}</button>` : ''}
    <a class="song-link" href="${esc(href || `#/song/${encodeURIComponent(song.id)}`)}">
      <span class="song-title">${played ? `<span class="played-mark" title="Ma este már lejátszva" aria-label="lejátszva">${icon('check')}</span>` : ''}${esc(song.title)}</span>
      ${showArtist && song.artist ? `<span class="song-artist">${esc(song.artist)}</span>` : ''}
      ${instLineHTML(song)}
      ${badge}
    </a>
    <button class="fav-btn" type="button" data-fav="${esc(song.id)}" aria-pressed="${song.favorite}" aria-label="${song.favorite ? 'Eltávolítás a kedvencekből' : 'Kedvencnek jelölés'}">${icon('star')}</button>
  </div>`;
}

/** Kedvenc-gombok kezelése egy listán (eseménydelegálással). */
export function bindFavButtons(container, after) {
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-fav]');
    if (!btn) return;
    e.preventDefault();
    const song = await store.toggleFavorite(btn.dataset.fav);
    if (!song) return;
    btn.setAttribute('aria-pressed', String(song.favorite));
    btn.closest('.song-card')?.classList.toggle('is-fav', song.favorite);
    btn.classList.add('pop');
    setTimeout(() => btn.classList.remove('pop'), 350);
    after?.(song);
  });
}

/* ---------------- Háttérképek ---------------- */

const urlCache = new Map();

export async function mediaURL(key) {
  if (urlCache.has(key)) return urlCache.get(key);
  const rec = await store.getMedia(key);
  const url = rec?.blob ? URL.createObjectURL(rec.blob) : null;
  urlCache.set(key, url);
  return url;
}

export function invalidateMedia(key) {
  const url = urlCache.get(key);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(key);
}

store.onChange((what) => {
  if (what === 'all') { for (const k of [...urlCache.keys()]) invalidateMedia(k); }
  else if (what.startsWith('media:')) invalidateMedia(what.slice(6));
});

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

/**
 * Kép ellenőrzése és előkészítése (méretcsökkentés JPEG-be). Hibánál magyar
 * nyelvű Error-t dob – a hívó ilyenkor NEM módosítja a korábbi képet.
 */
export async function processImage(file, maxSide = 2400) {
  if (!file) throw new Error('Nem választottál ki képet.');
  const okType = !file.type || file.type.startsWith('image/');
  if (!okType) throw new Error('A kiválasztott fájl nem kép. Válassz JPG, PNG vagy WEBP formátumú képet.');
  if (file.size === 0) throw new Error('A kiválasztott kép üres vagy sérült.');
  if (file.size > 40 * 1024 * 1024) throw new Error('A kép túl nagy (legfeljebb 40 MB lehet).');
  let source; let w; let h; let cleanup = () => {};
  try {
    if ('createImageBitmap' in window) {
      source = await createImageBitmap(file);
      w = source.width; h = source.height;
      cleanup = () => source.close?.();
    } else throw new Error('fallback');
  } catch {
    try {
      const { img, url } = await loadImageElement(file);
      source = img; w = img.naturalWidth; h = img.naturalHeight;
      cleanup = () => URL.revokeObjectURL(url);
    } catch {
      throw new Error('A képet nem sikerült megnyitni. Lehet, hogy sérült, vagy a formátuma (pl. HEIC) nem támogatott. Próbáld JPG vagy PNG képpel.');
    }
  }
  if (!w || !h) { cleanup(); throw new Error('A kép mérete érvénytelen.'); }
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  cleanup();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob || blob.size < 100) throw new Error('A kép feldolgozása nem sikerült. Próbálj másik képet.');
  return blob;
}

/** Fájlválasztó megnyitása; a kiválasztott File-t adja vissza (vagy null-t). */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove(); }, { once: true });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/* ---------------- Betűstílus-panel (olvasóban és beállításokban) ---------------- */

export function fontPanel({ onChange, compact = false } = {}) {
  const r = store.settings('reader');
  const el = document.createElement('div');
  el.className = 'font-panel' + (compact ? ' compact' : '');
  el.innerHTML = `
    <div class="fp-row">
      <span class="fp-label">${icon('type')} Betűstílus</span>
      <div class="font-choices">
        ${Object.entries(FONTS).map(([k, f]) => `<button type="button" class="font-choice${r.fontFamily === k ? ' on' : ''}" data-font="${k}" style="font-family:${esc(f.css)}">${esc(f.label)}</button>`).join('')}
      </div>
    </div>
    <div class="fp-row">
      <span class="fp-label">Betűméret <b class="fp-val" data-val="size">${r.fontSize} px</b></span>
      <div class="stepper">
        <button type="button" class="step-btn" data-step="-2" aria-label="Kisebb betű">${icon('minus')}</button>
        <input type="range" min="${FONT_MIN}" max="${FONT_MAX}" step="1" value="${r.fontSize}" data-r="fontSize" aria-label="Betűméret">
        <button type="button" class="step-btn" data-step="2" aria-label="Nagyobb betű">${icon('plus')}</button>
      </div>
    </div>
    <div class="fp-row">
      <span class="fp-label">Sortávolság <b class="fp-val" data-val="lh">${Number(r.lineHeight).toFixed(2)}</b></span>
      <input type="range" min="1" max="2.6" step="0.05" value="${r.lineHeight}" data-r="lineHeight" aria-label="Sortávolság">
    </div>
    <div class="fp-row fp-inline">
      <div class="seg" role="group" aria-label="Vastagság">
        <button type="button" data-weight="400" class="${r.fontWeight === '400' ? 'on' : ''}">Normál</button>
        <button type="button" data-weight="500" class="${r.fontWeight === '500' ? 'on' : ''}">Közepes</button>
        <button type="button" data-weight="700" class="${r.fontWeight === '700' ? 'on' : ''}">Félkövér</button>
      </div>
      <div class="seg" role="group" aria-label="Igazítás">
        <button type="button" data-align="left" class="${r.align === 'left' ? 'on' : ''}" aria-label="Balra">${icon('alignLeft')}</button>
        <button type="button" data-align="center" class="${r.align === 'center' ? 'on' : ''}" aria-label="Középre">${icon('align')}</button>
      </div>
    </div>
    <label class="fp-row fp-check"><input type="checkbox" data-r="highlightSections" ${r.highlightSections ? 'checked' : ''}> <span>[Refrén] jellegű sorok színes kiemelése</span></label>
    <div class="fp-row" data-ref-row>
      <span class="fp-label">Refrén kiemelésének színe</span>
      <div class="swatches">${REF_COLORS.map((c) => `<button type="button" class="swatch${(r.refColor || REF_COLORS[0]).toLowerCase() === c ? ' on' : ''}" data-refcolor="${c}" style="--c:${c}" aria-label="Refrén színe: ${c}"></button>`).join('')}
        <label class="swatch swatch-custom" aria-label="Egyéni szín">${icon('palette')}<input type="color" data-r="refColor" value="${esc(/^#[0-9a-f]{6}$/i.test(r.refColor || '') ? r.refColor : REF_COLORS[0])}"></label></div>
    </div>`;

  const persist = debounce(() => store.saveSettings('reader', store.settings('reader')), 300);
  // csak a panel saját mezőit kezeljük, így más beállítás (pl. sötétítés) nem íródik felül
  const cur = { fontFamily: r.fontFamily, fontSize: r.fontSize, lineHeight: r.lineHeight, fontWeight: r.fontWeight, align: r.align, highlightSections: r.highlightSections, refColor: r.refColor || REF_COLORS[0] };
  const update = () => {
    el.querySelector('[data-ref-row]').classList.toggle('is-off', !cur.highlightSections);
    el.querySelectorAll('[data-refcolor]').forEach((x) => x.classList.toggle('on', x.dataset.refcolor === String(cur.refColor).toLowerCase()));
    el.querySelector('[data-val="size"]').textContent = `${cur.fontSize} px`;
    el.querySelector('[data-val="lh"]').textContent = Number(cur.lineHeight).toFixed(2);
    el.querySelector('[data-r="fontSize"]').value = cur.fontSize;
    Object.assign(store.state.settings.reader, cur);
    onChange?.(store.state.settings.reader);
    persist();
  };
  el.addEventListener('input', (e) => {
    const k = e.target.dataset.r;
    if (!k) return;
    if (k === 'highlightSections') cur[k] = e.target.checked;
    else if (k === 'refColor') cur[k] = e.target.value;
    else cur[k] = Number(e.target.value);
    update();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.refcolor) {
      cur.refColor = b.dataset.refcolor;
    } else if (b.dataset.font) {
      cur.fontFamily = b.dataset.font;
      el.querySelectorAll('.font-choice').forEach((x) => x.classList.toggle('on', x === b));
    } else if (b.dataset.step) {
      cur.fontSize = clamp(Number(cur.fontSize) + Number(b.dataset.step), FONT_MIN, FONT_MAX);
    } else if (b.dataset.weight) {
      cur.fontWeight = b.dataset.weight;
      b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    } else if (b.dataset.align) {
      cur.align = b.dataset.align;
      b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    } else return;
    update();
  });
  el.flush = () => persist.flush();
  return el;
}

/**
 * Gyors szerkesztő ablak (fellépés-listáról és fellépés módból is): cím + dalszöveg.
 * Zárolt módban megkérdezi, feloldja-e a zárolást. Visszaad: a mentett dal, vagy null.
 */
export async function quickEditSong(songId) {
  const song = store.getSong(songId);
  if (!song) { toast('A dal nem található.', 'error'); return null; }
  if (store.settings('app').performLock) {
    const ok = await confirmBox('Zárolva', 'A fellépés-zárolás be van kapcsolva, ezért a szerkesztés tiltva van. Feloldod a zárolást, és szerkeszted a dalt?', { okLabel: 'Feloldás és szerkesztés' });
    if (!ok) return null;
    await store.patchSettings('app', { performLock: false });
  }
  const res = await modal({
    title: 'Dal szerkesztése',
    wide: true,
    body: `<label class="field"><span class="field-label">Cím</span>
        <input class="input input-lg" name="qe-title" maxlength="300" autocomplete="off" value="${esc(song.title)}">
        <span class="field-error" hidden>Add meg a dal címét.</span></label>
      <div class="field"><span class="field-label">Dalszöveg</span>
        <div class="ref-btn-row"><button type="button" class="btn btn-gold btn-sm" data-qe-ref>${icon('star')} Refrén</button>
          <small class="muted">Jelöld ki a refrén sorait, majd nyomd meg.</small></div>
        <textarea class="input lyrics-input qe-lyrics" name="qe-lyrics" rows="14" spellcheck="false" aria-label="Dalszöveg">${esc(song.lyrics || '')}</textarea></div>`,
    buttons: [{ label: 'Mégse', value: null, kind: 'ghost' }, { label: 'Mentés', value: true, kind: 'primary' }],
    onOpen: (box) => {
      const ta = box.querySelector('textarea');
      box.querySelector('[data-qe-ref]').addEventListener('click', () => {
        const r = markRefrain(ta.value, ta.selectionStart ?? 0, ta.selectionEnd ?? 0);
        if (!r.changed) { toast(r.reason, 'info', 3000); ta.focus(); return; }
        ta.value = r.text; ta.focus(); ta.setSelectionRange(r.selStart, r.selEnd);
      });
    },
    getValue: (box) => {
      const title = box.querySelector('[name=qe-title]').value.trim();
      if (!title) { box.querySelector('.field-error').hidden = false; return undefined; }
      return { title, lyrics: box.querySelector('textarea').value };
    },
  });
  if (!res) return null;
  if (res.title === song.title && store.cleanLyrics(res.lyrics) === song.lyrics) return song;
  const saved = await store.saveSong({ ...song, title: res.title, lyrics: res.lyrics });
  toast('A dal módosítása elmentve.', 'success');
  return saved;
}

export function emptyState(iconName, color, title, text, actionHTML = '') {
  return `<div class="empty"><span class="tile tile-${color} tile-xl">${icon(iconName)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p>${actionHTML}</div>`;
}
