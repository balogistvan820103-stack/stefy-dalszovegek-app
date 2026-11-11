// Fellépés mód: letisztult, teljes képernyős dalszöveg, lapozás gombbal, húzással,
// billentyűzettel és Bluetooth lapozópedállal (nyilak / PageUp / PageDown).

import * as store from '../store.js';
import { esc, toast, clamp, debounce, confirmBox, isModalOpen } from '../util.js';
import { icon } from '../icons.js';
import { applyReaderStyle, lyricsHTML, mediaURL, FONT_MIN, FONT_MAX, emptyState, fitColumns, quickEditSong } from '../components.js';
import * as night from '../night.js';

export async function performView(ctx) {
  const id = ctx.params[0];
  const list = store.state.setlists.get(id);
  await night.ensureFresh();
  // az aznap esti sorrend (vendégkérésekkel); a mentett lista ettől nem változik
  const loadSongs = () => night.tonightIds(list).map((sid) => store.getSong(sid)).filter(Boolean);
  let songs = list ? loadSongs() : [];
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
        <div class="pf-sub"><span class="pf-pos"></span><span class="pf-played" hidden>${icon('check')} lejátszva</span><span class="pf-next"></span></div>
      </div>
      <div class="pf-clock" data-clock role="timer" aria-label="Pontos idő"></div>
      <div class="pf-tools">
        <button type="button" class="pf-btn pf-req-btn" data-act="request" aria-label="Vendégkérés: dal keresése">${icon('search')}</button>
        <button type="button" class="pf-btn" data-act="smaller" aria-label="Kisebb betű">A<sup>−</sup></button>
        <button type="button" class="pf-btn" data-act="bigger" aria-label="Nagyobb betű">A<sup>+</sup></button>
        <button type="button" class="pf-btn pf-edit-btn" data-act="edit-song" aria-label="Dalszöveg szerkesztése">${icon('edit')}</button>
        <button type="button" class="pf-btn pf-played-btn" data-act="played" aria-label="Lejátszottnak jelölés" aria-pressed="false">${icon('check')}</button>
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
    <div class="pf-req" hidden>
      <div class="pf-req-box">
        <div class="pf-drawer-head"><b>${icon('search')} Vendégkérés</b><button type="button" class="icon-btn" data-act="close-req" aria-label="Bezárás">${icon('x')}</button></div>
        <input type="search" class="search-input pf-req-input" placeholder="Pár betű a címből vagy a szövegből (ékezet nélkül is)…" autocomplete="off" enterkeyhint="search" aria-label="Dal keresése">
        <p class="muted small pf-req-hint">Koppints a dalra: az lesz a következő, utána a lista ott folytatódik, ahol abbahagytad. A mentett lista nem változik.</p>
        <ol class="pf-req-list"></ol>
      </div>
    </div>
    <div class="pf-drawer" hidden>
      <div class="pf-drawer-box">
        <div class="pf-drawer-head"><b>${esc(list.name)}</b><button type="button" class="icon-btn" data-act="close-list" aria-label="Bezárás">${icon('x')}</button></div>
        <ol class="pf-drawer-list"></ol>
        <div class="pf-drawer-foot"><span class="muted small" data-played-count></span>
          <button type="button" class="btn btn-ghost btn-sm" data-act="reset-order" hidden>${icon('list')} Mentett sorrend vissza</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="new-night">${icon('reset')} Új este – jelölések törlése</button></div>
      </div>
    </div>`;

  const lyr = el.querySelector('.pf-lyrics');
  const scroller = el.querySelector('.pf-scroll');
  const drawer = el.querySelector('.pf-drawer');
  const req = el.querySelector('.pf-req');
  const reqInput = el.querySelector('.pf-req-input');

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
    paintMeta();
    lyr.innerHTML = lyricsHTML(s.lyrics, r.highlightSections);
    scroller.scrollTop = 0;
    refit();
    paintPlayed();
    onSong = 0;
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

  // kéthasábos nézet fekvő tableten, ha a dal egy hasábban nem fér ki
  const refit = () => requestAnimationFrame(() => { if (lyr.isConnected) fitColumns(lyr, scroller.clientHeight - 36); });
  const onResize = debounce(refit, 150);
  window.addEventListener('resize', onResize);

  const paintMeta = () => {
    el.querySelector('.pf-pos').textContent = `${idx + 1} / ${songs.length}`;
    const nxt = songs[idx + 1];
    const isReq = nxt && night.requestedSet(id).has(nxt.id);
    el.querySelector('.pf-next').textContent = store.settings('app').showNext && nxt ? `Következő: ${nxt.title}${isReq ? ' (kérés)' : ''}` : (nxt ? '' : 'Utolsó dal');
    el.querySelector('.pf-prev').disabled = idx === 0;
    el.querySelector('.pf-next-btn').disabled = idx === songs.length - 1;
  };

  /* ----- vendégkérés: keresés és beszúrás a következő helyre ----- */
  const renderReq = () => {
    const q = reqInput.value.trim();
    const listEl = el.querySelector('.pf-req-list');
    if (!q) { listEl.innerHTML = ''; return; }
    const played = night.playedSet();
    const pos = new Map(songs.map((s, i) => [s.id, i]));
    const hits = store.querySongs({ query: q, sort: 'title' }).slice(0, 40);
    listEl.innerHTML = hits.length ? hits.map(({ song: s }) => {
      const p = pos.get(s.id);
      const tags = [];
      if (p === idx) tags.push('<span class="req-tag now">most szól</span>');
      else if (p !== undefined) tags.push(`<span class="req-tag">a listán: ${p + 1}.</span>`);
      if (played.has(s.id)) tags.push(`<span class="req-tag played">${icon('check')} lejátszva</span>`);
      return `<li><button type="button" data-req="${esc(s.id)}" class="${played.has(s.id) ? 'is-played' : ''}"><span class="pf-dl-title">${esc(s.title)}${s.artist ? ` <small class="muted">– ${esc(s.artist)}</small>` : ''}</span>${tags.join('')}</button></li>`;
    }).join('') : '<li class="muted pad">Nincs találat.</li>';
  };
  const openReq = () => {
    drawer.hidden = true;
    reqInput.value = '';
    renderReq();
    req.hidden = false;
    setTimeout(() => reqInput.focus(), 30);
  };
  const closeReq = () => { req.hidden = true; reqInput.blur(); };
  reqInput.addEventListener('input', debounce(renderReq, 120));
  const requestSong = async (sid) => {
    const r = night.insertNext(songs.map((s) => s.id), idx, sid);
    const title = store.getSong(sid)?.title || 'A dal';
    if (r.isCurrent) { toast(`„${title}” szól most.`, 'info', 1800); return; }
    await night.setTonightOrder(list, r.ids, sid);
    songs = loadSongs();
    idx = clamp(r.idx, 0, songs.length - 1);
    ctx.silentReplace(`#/perform/${encodeURIComponent(id)}/${idx}`);
    paintMeta();
    closeReq();
    toast(`„${title}” lesz a következő dal.`, 'success', 2200);
  };

  // „lejátszva”: ha a dal legalább config.playSeconds másodpercig látható volt
  let onSong = 0;
  const paintPlayed = () => {
    const p = night.isPlayed(songs[idx].id);
    el.querySelector('.pf-played').hidden = !p;
    const b = el.querySelector('.pf-played-btn');
    b.classList.toggle('on', p);
    b.setAttribute('aria-pressed', String(p));
    b.setAttribute('aria-label', p ? 'Lejátszva – koppints a visszavonáshoz' : 'Lejátszottnak jelölés');
  };
  const playTimer = setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    onSong++;
    const sid = songs[idx]?.id;
    if (onSong === night.config.playSeconds && sid && !night.isPlayed(sid)) {
      await night.setPlayed(sid, true);
      if (songs[idx]?.id === sid) paintPlayed();
    }
  }, 1000);

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
    refit();
    toast(`Betűméret: ${r.fontSize} px`, 'info', 800);
    saveSize();
  };

  const openList = () => {
    const played = night.playedSet();
    const requested = night.requestedSet(id);
    el.querySelector('.pf-drawer-list').innerHTML = songs.map((s, i) => `<li><button type="button" data-jump="${i}" class="${i === idx ? 'on' : ''}${played.has(s.id) ? ' is-played' : ''}"><span class="set-num">${i + 1}</span><span class="pf-dl-title">${esc(s.title)}</span>${requested.has(s.id) ? '<span class="req-tag">kérés</span>' : ''}${played.has(s.id) ? `<span class="played-mark" title="lejátszva">${icon('check')}</span>` : ''}</button></li>`).join('');
    el.querySelector('[data-act=reset-order]').hidden = !night.hasTonightOrder(id);
    const n = songs.filter((s) => played.has(s.id)).length;
    el.querySelector('[data-played-count]').textContent = `${n} / ${songs.length} lejátszva ma este`;
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
    if (e.target === req) { closeReq(); return; }
    const pick = e.target.closest('[data-req]');
    if (pick) { requestSong(pick.dataset.req); return; }
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
      case 'request': openReq(); break;
      case 'edit-song': {
        const saved = await quickEditSong(songs[idx].id);
        paintLock();
        if (saved) {
          const keep = onSong;
          songs = loadSongs();
          show(idx);
          onSong = keep; // a szerkesztés nem indítja újra a „lejátszva” időmérést
        }
        break;
      }
      case 'close-req': closeReq(); break;
      case 'reset-order': {
        if (!(await confirmBox('Mentett sorrend vissza', 'Visszaállítod a lista mentett sorrendjét? A ma esti vendégkérések kikerülnek a sorrendből (a dalok megmaradnak).', { okLabel: 'Visszaállítás' }))) return;
        const cur = songs[idx]?.id;
        await night.clearTonightOrder(id);
        songs = loadSongs();
        const at = songs.findIndex((s) => s.id === cur);
        show(at >= 0 ? at : clamp(idx, 0, songs.length - 1));
        openList();
        toast('A mentett sorrend visszaállítva.', 'success');
        break;
      }
      case 'played': {
        const sid = songs[idx].id; const p = !night.isPlayed(sid);
        await night.setPlayed(sid, p);
        onSong = night.config.playSeconds + 1; // kézi döntés után ennél a megnyitásnál ne jelölje újra magától
        paintPlayed();
        toast(p ? 'Lejátszottnak jelölve.' : 'Lejátszva jelölés visszavonva.', 'success', 1000);
        break;
      }
      case 'new-night':
        if (!(await confirmBox('Új este', 'Törlöd a ma esti „lejátszva” jelöléseket és a ma esti sorrend-módosításokat? A mentett dalok és listák nem változnak.', { okLabel: 'Új este' }))) return;
        await night.newNight();
        songs = loadSongs();
        idx = clamp(idx, 0, songs.length - 1);
        show(idx);
        openList();
        toast('Új este: a jelölések törölve.', 'success');
        break;
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
    if (isModalOpen()) return; // nyitott ablak (pl. szerkesztő) alatt a pedál nem lapoz
    if (!req.hidden) { if (e.key === 'Escape') closeReq(); return; }
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
      clearInterval(playTimer);
      window.removeEventListener('resize', onResize);
      saveSize.flush();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    },
  };
}
