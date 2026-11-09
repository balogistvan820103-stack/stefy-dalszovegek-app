// Fellépés-listák: áttekintés, egy lista szerkesztése (húzásos sorrend), többdalos kijelölő.

import * as store from '../store.js';
import { esc, toast, confirmBox, modal, fmtISODate, todayISO, debounce } from '../util.js';
import { icon, tile } from '../icons.js';
import { emptyState } from '../components.js';
import { makeSortable } from '../dnd.js';

const LIST_COLORS = ['purple', 'blue', 'teal', 'gold', 'red', 'pink', 'orange', 'green'];

async function setlistDialog(title, { name = '', date = todayISO() } = {}) {
  return modal({
    title,
    body: `<label class="field"><span class="field-label">Név</span><input class="input" name="name" maxlength="120" value="${esc(name)}" placeholder="pl. Esküvő – Kovács család"><span class="field-error" hidden>Adj nevet a listának.</span></label>
      <label class="field"><span class="field-label">Dátum</span><input class="input" type="date" name="date" value="${esc(date)}"></label>`,
    buttons: [{ label: 'Mégse', value: null, kind: 'ghost' }, { label: 'Mentés', value: true, kind: 'primary' }],
    getValue: (box) => {
      const n = box.querySelector('[name=name]').value.trim();
      if (!n) { box.querySelector('.field-error').hidden = false; return undefined; }
      return { name: n, date: box.querySelector('[name=date]').value };
    },
  });
}

/* ---------------- Áttekintés ---------------- */

export function setlistsView(ctx) {
  const el = document.createElement('div');
  el.className = 'page setlists-page';

  const card = (l, i) => `
    <div class="card setlist-card" data-id="${esc(l.id)}">
      <a class="sl-main" href="#/setlist/${encodeURIComponent(l.id)}">
        ${tile('mic', LIST_COLORS[i % LIST_COLORS.length], 'tile-lg')}
        <span class="sl-text"><b>${esc(l.name)}</b><span class="muted">${icon('calendar')} ${esc(fmtISODate(l.date))} · ${l.songIds.length} dal</span></span>
      </a>
      <div class="sl-actions">
        <button type="button" class="btn btn-primary btn-sm" data-act="perform" ${l.songIds.length ? '' : 'disabled'}>${icon('play')} Fellépés</button>
        <button type="button" class="icon-btn icon-btn-teal" data-act="dup" aria-label="Duplikálás">${icon('copy')}</button>
        <button type="button" class="icon-btn icon-btn-red" data-act="delete" aria-label="Törlés">${icon('trash')}</button>
      </div>
    </div>`;

  function render() {
    const { upcoming, past } = store.setlistsSorted();
    el.innerHTML = `
      <button type="button" class="btn btn-primary btn-block btn-lg" data-act="new">${icon('plus')} Új fellépés-lista</button>
      ${!upcoming.length && !past.length ? emptyState('mic', 'purple', 'Még nincs fellépés-lista', 'Hozz létre listát névvel és dátummal, add hozzá a dalokat, majd indítsd a fellépés módot.') : ''}
      ${upcoming.length ? `<h2 class="section-title">${tile('calendar', 'gold', 'tile-sm')} Közelgő fellépések</h2><div class="setlist-grid">${upcoming.map(card).join('')}</div>` : ''}
      ${past.length ? `<h2 class="section-title">${tile('clock', 'blue', 'tile-sm')} Korábbi és dátum nélküli listák</h2><div class="setlist-grid">${past.map((l, i) => card(l, i + 3)).join('')}</div>` : ''}`;
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'new') {
      const res = await setlistDialog('Új fellépés-lista');
      if (!res) return;
      const l = await store.createSetlist(res);
      toast('Lista létrehozva.', 'success');
      ctx.go(`#/setlist/${encodeURIComponent(l.id)}/add`);
      return;
    }
    const id = b.closest('[data-id]')?.dataset.id;
    const l = store.state.setlists.get(id);
    if (!l) return;
    if (act === 'perform') ctx.go(`#/perform/${encodeURIComponent(id)}/0`);
    if (act === 'dup') { await store.duplicateSetlist(id); toast('Lista duplikálva.', 'success'); render(); }
    if (act === 'delete') {
      if (store.settings('app').performLock) { toast('Zárolt módban nem lehet listát törölni.', 'error'); return; }
      const ok = await confirmBox('Lista törlése', `Törlöd a(z) „${l.name}” listát? A dalok megmaradnak, csak a lista törlődik.`, { okLabel: 'Törlés', danger: true });
      if (ok) { await store.deleteSetlist(id); toast('Lista törölve.'); render(); }
    }
  });

  render();
  return { id: 'setlists', title: 'Fellépés-listák', back: '#/', nav: 'perform', el, restoreScroll: true };
}

/* ---------------- Egy lista ---------------- */

export function setlistView(ctx) {
  const id = ctx.params[0];
  const el = document.createElement('div');
  el.className = 'page setlist-page';
  if (!store.state.setlists.has(id)) {
    el.innerHTML = emptyState('mic', 'red', 'A lista nem található', 'Lehet, hogy időközben törölték.', '<a class="btn btn-primary" href="#/setlists">Vissza a listákhoz</a>');
    return { title: 'Fellépés-lista', back: '#/setlists', nav: 'perform', el };
  }
  let stopSort = () => {};

  function render() {
    const l = store.state.setlists.get(id);
    const songs = store.setlistSongs(id);
    const locked = store.settings('app').performLock;
    el.innerHTML = `
      <div class="card setlist-head">
        ${tile('mic', 'purple', 'tile-lg')}
        <div class="sh-text"><h2>${esc(l.name)}</h2><span class="muted">${icon('calendar')} ${esc(fmtISODate(l.date))} · ${songs.length} dal</span></div>
        <button type="button" class="icon-btn icon-btn-blue" data-act="edit" aria-label="Név és dátum módosítása">${icon('edit')}</button>
      </div>
      <div class="action-row">
        <button type="button" class="btn btn-primary btn-lg" data-act="perform" ${songs.length ? '' : 'disabled'}>${icon('play')} Fellépés indítása</button>
        <a class="btn btn-teal btn-lg${locked ? ' disabled' : ''}" href="#/setlist/${encodeURIComponent(id)}/add" data-act="add">${icon('plus')} Dalok hozzáadása</a>
        <button type="button" class="btn btn-ghost" data-act="dup">${icon('copy')} Duplikálás</button>
        <button type="button" class="btn ${locked ? 'btn-red' : 'btn-ghost'}" data-act="lock">${icon(locked ? 'lock' : 'unlock')} ${locked ? 'Zárolva' : 'Zárolás'}</button>
      </div>
      ${songs.length ? `<p class="muted small">${locked ? `${icon('lock')} Zárolt mód: a sorrend és a lista nem módosítható.` : `${icon('grip')} A sorrendet a fogantyúval húzva módosíthatod – automatikusan mentődik.`}</p>
        <ol class="set-list${locked ? '' : ' can-drag'}">${songs.map((s, i) => `
          <li class="set-row" data-id="${esc(s.id)}" style="--accent:${esc(store.songColor(s))}">
            ${locked ? '' : `<button type="button" class="grip" aria-label="Áthelyezés húzással">${icon('grip')}</button>`}
            <span class="set-num">${i + 1}</span>
            <a class="set-title" href="#/perform/${encodeURIComponent(id)}/${i}">${esc(s.title)}</a>
            ${locked ? '' : `<button type="button" class="icon-btn icon-btn-red icon-btn-sm" data-act="remove" aria-label="Eltávolítás a listáról">${icon('x')}</button>`}
          </li>`).join('')}</ol>`
    : emptyState('songs', 'teal', 'A lista még üres', 'Koppints a „Dalok hozzáadása” gombra, és jelölj ki egyszerre több dalt.')}`;
    stopSort();
    const ol = el.querySelector('.set-list');
    if (ol && !locked) {
      stopSort = makeSortable(ol, {
        itemSelector: '.set-row',
        handleSelector: '.grip',
        onReorder: async (ids) => {
          await store.updateSetlist(id, { songIds: ids });
          render();
          toast('Sorrend elmentve.', 'success', 1200);
        },
      });
    } else stopSort = () => {};
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const l = store.state.setlists.get(id);
    const locked = store.settings('app').performLock;
    if (act === 'add' && locked) { e.preventDefault(); toast('Zárolt módban nem lehet dalt hozzáadni.', 'error'); return; }
    if (act === 'perform') {
      try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch { /* nem kötelező */ }
      ctx.go(`#/perform/${encodeURIComponent(id)}/0`);
    }
    if (act === 'edit') {
      const res = await setlistDialog('Lista módosítása', { name: l.name, date: l.date });
      if (res) { await store.updateSetlist(id, res); render(); toast('Lista módosítva.', 'success'); }
    }
    if (act === 'dup') {
      const copy = await store.duplicateSetlist(id);
      toast('Lista duplikálva – a másolatot nyitottam meg.', 'success');
      ctx.go(`#/setlist/${encodeURIComponent(copy.id)}`, { replace: true });
    }
    if (act === 'lock') {
      if (locked) {
        const ok = await confirmBox('Zárolás feloldása', 'Feloldod a zárolást? Ezután újra lehet szerkeszteni és átrendezni.', { okLabel: 'Feloldás' });
        if (!ok) return;
      }
      await store.patchSettings('app', { performLock: !locked });
      toast(!locked ? 'Zárolva: a véletlen szerkesztés és átrendezés tiltva.' : 'Zárolás feloldva.', 'success');
      ctx.rerender();
    }
    if (act === 'remove') {
      const sid = b.closest('[data-id]').dataset.id;
      const s = store.getSong(sid);
      await store.removeFromSetlist(id, sid);
      render();
      toast(`„${s?.title || 'Dal'}” lekerült a listáról.`);
    }
  });

  render();
  return { id: 'setlist', title: store.state.setlists.get(id).name, back: '#/setlists', nav: 'perform', el, restoreScroll: true, cleanup: () => stopSort() };
}

/* ---------------- Többdalos kijelölés ---------------- */

export function pickerView(ctx) {
  const id = ctx.params[0];
  const el = document.createElement('div');
  el.className = 'page picker-page';
  const l = store.state.setlists.get(id);
  if (!l) {
    el.innerHTML = emptyState('mic', 'red', 'A lista nem található', '', '<a class="btn btn-primary" href="#/setlists">Vissza</a>');
    return { title: 'Dalok hozzáadása', back: '#/setlists', nav: 'perform', el };
  }
  const already = new Set(l.songIds);
  const selected = [];
  const selSet = new Set();
  let query = '';
  let filter = 'all';

  el.innerHTML = `
    <div class="sticky-tools">
      <div class="search-box">${icon('search', 'search-ico')}
        <input type="search" class="search-input" placeholder="Dal keresése…" aria-label="Keresés" autocomplete="off">
      </div>
      <div class="picker-filters">
        <select class="input input-sm" aria-label="Szűrés">
          <option value="all">Összes dal</option><option value="favorites">Kedvencek</option><option value="recent">Legutóbbi</option>
          ${store.tagsSorted().map((t) => `<option value="tag:${esc(t.id)}">Címke: ${esc(t.name)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn-ghost btn-sm" data-act="all">${icon('check')} Látható mind</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="none">${icon('x')} Kijelölés törlése</button>
      </div>
    </div>
    <div class="song-grid pick-grid"></div>
    <div class="pick-bar">
      <span class="pick-count"><b>0</b> kijelölve</span>
      <button type="button" class="btn btn-primary btn-lg" data-act="commit" disabled>${icon('plus')} Kijelöltek hozzáadása</button>
    </div>`;
  const grid = el.querySelector('.pick-grid');
  const countEl = el.querySelector('.pick-count b');
  const commitBtn = el.querySelector('[data-act=commit]');

  const visible = () => {
    let tab = filter; let tagId = null;
    if (filter.startsWith('tag:')) { tab = 'tag'; tagId = filter.slice(4); }
    return store.querySongs({ query, tab, tagId, sort: 'title' }).map((x) => x.song);
  };

  const render = () => {
    const songs = visible();
    grid.innerHTML = songs.length ? songs.map((s) => {
      const on = selSet.has(s.id); const has = already.has(s.id);
      return `<button type="button" class="pick-card${on ? ' on' : ''}${has ? ' has' : ''}" data-id="${esc(s.id)}" ${has ? 'disabled' : ''} aria-pressed="${on}" style="--accent:${esc(store.songColor(s))}">
        <span class="pick-check">${has || on ? icon('check') : ''}</span>
        <span class="song-title">${esc(s.title)}</span>${has ? '<span class="match-badge">már a listán</span>' : ''}</button>`;
    }).join('') : emptyState('search', 'blue', 'Nincs találat', query ? 'Próbálj másik keresőszót.' : 'Ebben a nézetben nincs dal.');
    updateBar();
  };
  const updateBar = () => {
    countEl.textContent = String(selected.length);
    commitBtn.disabled = !selected.length;
  };
  const toggle = (sid, on) => {
    if (already.has(sid)) return;
    if (on && !selSet.has(sid)) { selSet.add(sid); selected.push(sid); }
    if (!on && selSet.has(sid)) { selSet.delete(sid); selected.splice(selected.indexOf(sid), 1); }
  };

  const search = debounce(render, 120);
  el.querySelector('.search-input').addEventListener('input', (e) => { query = e.target.value; search(); });
  el.querySelector('select').addEventListener('change', (e) => { filter = e.target.value; render(); });
  grid.addEventListener('click', (e) => {
    const c = e.target.closest('.pick-card');
    if (!c || c.disabled) return;
    const sid = c.dataset.id;
    toggle(sid, !selSet.has(sid));
    const on = selSet.has(sid);
    c.classList.toggle('on', on);
    c.setAttribute('aria-pressed', String(on));
    c.querySelector('.pick-check').innerHTML = on ? icon('check') : '';
    updateBar();
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'all') { for (const s of visible()) toggle(s.id, true); render(); }
    if (b.dataset.act === 'none') { for (const sid of [...selected]) toggle(sid, false); render(); }
    if (b.dataset.act === 'commit') {
      if (store.settings('app').performLock) { toast('Zárolt módban nem lehet dalt hozzáadni.', 'error'); return; }
      const { added, skipped } = await store.addSongsToSetlist(id, selected);
      toast(`${added} dal hozzáadva a lista végére${skipped ? `, ${skipped} már rajta volt` : ''}.`, 'success');
      selected.length = 0; selSet.clear();
      ctx.goBack(`#/setlist/${encodeURIComponent(id)}`, { strict: true });
    }
  });

  render();
  return { id: 'picker', title: `Dalok hozzáadása: ${l.name}`, back: `#/setlist/${encodeURIComponent(id)}`, nav: 'perform', el };
}
