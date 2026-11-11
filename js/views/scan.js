// Új dal választó („+” gomb) és „Fotózás füzetből”: kamera/galéria → körbevágás →
// szövegfelismerés a készüléken → szerkesztés → mentés. Több oldal egymás után fotózható,
// a végén egyenként átnézhetők. Mentésig semmi nem kerül az adatbázisba.

import * as store from '../store.js';
import * as ocr from '../ocr.js';
import { esc, toast, confirmBox, clamp } from '../util.js';
import { icon, tile } from '../icons.js';
import { emptyState } from '../components.js';
import { txtImportFlow } from '../txtimport.js';

/** A még el nem mentett, fotózott dalok (a képernyők közti váltást túlélik, újratöltést nem). */
const session = { drafts: [], tagId: '' };
let seq = 0;

window.addEventListener('beforeunload', (e) => {
  if (session.drafts.length) { e.preventDefault(); e.returnValue = ''; }
});

export function pendingDrafts() { return session.drafts.length; }

function lockedView(title) {
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = emptyState('lock', 'red', 'Zárolva', 'A fellépés-zárolás be van kapcsolva, ezért új dal felvétele most nem lehetséges. Oldd fel a felső sávban lévő lakat ikonnal.');
  return { title, back: '#/songs', nav: 'songs', el };
}

/* ---------------- „+” választó ---------------- */

export function newSongView(ctx) {
  if (store.settings('app').performLock) return lockedView('Új dal');
  const el = document.createElement('div');
  el.className = 'page new-page';
  const n = session.drafts.length;
  el.innerHTML = `
    <p class="muted new-lead">Hogyan szeretnéd felvenni az új dalt?</p>
    <div class="new-grid">
      <a class="card new-card" href="#/edit/new">
        ${tile('edit', 'blue', 'tile-xl')}
        <span class="new-text"><b>Beírás / bemásolás</b><small>Cím és dalszöveg begépelése vagy beillesztése.</small></span>
      </a>
      <a class="card new-card" href="#/scan">
        ${tile('camera', 'gold', 'tile-xl')}
        <span class="new-text"><b>Fotózás füzetből</b><small>Lefotózod az oldalt, az alkalmazás felismeri a szöveget – internet nélkül.</small>
        ${n ? `<em class="new-badge">${n} fotózott dal vár átnézésre</em>` : ''}</span>
      </a>
      <div class="card new-card new-card-col">
        <div class="new-row">${tile('folder', 'teal', 'tile-xl')}
          <span class="new-text"><b>Fájlból</b><small>Word (DOCX, DOC), TXT, ODT vagy RTF fájlok beolvasása.</small></span></div>
        <div class="row-wrap">
          <button type="button" class="btn btn-teal" data-act="files">${icon('upload')} Fájlok kiválasztása</button>
          <button type="button" class="btn btn-ghost" data-act="folder">${icon('folder')} Teljes mappa</button>
        </div>
      </div>
    </div>`;
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (await txtImportFlow({ folder: b.dataset.act === 'folder' })) ctx.go('#/songs', { replace: true });
  });
  return { id: 'new', title: 'Új dal', back: '#/songs', nav: 'songs', el };
}

/* ---------------- Képkezelés ---------------- */

function pickImage(camera) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove(); }, { once: true });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/** Fájl → vászon (a fotó elforgatási adatát figyelembe véve), legfeljebb maxSide képponttal. */
async function fileToCanvas(file, maxSide = 3200) {
  if (file.type && !file.type.startsWith('image/')) throw new Error('A kiválasztott fájl nem kép.');
  let src; let w; let h; let done = () => {};
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = src.width; h = src.height; done = () => src.close?.();
  } catch {
    try {
      const url = URL.createObjectURL(file);
      src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      w = src.naturalWidth; h = src.naturalHeight; done = () => URL.revokeObjectURL(url);
    } catch {
      throw new Error('A képet nem sikerült megnyitni. Lehet, hogy sérült, vagy a formátuma (pl. HEIC) nem támogatott.');
    }
  }
  if (!w || !h) throw new Error('A kép mérete érvénytelen.');
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  done();
  return c;
}

function rotate90(c) {
  const r = document.createElement('canvas');
  r.width = c.height; r.height = c.width;
  const x = r.getContext('2d');
  x.translate(r.width, 0); x.rotate(Math.PI / 2); x.drawImage(c, 0, 0);
  return r;
}

function cropCanvas(c, f, maxSide = 2600) {
  const sx = Math.round(f.x0 * c.width); const sy = Math.round(f.y0 * c.height);
  const sw = Math.max(8, Math.round((f.x1 - f.x0) * c.width)); const sh = Math.max(8, Math.round((f.y1 - f.y0) * c.height));
  const s = Math.min(1, maxSide / Math.max(sw, sh));
  const o = document.createElement('canvas');
  o.width = Math.round(sw * s); o.height = Math.round(sh * s);
  const x = o.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, o.width, o.height);
  x.drawImage(c, sx, sy, sw, sh, 0, 0, o.width, o.height);
  return o;
}

function thumbURL(c, maxW = 1100) {
  const s = Math.min(1, maxW / c.width);
  const t = document.createElement('canvas');
  t.width = Math.round(c.width * s); t.height = Math.round(c.height * s);
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  return new Promise((res) => t.toBlob((b) => res(b ? URL.createObjectURL(b) : ''), 'image/jpeg', 0.72));
}

/* ---------------- Fotózás füzetből ---------------- */

export function scanView(ctx) {
  if (store.settings('app').performLock) return lockedView('Fotózás füzetből');
  const el = document.createElement('div');
  el.className = 'page scan-page';
  let work = null;                 // a teljes (elforgatott) fotó
  let crop = { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 };
  let idx = 0;                     // az éppen szerkesztett piszkozat
  let alive = true;

  let curTitle = 'Fotózás füzetből';
  const setTitle = (t) => { curTitle = t; const h = document.getElementById('viewTitle'); if (h && alive) h.textContent = t; };

  /* ----- 1. kép kiválasztása ----- */
  async function showCapture(msg = '') {
    setTitle('Fotózás füzetből');
    const n = session.drafts.length;
    el.innerHTML = `
      ${msg ? `<p class="scan-msg">${icon('check')} ${esc(msg)}</p>` : ''}
      <div class="scan-start">
        <button type="button" class="scan-big scan-cam" data-act="camera">${icon('camera')}<b>Fotó készítése</b><small>megnyílik a kamera</small></button>
        <button type="button" class="scan-big scan-gal" data-act="gallery">${icon('image')}<b>Kép a galériából</b><small>korábban készült fotó</small></button>
      </div>
      ${n ? `<button type="button" class="btn btn-primary btn-block btn-lg" data-act="review">${icon('list')} Átnézés és mentés – ${n} dal vár</button>` : ''}
      <div class="card scan-tips">
        <b>${icon('info')} Tippek a jó felismeréshez</b>
        <ul>
          <li>Jó fényben, árnyék nélkül, a lap fölül egyenesen fotózz.</li>
          <li>A szöveg legyen éles és minél nagyobb a képen.</li>
          <li>Fotózás után vágd körbe: csak a dalszöveg maradjon, a kotta ne.</li>
          <li>Nyomtatott szöveget olvas jól; a kézírást gyengén.</li>
        </ul>
        <p class="status-line st-pending" data-ocr-status>Szövegfelismerő ellenőrzése…</p>
      </div>`;
    const st = el.querySelector('[data-ocr-status]');
    const paint = async () => {
      const ok = await ocr.offlineReady();
      if (!alive || !st.isConnected) return ok;
      st.className = `status-line ${ok ? 'st-active' : 'st-paused'}`;
      st.textContent = ok ? 'A szövegfelismerő le van töltve – internet nélkül is működik.' : (navigator.onLine === false
        ? 'A szövegfelismerő még nincs letöltve. Egyszer internettel kell megnyitni ezt a képernyőt.'
        : 'A szövegfelismerő letöltése folyamatban (kb. 17 MB, csak egyszer kell)…');
      return ok;
    };
    if (!(await paint()) && navigator.onLine !== false) {
      ocr.prefetch((p) => { if (st.isConnected) st.textContent = `A szövegfelismerő letöltése: ${Math.round(p * 100)}% (csak egyszer kell)…`; })
        .then(paint).catch(() => { if (st.isConnected) { st.className = 'status-line st-error'; st.textContent = 'A szövegfelismerő letöltése nem sikerült. Ellenőrizd az internetkapcsolatot, és nyisd meg újra ezt a képernyőt.'; } });
    }
  }

  async function loadImage(camera) {
    const file = await pickImage(camera);
    if (!file || !alive) return;
    try {
      work = await fileToCanvas(file);
      crop = { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 };
      showCrop();
    } catch (e) { toast(e.message, 'error', 6000); }
  }

  /* ----- 2. körbevágás ----- */
  function showCrop() {
    setTitle('Körbevágás');
    el.innerHTML = `
      <p class="muted small scan-hint">${icon('move')} Húzd a sarkokat úgy, hogy csak a dalszöveg legyen a keretben (a kotta maradjon ki).</p>
      <div class="crop-wrap"><div class="crop-stage">
        <canvas class="crop-canvas"></canvas>
        <div class="crop-box"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div>
      </div></div>
      <div class="scan-actions">
        <button type="button" class="btn btn-ghost" data-act="rotate">${icon('reset')} Forgatás</button>
        <button type="button" class="btn btn-ghost" data-act="full">${icon('fullscreen')} Teljes kép</button>
        <button type="button" class="btn btn-ghost" data-act="retake">${icon('camera')} Másik kép</button>
        <button type="button" class="btn btn-primary btn-lg scan-go" data-act="recognize">${icon('sparkles')} Szöveg felismerése</button>
      </div>`;
    const cv = el.querySelector('.crop-canvas');
    const box = el.querySelector('.crop-box');
    const stage = el.querySelector('.crop-stage');
    // megjelenítéshez kisebb másolat (gyors), a felismerés a teljes felbontásból vág
    const s = Math.min(1, 1400 / Math.max(work.width, work.height));
    cv.width = Math.round(work.width * s); cv.height = Math.round(work.height * s);
    cv.getContext('2d').drawImage(work, 0, 0, cv.width, cv.height);
    const paint = () => {
      box.style.left = `${crop.x0 * 100}%`; box.style.top = `${crop.y0 * 100}%`;
      box.style.width = `${(crop.x1 - crop.x0) * 100}%`; box.style.height = `${(crop.y1 - crop.y0) * 100}%`;
    };
    paint();
    let drag = null;
    const MIN = 0.06;
    stage.addEventListener('pointerdown', (e) => {
      const h = e.target.dataset?.h;
      if (!h && !e.target.closest('.crop-box')) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      drag = { h: h || 'move', sx: e.clientX, sy: e.clientY, w: r.width, hgt: r.height, c: { ...crop }, id: e.pointerId };
      try { stage.setPointerCapture(e.pointerId); } catch { /* */ }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = (e.clientX - drag.sx) / drag.w; const dy = (e.clientY - drag.sy) / drag.hgt;
      const c = drag.c;
      if (drag.h === 'move') {
        const w = c.x1 - c.x0; const h = c.y1 - c.y0;
        crop.x0 = clamp(c.x0 + dx, 0, 1 - w); crop.y0 = clamp(c.y0 + dy, 0, 1 - h);
        crop.x1 = crop.x0 + w; crop.y1 = crop.y0 + h;
      } else {
        if (drag.h.includes('w')) crop.x0 = clamp(c.x0 + dx, 0, c.x1 - MIN);
        if (drag.h.includes('e')) crop.x1 = clamp(c.x1 + dx, c.x0 + MIN, 1);
        if (drag.h.includes('n')) crop.y0 = clamp(c.y0 + dy, 0, c.y1 - MIN);
        if (drag.h.includes('s')) crop.y1 = clamp(c.y1 + dy, c.y0 + MIN, 1);
      }
      paint();
    });
    const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }

  /* ----- 3. felismerés ----- */
  async function runOcr() {
    const img = cropCanvas(work, crop);
    setTitle('Felismerés…');
    el.innerHTML = `<div class="card scan-busy">${tile('sparkles', 'gold', 'tile-xl')}
      <b data-label>Felismerő indítása…</b>
      <div class="bar"><i></i></div>
      <small class="muted">A felismerés ezen a készüléken fut, a kép sehova nem kerül elküldésre. Ez néhány másodperctől fél percig tarthat.</small></div>`;
    const bar = el.querySelector('.bar i'); const label = el.querySelector('[data-label]');
    try {
      const [res, thumb] = await Promise.all([
        ocr.recognize(img, (p, text) => { if (bar.isConnected) { bar.style.width = `${Math.round(p * 100)}%`; label.textContent = text; } }),
        thumbURL(img),
      ]);
      if (!alive) { if (thumb) URL.revokeObjectURL(thumb); return; }
      const sp = ocr.splitTitle(res.text);
      if (!sp.full.trim()) {
        if (thumb) URL.revokeObjectURL(thumb);
        toast('Ezen a képen nem találtam szöveget. Próbáld élesebb, világosabb fotóval, vagy vágd szűkebbre.', 'error', 6500);
        showCrop();
        return;
      }
      session.drafts.push({ id: ++seq, title: sp.title, lyrics: sp.rest, full: sp.full, firstIsTitle: true, thumb, confidence: res.confidence });
      idx = session.drafts.length - 1;
      work = null;
      showDraft();
    } catch (e) {
      console.error(e);
      toast(e.message || 'A felismerés nem sikerült.', 'error', 7000);
      if (alive && work) showCrop();
    }
  }

  /* ----- 4. szerkesztés / átnézés ----- */
  function showDraft() {
    const n = session.drafts.length;
    if (!n) { showCapture(); return; }
    idx = clamp(idx, 0, n - 1);
    const d = session.drafts[idx];
    setTitle(n > 1 ? `Átnézés: ${idx + 1} / ${n}` : 'Felismert dal');
    const tags = store.tagsSorted();
    el.innerHTML = `
      ${n > 1 ? `<div class="draft-nav">
        <button type="button" class="btn btn-ghost btn-sm" data-act="prev" ${idx === 0 ? 'disabled' : ''}>${icon('prev')} Előző</button>
        <span><b>${idx + 1}</b> / ${n} átnézendő dal</span>
        <button type="button" class="btn btn-ghost btn-sm" data-act="next" ${idx === n - 1 ? 'disabled' : ''}>Következő ${icon('next')}</button></div>` : ''}
      ${d.confidence && d.confidence < 75 ? `<p class="scan-warn">${icon('info')} A felismerés bizonytalan (${d.confidence}%). Nézd át alaposan, főleg az ékezeteket.</p>` : ''}
      <div class="draft-grid">
        ${d.thumb ? `<details class="card draft-photo" open><summary>${icon('image')} A lefotózott szöveg (összehasonlításhoz)</summary><div class="photo-scroll"><img src="${d.thumb}" alt="A lefotózott oldal"></div></details>` : ''}
        <form class="card editor draft-form" novalidate>
          <label class="field"><span class="field-label">Cím <em>*</em> <small>(javaslat: az első sor)</small></span>
            <input class="input input-lg" name="title" maxlength="300" autocomplete="off" value="${esc(d.title)}">
            <span class="field-error" hidden>Add meg a dal címét.</span></label>
          <label class="fp-check"><input type="checkbox" name="firstIsTitle" ${d.firstIsTitle ? 'checked' : ''}> <span>Az első sor a cím – a dalszövegben ne szerepeljen</span></label>
          <label class="field"><span class="field-label">Dalszöveg <small>(javítsd ki, ahol kell)</small></span>
            <textarea class="input lyrics-input" name="lyrics" rows="14" spellcheck="false">${esc(d.lyrics)}</textarea></label>
          ${tags.length ? `<label class="field"><span class="field-label">${icon('tag')} Címke a most fotózott dalokhoz <small>(nem kötelező)</small></span>
            <select class="input" name="tag"><option value="">– nincs –</option>${tags.map((t) => `<option value="${esc(t.id)}" ${t.id === session.tagId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>` : ''}
          <div class="form-actions">
            <button type="button" class="btn btn-danger" data-act="discard">${icon('trash')} Elvetés</button>
            ${idx > 0 ? `<button type="button" class="btn btn-ghost" data-act="append">${icon('plus')} Hozzáfűzés az előző dalhoz</button>` : ''}
            <span class="spacer"></span>
            <button type="button" class="btn btn-blue btn-lg" data-act="more">${icon('camera')} Következő oldal</button>
            <button type="submit" class="btn btn-primary btn-lg">${icon('check')} Mentés</button>
          </div>
          <p class="muted small">A „Következő oldal” megőrzi ezt a dalt átnézésre, és új fotót készíthetsz. Mentésig semmi nem kerül a dalaid közé.</p>
        </form>
      </div>`;
    const form = el.querySelector('form');
    form.addEventListener('input', (e) => {
      if (e.target.name === 'title') { d.title = e.target.value; form.querySelector('.field-error').hidden = true; }
      if (e.target.name === 'lyrics') d.lyrics = e.target.value;
    });
    form.addEventListener('change', (e) => {
      if (e.target.name === 'tag') session.tagId = e.target.value;
      if (e.target.name === 'firstIsTitle') {
        d.firstIsTitle = e.target.checked;
        const first = d.full.split('\n').find((l) => l.trim()) || '';
        const cur = form.elements.lyrics.value;
        // csak akkor nyúlunk a szöveghez, ha az első sor még nincs / még ott van benne
        if (!d.firstIsTitle && !cur.trimStart().startsWith(first.trim())) d.lyrics = `${first.trim()}\n${cur}`;
        if (d.firstIsTitle && cur.trimStart().startsWith(first.trim())) d.lyrics = cur.trimStart().slice(first.trim().length).replace(/^\n+/, '');
        form.elements.lyrics.value = d.lyrics;
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = d.title.trim();
      if (!title) { form.querySelector('.field-error').hidden = false; form.elements.title.focus(); return; }
      const tagIds = session.tagId && store.state.tags.has(session.tagId) ? [session.tagId] : [];
      await store.saveSong({ title, lyrics: d.lyrics, tagIds });
      dropDraft(d);
      toast(`„${title}” elmentve.`, 'success');
      if (session.drafts.length) showDraft(); else showCapture('Minden fotózott dal el van mentve.');
    });
    window.scrollTo(0, 0);
  }

  function dropDraft(d) {
    const i = session.drafts.indexOf(d);
    if (i < 0) return;
    if (d.thumb) URL.revokeObjectURL(d.thumb);
    session.drafts.splice(i, 1);
    if (idx >= session.drafts.length) idx = session.drafts.length - 1;
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const d = session.drafts[idx];
    switch (b.dataset.act) {
      case 'camera': loadImage(true); break;
      case 'gallery': loadImage(false); break;
      case 'review': idx = 0; showDraft(); break;
      case 'rotate': work = rotate90(work); crop = { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 }; showCrop(); break;
      case 'full': crop = { x0: 0, y0: 0, x1: 1, y1: 1 }; showCrop(); break;
      case 'retake': work = null; showCapture(); break;
      case 'recognize': runOcr(); break;
      case 'prev': idx--; showDraft(); break;
      case 'next': idx++; showDraft(); break;
      case 'more': showCapture(`„${d?.title || 'A dal'}” megőrizve átnézésre.`); break;
      case 'discard':
        if (d && await confirmBox('Felismert dal elvetése', `Elveted ezt a felismert dalt („${d.title || 'cím nélkül'}”)? A már elmentett dalaidat ez nem érinti.`, { okLabel: 'Elvetés', danger: true })) {
          dropDraft(d);
          if (session.drafts.length) showDraft(); else showCapture();
        }
        break;
      case 'append': {
        const prev = session.drafts[idx - 1];
        if (!d || !prev) break;
        prev.lyrics = `${prev.lyrics.replace(/\s+$/, '')}\n\n${(d.firstIsTitle && d.title ? `${d.title}\n` : '') + d.lyrics}`.trim();
        prev.full = `${prev.full}\n\n${d.full}`;
        dropDraft(d);
        idx = session.drafts.indexOf(prev);
        toast('Hozzáfűzve az előző dal végéhez.', 'success');
        showDraft();
        break;
      }
      default: break;
    }
  });

  if (ctx.query.get('review') === '1' && session.drafts.length) showDraft(); else showCapture();

  return {
    id: 'scan',
    title: 'Fotózás füzetből',
    back: '#/new',
    nav: 'songs',
    el,
    mounted: () => setTitle(curTitle),
    cleanup: () => { alive = false; work = null; ocr.shutdown(); },
  };
}
