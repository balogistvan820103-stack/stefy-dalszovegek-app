// Közös felületi építőelemek: dalkártya, dalszöveg-megjelenítés, betűpanel, háttérképek.

import * as store from './store.js';
import { esc, debounce, clamp } from './util.js';
import { icon } from './icons.js';

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
}

/* ---------------- Dalszöveg HTML ---------------- */

export function lyricsHTML(text, highlight = true) {
  if (!text) return '<span class="lyr-empty">Ehhez a dalhoz még nincs dalszöveg. Koppints a szerkesztés gombra a hozzáadáshoz.</span>';
  return String(text).split('\n').map((line) => {
    if (highlight && /^\s*\[[^\]]{1,40}\]\s*$/.test(line)) return `<span class="lyr-sec">${esc(line.trim().slice(1, -1))}</span>`;
    return esc(line);
  }).join('\n');
}

/* ---------------- Dalkártya ---------------- */

export function songCardHTML(song, { draggable = false, match = null, showArtist = store.settings('app').showArtist, href, selectable = false, selected = false } = {}) {
  const badge = match === 'lyrics' ? '<span class="match-badge">szövegben</span>' : (match === 'meta' ? '<span class="match-badge meta">előadó / címke</span>' : '');
  return `<div class="song-card${song.favorite ? ' is-fav' : ''}${selected ? ' is-selected' : ''}" data-id="${esc(song.id)}" style="--accent:${esc(store.songColor(song))}"${selectable ? ` aria-selected="${selected}"` : ''}>
    ${selectable ? `<span class="sel-box" aria-hidden="true">${icon('check')}</span>` : ''}
    ${draggable ? `<button class="grip" type="button" aria-label="Áthelyezés húzással">${icon('grip')}</button>` : ''}
    <a class="song-link" href="${esc(href || `#/song/${encodeURIComponent(song.id)}`)}">
      <span class="song-title">${esc(song.title)}</span>
      ${showArtist && song.artist ? `<span class="song-artist">${esc(song.artist)}</span>` : ''}
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
    <label class="fp-row fp-check"><input type="checkbox" data-r="highlightSections" ${r.highlightSections ? 'checked' : ''}> <span>[Refrén] jellegű sorok színes kiemelése</span></label>`;

  const persist = debounce(() => store.saveSettings('reader', store.settings('reader')), 300);
  // csak a panel saját mezőit kezeljük, így más beállítás (pl. sötétítés) nem íródik felül
  const cur = { fontFamily: r.fontFamily, fontSize: r.fontSize, lineHeight: r.lineHeight, fontWeight: r.fontWeight, align: r.align, highlightSections: r.highlightSections };
  const update = () => {
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
    else cur[k] = Number(e.target.value);
    update();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.font) {
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

export function emptyState(iconName, color, title, text, actionHTML = '') {
  return `<div class="empty"><span class="tile tile-${color} tile-xl">${icon(iconName)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p>${actionHTML}</div>`;
}
