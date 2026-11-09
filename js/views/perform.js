// Fellépés mód: letisztult, teljes képernyős dalszöveg, lapozás gombbal, húzással,
// billentyűzettel és Bluetooth lapozópedállal (nyilak / PageUp / PageDown).

import * as store from '../store.js';
import { esc, toast, clamp, debounce, confirmBox } from '../util.js';
import { icon } from '../icons.js';
import { applyReaderStyle, lyricsHTML, mediaURL, FONT_MIN, FONT_MAX, emptyState } from '../components.js';

export async function performView(ctx) {
  const id = ctx.params[0];
  const list = store.state.setlists.get(id);
  const songs = store.setlistSongs(id);
  if (!list || !songs.length) {
    const el = document.createElement('div');
    el.className = 'page';
    el.innerHTML = emptyState('mic', 'purple', list ? 'A lista üres' : 'A lista nem található', 'Adj dalokat a listához a fellépés indítása előtt.', `<a class="btn btn-primary" href="#/setlist${list ? '/' + encodeURIComponent(id) : 's'}">Vissza</a>`);
    return { title: 'Fellépés', back: '#/setlists', nav: 'perform', el };
  }
  let idx = clamp(Number(ctx.params[1]) || 0, 0, songs.length - 1);
  const bgUrl = await mediaURL('bg-reader');

  const el = document.createElement('div');
  el.className = 'perform' + (bgUrl ? ' has-bg' : '');
  el.innerHTML = `
    <div class="reader-bg" ${bgUrl ? `style="background-image:url('${bgUrl}')"` : ''}></div>
    <div class="reader-shade"></div>
    <header class="pf-top">
      <button type="button" class="back-btn pf-exit" data-act="exit" aria-label="Kilépés a fellépés módból">${icon('back')}</button>
      <div class="pf-info">
        <div class="pf-title"></div>
        <div class="pf-sub"><span class="pf-pos"></span><span class="pf-next"></span></div>
      </div>
      <div class="pf-tools">
        <button type="button" class="pf-btn" data-act="smaller" aria-label="Kisebb betű">A<sup>−</sup></button>
        <button type="button" class="pf-btn" data-act="bigger" aria-label="Nagyobb betű">A<sup>+</sup></button>
        <button type="button" class="pf-btn pf-lock" data-act="lock" aria-label="Zárolás"></button>
        <button type="button" class="pf-btn" data-act="fullscreen" aria-label="Teljes képernyő">${icon('fullscreen')}</button>
      </div>
    </header>
    <div class="pf-stage"><div class="pf-scroll"><div class="lyrics pf-lyrics"></div><div class="pf-end"></div></div></div>
    <footer class="pf-bottom">
      <button type="button" class="pf-nav pf-prev" data-act="prev">${icon('prev')}<span>Előző</span></button>
      <button type="button" class="pf-nav pf-list" data-act="list">${icon('list')}<span>Ugrás a listára</span></button>
      <button type="button" class="pf-nav pf-fav" data-act="fav">${icon('star')}<span>Kedvenc</span></button>
      <button type="button" class="pf-nav pf-next-btn" data-act="next"><span>Következő</span>${icon('next')}</button>
    </footer>
    <div class="pf-drawer" hidden>
      <div class="pf-drawer-box">
        <div class="pf-drawer-head"><b>${esc(list.name)}</b><button type="button" class="icon-btn" data-act="close-list" aria-label="Bezárás">${icon('x')}</button></div>
        <ol class="pf-drawer-list"></ol>
      </div>
    </div>`;

  const lyr = el.querySelector('.pf-lyrics');
  const scroller = el.querySelector('.pf-scroll');
  const drawer = el.querySelector('.pf-drawer');

  const paintLock = () => {
    const locked = store.settings('app').performLock;
    const b = el.querySelector('.pf-lock');
    b.innerHTML = icon(locked ? 'lock' : 'unlock');
    b.classList.toggle('on', locked);
    b.setAttribute('aria-label', locked ? 'Zárolva – koppints a feloldáshoz' : 'Zárolás bekapcsolása');
  };

  const show = (i, dir = 0) => {
    idx = clamp(i, 0, songs.length - 1);
    const s = store.getSong(songs[idx].id) || songs[idx];
    const r = store.settings('reader');
    applyReaderStyle(el, r);
    el.querySelector('.pf-title').textContent = s.title;
    el.querySelector('.pf-pos').textContent = `${idx + 1} / ${songs.length}`;
    const nxt = songs[idx + 1];
    el.querySelector('.pf-next').textContent = store.settings('app').showNext && nxt ? `Következő: ${nxt.title}` : (nxt ? '' : 'Utolsó dal');
    lyr.innerHTML = lyricsHTML(s.lyrics, r.highlightSections);
    scroller.scrollTop = 0;
    el.querySelector('.pf-prev').disabled = idx === 0;
    el.querySelector('.pf-next-btn').disabled = idx === songs.length - 1;
    const fav = el.querySelector('.pf-fav');
    fav.classList.toggle('on', !!s.favorite);
    fav.setAttribute('aria-pressed', String(!!s.favorite));
    if (dir) {
      lyr.classList.remove('slide-l', 'slide-r');
      void lyr.offsetWidth;
      lyr.classList.add(dir > 0 ? 'slide-l' : 'slide-r');
    }
    ctx.silentReplace(`#/perform/${encodeURIComponent(id)}/${idx}`);
    store.markOpened(s.id);
  };

  const go = (d) => {
    const n = idx + d;
    if (n < 0 || n >= songs.length) { toast(d > 0 ? 'Ez az utolsó dal a listán.' : 'Ez az első dal a listán.', 'info', 1200); return; }
    show(n, d);
  };

  const saveSize = debounce(() => store.saveSettings('reader', store.settings('reader')), 400);
  const resize = (d) => {
    const r = store.settings('reader');
    r.fontSize = clamp(Number(r.fontSize) + d, FONT_MIN, FONT_MAX);
    applyReaderStyle(el, r);
    toast(`Betűméret: ${r.fontSize} px`, 'info', 800);
    saveSize();
  };

  const openList = () => {
    el.querySelector('.pf-drawer-list').innerHTML = songs.map((s, i) => `<li><button type="button" data-jump="${i}" class="${i === idx ? 'on' : ''}"><span class="set-num">${i + 1}</span>${esc(s.title)}</button></li>`).join('');
    drawer.hidden = false;
    el.querySelector('.pf-drawer-list .on')?.scrollIntoView({ block: 'center' });
  };

  const exit = async () => {
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch { /* */ } }
    ctx.go(`#/setlist/${encodeURIComponent(id)}`, { replace: true });
  };

  el.addEventListener('click', async (e) => {
    const jump = e.target.closest('[data-jump]');
    if (jump) { drawer.hidden = true; const n = Number(jump.dataset.jump); show(n, n > idx ? 1 : -1); return; }
    if (e.target === drawer) { drawer.hidden = true; return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'prev': go(-1); break;
      case 'next': go(1); break;
      case 'list': openList(); break;
      case 'close-list': drawer.hidden = true; break;
      case 'smaller': resize(-2); break;
      case 'bigger': resize(2); break;
      case 'exit': exit(); break;
      case 'fav': {
        const s = await store.toggleFavorite(songs[idx].id);
        songs[idx] = s;
        show(idx);
        toast(s.favorite ? 'Kedvencnek jelölve.' : 'Eltávolítva a kedvencekből.', 'success', 1000);
        break;
      }
      case 'fullscreen':
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        } catch { toast('A teljes képernyő ezen az eszközön nem érhető el.', 'error'); }
        break;
      case 'lock': {
        const locked = store.settings('app').performLock;
        if (locked && !(await confirmBox('Zárolás feloldása', 'Feloldod a zárolást? Ezután újra lehet szerkeszteni és átrendezni.', { okLabel: 'Feloldás' }))) return;
        await store.patchSettings('app', { performLock: !locked });
        paintLock();
        toast(!locked ? 'Zárolva: a szerkesztés és az átrendezés tiltva.' : 'Zárolás feloldva.', 'success', 1600);
        break;
      }
      default: break;
    }
  });

  // vízszintes húzás (swipe) lapozáshoz – a függőleges görgetés natív marad
  let sw = null;
  const stage = el.querySelector('.pf-stage');
  // egér/toll: pointer események; érintés: touch események (így nincs dupla lapozás)
  stage.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch' && e.button === 0) sw = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId }; });
  stage.addEventListener('pointerup', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x; const dy = e.clientY - sw.y; const dt = Date.now() - sw.t;
    sw = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && dt < 900) go(dx < 0 ? 1 : -1);
  });
  stage.addEventListener('pointercancel', () => { sw = null; });
  let touch = null;
  stage.addEventListener('touchstart', (e) => { const t = e.touches[0]; touch = { x: t.clientX, y: t.clientY, t: Date.now() }; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x; const dy = t.clientY - touch.y; const dt = Date.now() - touch.t;
    touch = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && dt < 900) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if (!drawer.hidden && e.key === 'Escape') { drawer.hidden = true; return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'PageDown' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      if (atEnd && e.key === 'PageDown') go(1);
      else scroller.scrollBy({ top: e.key === 'ArrowDown' ? 80 : scroller.clientHeight * 0.8, behavior: 'smooth' });
    } else if (e.key === 'PageUp' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (scroller.scrollTop <= 2 && e.key === 'PageUp') go(-1);
      else scroller.scrollBy({ top: e.key === 'ArrowUp' ? -80 : -scroller.clientHeight * 0.8, behavior: 'smooth' });
    }
  };
  document.addEventListener('keydown', onKey);

  paintLock();
  show(idx);
  // gyors előzetes betöltés nincs szükséges – minden dal memóriában van

  return {
    id: 'perform',
    title: list.name,
    fullscreen: true,
    back: `#/setlist/${encodeURIComponent(id)}`,
    nav: 'perform',
    el,
    cleanup: () => {
      document.removeEventListener('keydown', onKey);
      saveSize.flush();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    },
  };
}
