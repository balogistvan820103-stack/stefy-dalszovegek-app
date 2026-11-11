// Kezdőképernyő: szerkeszthető, húzható címfeliratok saját háttérrel + gyorselérés.

import * as store from '../store.js';
import { esc, clamp, toast, confirmBox, fmtISODate } from '../util.js';
import { icon, tile } from '../icons.js';
import { mediaURL, processImage, pickFile, songCardHTML, bindFavButtons } from '../components.js';

const KEYS = ['title', 'subtitle', 'slogan'];
const LABELS = { title: 'Főcím', subtitle: 'Alcím', slogan: 'Szlogen' };
const SWATCHES = ['#ffd166', '#fbbf24', '#ffffff', '#2ee6d6', '#14b8a6', '#60a5fa', '#3b82f6', '#a855f7', '#c084fc', '#f5d0fe', '#ec4899', '#f43f5e', '#f97316', '#22c55e'];

function applyText(el, cfg) {
  el.textContent = cfg.text;
  el.style.left = `${cfg.x}%`;
  el.style.top = `${cfg.y}%`;
  el.style.color = cfg.color;
  el.style.fontSize = `min(${cfg.size}px, ${(cfg.size * 0.22).toFixed(2)}vw)`;
  el.style.textAlign = cfg.align;
  const tx = cfg.align === 'left' ? '0' : (cfg.align === 'right' ? '-100%' : '-50%');
  el.style.transform = `translate(${tx}, -50%)`;
  el.style.setProperty('--glow', cfg.color);
}

async function heroBg(bgEl) {
  const url = await mediaURL('bg-home');
  bgEl.style.backgroundImage = url ? `url("${url}")` : '';
  bgEl.classList.toggle('has-image', !!url);
}

export async function homeView(ctx) {
  const editing = ctx.query.get('edit') === '1';
  const saved = store.settings('home');
  const work = store.clone(saved);
  const el = document.createElement('div');
  el.className = 'page home' + (editing ? ' home-editing' : '');
  el.innerHTML = `
    <section class="hero${editing ? ' editing' : ''}" aria-label="Kezdőkép">
      <div class="hero-bg"></div>
      <div class="hero-lights" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="hero-shade"></div>
      ${KEYS.map((k) => `<div class="hero-text ht-${k}" data-k="${k}" ${editing ? 'tabindex="0" role="button"' : ''}></div>`).join('')}
      ${editing ? '<div class="hero-hint">Húzd a feliratokat a kívánt helyre</div>' : `<a class="hero-edit" href="#/?edit=1" aria-label="Kezdőképernyő szerkesztése">${icon('edit')}</a>`}
    </section>
    <div class="home-body"></div>`;
  const hero = el.querySelector('.hero');
  const shade = el.querySelector('.hero-shade');
  const body = el.querySelector('.home-body');
  const texts = Object.fromEntries(KEYS.map((k) => [k, el.querySelector(`.ht-${k}`)]));
  const paint = () => {
    for (const k of KEYS) applyText(texts[k], work[k]);
    shade.style.opacity = String(work.overlay);
  };
  paint();
  heroBg(el.querySelector('.hero-bg'));

  if (!editing) {
    renderDashboard(body);
    return { id: 'home', title: 'STEFY Dalszövegek', back: null, nav: 'home', el };
  }

  /* ---------- Szerkesztési mód ---------- */
  let sel = 'title';
  let dirty = false;
  const markDirty = () => { dirty = true; };
  body.innerHTML = `
    <div class="card edit-panel">
      <div class="seg seg-wide" role="tablist">${KEYS.map((k) => `<button type="button" data-sel="${k}" class="${k === sel ? 'on' : ''}">${LABELS[k]}</button>`).join('')}</div>
      <label class="field"><span class="field-label">Szöveg</span><input class="input" data-f="text" maxlength="80"></label>
      <label class="field"><span class="field-label">Méret <b data-v="size"></b></span><input type="range" min="10" max="140" step="1" data-f="size"></label>
      <div class="field"><span class="field-label">Szín</span>
        <div class="swatches">${SWATCHES.map((c) => `<button type="button" class="swatch" data-color="${c}" style="--c:${c}" aria-label="Szín ${c}"></button>`).join('')}
          <label class="swatch swatch-custom" aria-label="Egyéni szín">${icon('palette')}<input type="color" data-f="color"></label></div></div>
      <div class="field"><span class="field-label">Igazítás</span>
        <div class="seg"><button type="button" data-align="left" aria-label="Balra">${icon('alignLeft')}</button><button type="button" data-align="center" aria-label="Középre">${icon('align')}</button><button type="button" data-align="right" aria-label="Jobbra">${icon('alignRight')}</button></div></div>
      <div class="grid-2">
        <label class="field"><span class="field-label">Vízszintes helyzet <b data-v="x"></b></span><input type="range" min="0" max="100" step="0.5" data-f="x"></label>
        <label class="field"><span class="field-label">Függőleges helyzet <b data-v="y"></b></span><input type="range" min="0" max="100" step="0.5" data-f="y"></label>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-act="reset-one">${icon('reset')} Ennek a feliratnak az alaphelyzete</button>
      <hr>
      <div class="field"><span class="field-label">${icon('image')} Kezdőképernyő saját háttérképe <small>(külön a dalszöveg hátterétől)</small></span>
        <div class="row-wrap">
          <button type="button" class="btn btn-blue btn-sm" data-act="bg-pick">${icon('image')} Kép kiválasztása / cseréje</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="bg-del">${icon('trash')} Kép törlése</button>
        </div></div>
      <label class="field"><span class="field-label">Háttér sötétítése <b data-v="overlay"></b></span><input type="range" min="0" max="0.9" step="0.05" data-f="overlay"></label>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-act="reset-all">${icon('reset')} Teljes alaphelyzet</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost" data-act="cancel">Mégse</button>
        <button type="button" class="btn btn-primary" data-act="save">${icon('check')} Mentés</button>
      </div>
    </div>`;

  const f = (name) => body.querySelector(`[data-f="${name}"]`);
  const v = (name) => body.querySelector(`[data-v="${name}"]`);
  const syncPanel = () => {
    const c = work[sel];
    f('text').value = c.text;
    f('size').value = c.size; v('size').textContent = `${c.size} px`;
    f('color').value = /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#ffffff';
    f('x').value = c.x; v('x').textContent = `${Math.round(c.x)}%`;
    f('y').value = c.y; v('y').textContent = `${Math.round(c.y)}%`;
    f('overlay').value = work.overlay; v('overlay').textContent = `${Math.round(work.overlay * 100)}%`;
    body.querySelectorAll('[data-align]').forEach((b) => b.classList.toggle('on', b.dataset.align === c.align));
    body.querySelectorAll('.swatch[data-color]').forEach((b) => b.classList.toggle('on', b.dataset.color.toLowerCase() === c.color.toLowerCase()));
    body.querySelectorAll('[data-sel]').forEach((b) => b.classList.toggle('on', b.dataset.sel === sel));
    for (const k of KEYS) texts[k].classList.toggle('selected', k === sel);
  };
  syncPanel();

  body.addEventListener('input', (e) => {
    const name = e.target.dataset.f;
    if (!name) return;
    if (name === 'overlay') work.overlay = Number(e.target.value);
    else if (name === 'text') work[sel].text = e.target.value;
    else if (name === 'color') work[sel].color = e.target.value;
    else work[sel][name] = Number(e.target.value);
    markDirty();
    paint();
    if (name !== 'text') syncPanel();
  });

  body.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sel) { sel = b.dataset.sel; syncPanel(); return; }
    if (b.dataset.color) { work[sel].color = b.dataset.color; markDirty(); paint(); syncPanel(); return; }
    if (b.dataset.align) { work[sel].align = b.dataset.align; markDirty(); paint(); syncPanel(); return; }
    const act = b.dataset.act;
    if (act === 'reset-one') { work[sel] = store.clone(store.DEFAULTS.home[sel]); markDirty(); paint(); syncPanel(); }
    if (act === 'reset-all') {
      if (await confirmBox('Alaphelyzet', 'Mindhárom felirat (szöveg, méret, szín, igazítás, pozíció) és a sötétítés visszaáll az eredeti értékre. A háttérkép megmarad.', { okLabel: 'Visszaállítás' })) {
        Object.assign(work, store.clone(store.DEFAULTS.home)); markDirty(); paint(); syncPanel();
        toast('Alaphelyzet betöltve – a megtartáshoz nyomd meg a Mentést.');
      }
    }
    if (act === 'cancel') { dirty = false; ctx.go('#/', { replace: true }); }
    if (act === 'save') {
      for (const k of KEYS) if (!work[k].text.trim()) work[k].text = store.DEFAULTS.home[k].text;
      await store.saveSettings('home', work);
      dirty = false;
      toast('Kezdőképernyő elmentve.', 'success');
      ctx.go('#/', { replace: true });
    }
    if (act === 'bg-pick') {
      const file = await pickFile('image/*');
      if (!file) return;
      try {
        const blob = await processImage(file);
        await store.setMedia('bg-home', blob);
        await heroBg(el.querySelector('.hero-bg'));
        toast('Kezdőképernyő háttérképe beállítva.', 'success');
      } catch (err) {
        toast(`${err.message} A korábbi kép megmaradt.`, 'error', 6000);
      }
    }
    if (act === 'bg-del') {
      if (await confirmBox('Háttérkép törlése', 'Törlöd a kezdőképernyő saját háttérképét? (A dalszöveg háttere nem változik.)', { okLabel: 'Törlés', danger: true })) {
        await store.deleteMedia('bg-home');
        await heroBg(el.querySelector('.hero-bg'));
        toast('Kezdőképernyő háttérképe törölve.');
      }
    }
  });

  // feliratok húzása az élő előnézetben
  let drag = null;
  hero.addEventListener('pointerdown', (e) => {
    const t = e.target.closest('.hero-text');
    if (!t) return;
    e.preventDefault();
    sel = t.dataset.k;
    syncPanel();
    const r = hero.getBoundingClientRect();
    drag = { k: sel, sx: e.clientX, sy: e.clientY, x0: work[sel].x, y0: work[sel].y, w: r.width, h: r.height, id: e.pointerId };
    try { t.setPointerCapture(e.pointerId); } catch { /* */ }
    t.classList.add('dragging');
  });
  hero.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const c = work[drag.k];
    c.x = clamp(drag.x0 + ((e.clientX - drag.sx) / drag.w) * 100, 0, 100);
    c.y = clamp(drag.y0 + ((e.clientY - drag.sy) / drag.h) * 100, 0, 100);
    markDirty();
    paint();
    f('x').value = c.x; v('x').textContent = `${Math.round(c.x)}%`;
    f('y').value = c.y; v('y').textContent = `${Math.round(c.y)}%`;
  });
  const endDrag = () => { if (!drag) return; texts[drag.k].classList.remove('dragging'); drag = null; };
  hero.addEventListener('pointerup', endDrag);
  hero.addEventListener('pointercancel', endDrag);

  return {
    id: 'home-edit',
    title: 'Kezdőképernyő szerkesztése',
    back: '#/',
    nav: 'home',
    el,
    canLeave: async () => !dirty,
    leaveMessage: 'A kezdőképernyő módosításai nincsenek elmentve. Kilépsz mentés nélkül?',
  };
}

function renderDashboard(body) {
  const st = store.stats();
  const recent = store.state.recent.map((id) => store.getSong(id)).filter(Boolean).slice(0, 6);
  const { upcoming } = store.setlistsSorted();
  const next = upcoming[0];
  const quick = [
    ['#/songs', 'songs', 'blue', 'Dalok', `${st.songs} dal`],
    ['#/songs?tab=favorites', 'star', 'gold', 'Kedvencek', `${st.favorites} kedvenc`],
    ['#/songs?tab=recent', 'clock', 'teal', 'Legutóbbi', 'utolsó 20 dal'],
    ['#/setlists', 'mic', 'purple', 'Fellépés', `${st.setlists} lista`],
    ['#/new', 'plus', 'red', 'Új dal', 'beírás, fotó, fájl'],
    ['#/tags', 'tag', 'pink', 'Címkék', `${st.tags} címke`],
  ];
  body.innerHTML = `
    <div class="quick-grid">
      ${quick.map(([href, ic, c, label, sub]) => `<a class="quick" href="${href}">${tile(ic, c, 'tile-lg')}<span class="quick-label">${label}</span><span class="quick-sub">${esc(sub)}</span></a>`).join('')}
    </div>
    ${next ? `<a class="card next-gig" href="#/setlist/${encodeURIComponent(next.id)}">
        ${tile('calendar', 'orange', 'tile-lg')}
        <span class="ng-text"><span class="ng-kicker">Következő fellépés</span><b>${esc(next.name)}</b><span class="muted">${esc(fmtISODate(next.date))} · ${next.songIds.length} dal</span></span>
        <span class="ng-play">${icon('next')}</span></a>` : ''}
    <section class="home-section">
      <h2 class="section-title">${tile('clock', 'teal', 'tile-sm')} Legutóbb megnyitott</h2>
      ${recent.length ? `<div class="song-grid">${recent.map((s) => songCardHTML(s)).join('')}</div>`
        : `<p class="muted pad">Még nem nyitottál meg dalt. ${st.songs ? '' : '<a href="#/new">Vedd fel az első dalodat!</a>'}</p>`}
    </section>`;
  bindFavButtons(body);
}
