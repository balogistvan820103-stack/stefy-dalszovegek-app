// Dalok listája (keresés, fülek, címkeszűrés, rendezés, húzásos kézi sorrend) és címkekezelő.

import * as store from '../store.js';
import { esc, debounce, toast, confirmBox, promptBox, modal, fmtISODate, todayISO } from '../util.js';
import { txtImportFlow } from '../txtimport.js';
import { icon, tile } from '../icons.js';
import { songCardHTML, bindFavButtons, emptyState } from '../components.js';
import { makeSortable } from '../dnd.js';

let lastQuery = '';

const TABS = [
  { key: 'all', label: 'Összes', icon: 'songs', color: 'blue' },
  { key: 'favorites', label: 'Kedvencek', icon: 'star', color: 'gold' },
  { key: 'recent', label: 'Legutóbbi', icon: 'clock', color: 'teal' },
  { key: 'tag', label: 'Címkék', icon: 'tag', color: 'pink' },
];

export function songsView(ctx) {
  const app = store.settings('app');
  let tab = ctx.query.get('tab') || app.songsTab || 'all';
  if (!TABS.some((t) => t.key === tab)) tab = 'all';
  let tagId = ctx.query.get('tag') || app.tagFilter;
  if (tagId && !store.state.tags.has(tagId)) tagId = null;
  if (ctx.query.get('tag')) tab = 'tag';
  let query = lastQuery;
  let selecting = false;
  const selected = new Set();

  const el = document.createElement('div');
  el.className = 'page songs-page';
  el.innerHTML = `
    <div class="tool-row">
      <button type="button" class="btn btn-orange btn-sm" data-act="import-folder">${icon('folder')} Mappa importálása</button>
      <button type="button" class="btn btn-gold btn-sm" data-act="import-files">${icon('upload')} Fájlok tömeges importálása</button>
      <button type="button" class="btn btn-teal btn-sm" data-act="select">${icon('check')} Több dal kijelölése</button>
      <a class="btn btn-purple btn-sm" href="#/new">${icon('plus')} Új dal</a>
    </div>
    <p class="muted small tool-note">Word (DOCX, DOC), TXT, ODT és RTF fájlokat és almappákat is beolvas; az almappa neve címke lesz.</p>
    <div class="sticky-tools">
      <div class="search-box">
        ${icon('search', 'search-ico')}
        <input type="search" class="search-input" placeholder="Keresés a teljes dalszövegben, címben, előadóban, címkében…" value="${esc(query)}" aria-label="Keresés" enterkeyhint="search" autocomplete="off">
        <button type="button" class="search-clear" aria-label="Keresés törlése" ${query ? '' : 'hidden'}>${icon('x')}</button>
      </div>
      <div class="tabs" role="tablist">
        ${TABS.map((t) => `<button type="button" role="tab" class="tab tab-${t.color}" data-tab="${t.key}">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}
      </div>
      <div class="tag-chips" hidden></div>
      <div class="list-tools">
        <span class="count"></span>
        <span class="spacer"></span>
        <div class="size-tools" role="group" aria-label="Dalcímek mérete">
          <button type="button" class="size-btn" data-tsize="-2" aria-label="Kisebb dalcímek">A<sup>−</sup></button>
          <button type="button" class="size-btn" data-tsize="2" aria-label="Nagyobb dalcímek">A<sup>+</sup></button>
        </div>
        <label class="sort-select">${icon('sort')}<select aria-label="Rendezés">${Object.entries(store.SORTS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      </div>
      <div class="reorder-hint" hidden></div>
    </div>
    <div class="song-grid" id="songList"></div>
    <a class="fab" href="#/new" aria-label="Új dal">${icon('plus')}</a>
    <div class="select-bar" hidden>
      <div class="sb-top"><span class="sb-count"><b>0</b> kijelölve</span>
        <button type="button" class="btn btn-ghost btn-sm" data-act="sel-all">${icon('check')} Összes látható</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="sel-none">${icon('x')} Kijelölés törlése</button></div>
      <div class="sb-actions">
        <button type="button" class="btn btn-purple btn-sm" data-act="bulk-setlist">${icon('mic')} Fellépés-listához</button>
        <button type="button" class="btn btn-pink btn-sm" data-act="bulk-tag">${icon('tag')} Címke</button>
        <button type="button" class="btn btn-gold btn-sm" data-act="bulk-fav">${icon('star')} Kedvenc</button>
        <button type="button" class="btn btn-danger btn-sm" data-act="bulk-delete">${icon('trash')} Törlés</button>
        <button type="button" class="btn btn-primary btn-sm" data-act="select">${icon('check')} Kész</button>
      </div>
    </div>`;

  const input = el.querySelector('.search-input');
  const clearBtn = el.querySelector('.search-clear');
  const list = el.querySelector('#songList');
  const chips = el.querySelector('.tag-chips');
  const sortSel = el.querySelector('select');
  const count = el.querySelector('.count');
  const hint = el.querySelector('.reorder-hint');
  const bar = el.querySelector('.select-bar');

  const sortKey = () => (tab === 'tag' ? 'tag' : tab);
  const currentSort = () => store.settings('app').sorts?.[sortKey()] || 'title';
  const canDrag = () => !selecting && tab !== 'recent' && currentSort() === 'manual' && !query.trim() && !store.settings('app').performLock;
  let visibleIds = [];

  function renderChips() {
    chips.hidden = !(tab === 'tag' || tab === 'all');
    if (chips.hidden) return;
    const tags = store.tagsSorted();
    if (tab === 'tag' && !tagId && tags.length) tagId = tags[0].id;
    const allOn = tab === 'all';
    chips.innerHTML = `<button type="button" class="chip chip-all${allOn ? ' on' : ''}" data-tag="">Mindegyik <small>${store.state.songs.size}</small></button>`
      + tags.map((t) => `<button type="button" class="chip${!allOn && t.id === tagId ? ' on' : ''}" data-tag="${esc(t.id)}" style="--c:${esc(t.color)}">${esc(t.name)} <small>${store.tagCount(t.id)}</small></button>`).join('')
      + `<a class="chip chip-manage" href="#/tags">${icon('settings')} Címkék kezelése</a>`;
  }

  function renderList() {
    const sort = currentSort();
    const items = (tab === 'tag' && !tagId) ? [] : store.querySongs({ query, tab, tagId, sort });
    visibleIds = items.map((x) => x.song.id);
    const drag = canDrag();
    list.classList.toggle('can-drag', drag);
    list.classList.toggle('selecting', selecting);
    count.textContent = `${items.length} dal`;
    sortSel.value = sort;
    sortSel.parentElement.hidden = tab === 'recent';
    if (!selecting && tab !== 'recent' && sort === 'manual' && !drag) {
      hint.hidden = false;
      hint.textContent = store.settings('app').performLock ? 'A fellépés-zárolás miatt az átrendezés tiltva van.' : 'Kereséskor az átrendezés szünetel – töröld a keresést a húzáshoz.';
    } else if (drag) {
      hint.hidden = false;
      hint.innerHTML = `${icon('grip')} Fogd meg a dal bal oldali fogantyúját, és húzd a helyére.`;
    } else hint.hidden = true;

    if (!items.length) { list.innerHTML = renderEmpty(); updateBar(); return; }
    list.innerHTML = items.map(({ song, match }) => songCardHTML(song, { draggable: drag, match, selectable: selecting, selected: selected.has(song.id) })).join('');
    updateBar();
  }

  function renderEmpty() {
    if (query.trim()) return emptyState('search', 'blue', 'Nincs találat', `Egyetlen dal sem tartalmazza ezt: „${query.trim()}”.`);
    if (tab === 'favorites') return emptyState('star', 'gold', 'Még nincs kedvenc', 'A dalok melletti csillaggal jelölheted meg a kedvenceidet.');
    if (tab === 'recent') return emptyState('clock', 'teal', 'Még nincs megnyitott dal', 'Az utoljára megnyitott 20 dal itt jelenik meg.');
    if (tab === 'tag') return store.state.tags.size ? emptyState('tag', 'pink', 'Ehhez a címkéhez nincs dal', 'A dal szerkesztésekor vagy a „Több dal kijelölése” móddal rendelhetsz hozzá címkéket.') : emptyState('tag', 'pink', 'Még nincs címke', 'Hozz létre címkéket, és rendezd csoportokba a dalaidat.', '<a class="btn btn-primary" href="#/tags">Címkék kezelése</a>');
    return emptyState('songs', 'blue', 'Még nincs dalod', 'Vedd fel az első dalt, importálj Word- vagy TXT-fájlokat, vagy egy teljes mappát, vagy tölts vissza egy mentést a Beállításokban.', '<a class="btn btn-primary" href="#/new">Új dal felvétele</a>');
  }

  function renderTabs() {
    el.querySelectorAll('[data-tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
  }

  function updateBar() {
    bar.hidden = !selecting;
    el.classList.toggle('is-selecting', selecting);
    el.querySelector('.sb-count b').textContent = String(selected.size);
    el.querySelectorAll('.sb-actions [data-act^=bulk]').forEach((b) => { b.disabled = !selected.size; });
    el.querySelectorAll('.tool-row [data-act=select]').forEach((b) => b.classList.toggle('on', selecting));
  }

  const rerenderAll = () => { renderTabs(); renderChips(); renderList(); };
  const persistUi = debounce(() => store.patchSettings('app', { songsTab: tab, tagFilter: tagId }), 400);

  const doSearch = debounce(() => { renderList(); }, 120);
  input.addEventListener('input', () => {
    query = input.value;
    lastQuery = query;
    clearBtn.hidden = !query;
    doSearch();
  });
  clearBtn.addEventListener('click', () => {
    input.value = ''; query = ''; lastQuery = ''; clearBtn.hidden = true; renderList(); input.focus();
  });
  el.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    rerenderAll(); persistUi();
  });
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]');
    if (!b) return;
    if (!b.dataset.tag) tab = 'all';
    else { tab = 'tag'; tagId = b.dataset.tag; }
    rerenderAll(); persistUi();
  });
  sortSel.addEventListener('change', async () => {
    const sorts = { ...store.settings('app').sorts, [sortKey()]: sortSel.value };
    await store.patchSettings('app', { sorts });
    renderList();
  });
  const saveSize = debounce(() => store.saveSettings('app', store.settings('app')), 400);
  el.querySelector('.size-tools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tsize]');
    if (!b) return;
    const a = store.settings('app');
    a.listTitleSize = Math.max(14, Math.min(44, Number(a.listTitleSize || 19) + Number(b.dataset.tsize)));
    applyListTitleSize(a.listTitleSize);
    toast(`Dalcímek mérete: ${a.listTitleSize} px`, 'info', 900);
    saveSize();
  });

  // kijelölő mód: koppintás a kártyán kijelöl (nem nyitja meg a dalt)
  list.addEventListener('click', (e) => {
    if (!selecting) return;
    const card = e.target.closest('.song-card');
    if (!card || e.target.closest('[data-fav]')) return;
    e.preventDefault();
    const id = card.dataset.id;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    card.classList.toggle('is-selected', selected.has(id));
    card.setAttribute('aria-selected', String(selected.has(id)));
    updateBar();
  }, true);
  bindFavButtons(list, () => { if (tab === 'favorites' || currentSort() === 'favorites') renderList(); });

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const locked = store.settings('app').performLock;
    if (act === 'import-folder' || act === 'import-files') {
      if (await txtImportFlow({ folder: act === 'import-folder' })) rerenderAll();
      return;
    }
    if (act === 'select') {
      selecting = !selecting;
      if (!selecting) selected.clear();
      renderList();
      return;
    }
    if (act === 'sel-all') { for (const id of visibleIds) selected.add(id); renderList(); return; }
    if (act === 'sel-none') { selected.clear(); renderList(); return; }
    const ids = [...selected];
    if (!ids.length) return;
    if (act === 'bulk-setlist') {
      const res = await bulkSetlistDialog(ids);
      if (res) { selected.clear(); selecting = false; renderList(); }
    }
    if (act === 'bulk-tag') {
      if (locked) { toast('Zárolt módban a címkék nem módosíthatók.', 'error'); return; }
      if (await bulkTagDialog(ids)) { rerenderAll(); }
    }
    if (act === 'bulk-fav') {
      const allFav = ids.every((id) => store.getSong(id)?.favorite);
      await store.bulkUpdateSongs(ids, (s) => ({ ...s, favorite: !allFav }));
      toast(allFav ? `${ids.length} dal lekerült a kedvencek közül.` : `${ids.length} dal kedvencnek jelölve.`, 'success');
      renderList();
    }
    if (act === 'bulk-delete') {
      if (locked) { toast('Zárolt módban nem lehet dalt törölni.', 'error'); return; }
      const names = ids.slice(0, 5).map((id) => `„${store.getSong(id)?.title}”`).join(', ');
      const ok = await confirmBox('Kijelölt dalok törlése', `Biztosan törlöd a kijelölt ${ids.length} dalt? (${names}${ids.length > 5 ? '…' : ''}) A dalok a fellépés-listákról is lekerülnek. Ez nem vonható vissza.`, { okLabel: `${ids.length} dal végleges törlése`, danger: true });
      if (!ok) return;
      const n = await store.bulkDeleteSongs(ids);
      selected.clear();
      toast(`${n} dal törölve.`, 'success');
      rerenderAll();
    }
  });

  const stopSort = makeSortable(list, {
    itemSelector: '.song-card',
    handleSelector: '.grip',
    onReorder: async (ids) => {
      if (!canDrag()) { renderList(); return; }
      await store.reorderSongs(ids);
      toast('Sorrend elmentve.', 'success', 1400);
    },
  });

  rerenderAll();

  return {
    id: 'songs',
    title: 'Dalok',
    back: '#/',
    nav: 'songs',
    el,
    restoreScroll: true,
    actions: `<a class="icon-btn icon-btn-gold" href="#/new" aria-label="Új dal">${icon('plus')}</a>`,
    cleanup: () => { stopSort(); persistUi.flush(); saveSize.flush(); },
  };
}

async function bulkSetlistDialog(ids) {
  const { upcoming, past } = store.setlistsSorted();
  const lists = [...upcoming, ...past];
  const body = document.createElement('div');
  body.innerHTML = `<p class="muted small">${ids.length} kijelölt dal kerül a lista végére (ami már rajta van, az nem duplázódik).</p>
    <div class="pick-list">
      <button type="button" class="pick-row" data-id="__new">${tile('plus', 'gold', 'tile-sm')}<span><b>Új fellépés-lista létrehozása</b><small>névvel és mai dátummal</small></span></button>
      ${lists.map((l) => `<button type="button" class="pick-row" data-id="${esc(l.id)}">${tile('mic', 'purple', 'tile-sm')}<span><b>${esc(l.name)}</b><small>${esc(fmtISODate(l.date))} · ${l.songIds.length} dal</small></span></button>`).join('')}
    </div>`;
  let target = await modal({
    title: 'Hozzáadás fellépés-listához',
    body,
    buttons: [{ label: 'Mégse', value: null, kind: 'ghost' }],
    onOpen: (box, finish) => box.addEventListener('click', (e) => { const r = e.target.closest('.pick-row'); if (r) finish(r.dataset.id); }),
  });
  if (!target) return false;
  if (target === '__new') {
    const name = await promptBox('Új fellépés-lista', { label: 'A lista neve', placeholder: 'pl. Szombati lakodalom', okLabel: 'Létrehozás' });
    if (!name) return false;
    target = (await store.createSetlist({ name, date: todayISO() })).id;
  }
  const { added, skipped } = await store.addSongsToSetlist(target, ids);
  const l = store.state.setlists.get(target);
  toast(`„${l.name}”: ${added} dal hozzáadva a végére${skipped ? `, ${skipped} már rajta volt` : ''}.`, 'success', 4500);
  return true;
}

async function bulkTagDialog(ids) {
  const tags = store.tagsSorted();
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="seg seg-wide"><button type="button" data-mode="add" class="on">${icon('plus')} Hozzáadás</button><button type="button" data-mode="remove">${icon('minus')} Eltávolítás</button></div>
    <p class="muted small">Válaszd ki a címkét, amit a(z) ${ids.length} kijelölt dalhoz adsz (vagy amit leveszel róluk).</p>
    <div class="tag-picker">${tags.map((t) => `<button type="button" class="chip" data-tag="${esc(t.id)}" style="--c:${esc(t.color)}">${esc(t.name)}</button>`).join('') || '<span class="muted">Még nincs címke.</span>'}</div>
    <div class="row-inline"><input class="input" name="newTag" maxlength="60" placeholder="Vagy új címke neve…" autocomplete="off"></div>`;
  let mode = 'add';
  const res = await modal({
    title: 'Címke a kijelölt dalokhoz',
    body,
    buttons: [{ label: 'Mégse', value: null, kind: 'ghost' }, { label: 'Alkalmazás', value: true, kind: 'primary' }],
    onOpen: (box) => box.addEventListener('click', (e) => {
      const m = e.target.closest('[data-mode]');
      if (m) { mode = m.dataset.mode; box.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === m)); }
      const c = e.target.closest('[data-tag]');
      if (c) { box.querySelectorAll('[data-tag]').forEach((x) => x.classList.toggle('on', x === c)); }
    }),
    getValue: (box) => {
      const name = box.querySelector('[name=newTag]').value.trim();
      const chosen = box.querySelector('[data-tag].on')?.dataset.tag;
      if (!name && !chosen) { toast('Válassz címkét, vagy írj be egy újat.', 'error'); return undefined; }
      return { name, chosen };
    },
  });
  if (!res) return false;
  let tagId = res.chosen;
  if (res.name) {
    if (mode === 'remove') { const t = store.findTagByName(res.name); if (!t) { toast('Nincs ilyen nevű címke.', 'error'); return false; } tagId = t.id; }
    else tagId = (await store.createTag(res.name)).id;
  }
  const t = store.state.tags.get(tagId);
  await store.bulkUpdateSongs(ids, (s) => ({ ...s, tagIds: mode === 'add' ? [...new Set([...s.tagIds, tagId])] : s.tagIds.filter((x) => x !== tagId) }));
  toast(mode === 'add' ? `„${t.name}” címke hozzáadva ${ids.length} dalhoz.` : `„${t.name}” címke levéve ${ids.length} dalról.`, 'success');
  return true;
}

export function applyListTitleSize(px = store.settings('app').listTitleSize) {
  document.documentElement.style.setProperty('--list-title', `${Math.max(14, Math.min(44, Number(px) || 19))}px`);
}

/* ---------------- Címkekezelő ---------------- */

export function tagsView(ctx) {
  const el = document.createElement('div');
  el.className = 'page tags-page';

  function render() {
    const tags = store.tagsSorted();
    el.innerHTML = `
      <form class="card add-tag">
        ${tile('tag', 'pink')}
        <input class="input" name="name" placeholder="Új címke neve (pl. Lakodalmas, Rock, Lassú)" maxlength="60" autocomplete="off">
        <button class="btn btn-primary" type="submit">${icon('plus')} Létrehozás</button>
      </form>
      ${tags.length ? `<div class="tag-list">${tags.map((t) => `
        <div class="tag-row" data-id="${esc(t.id)}">
          <button type="button" class="tag-dot" data-act="color" style="--c:${esc(t.color)}" aria-label="Szín váltása"></button>
          <a class="tag-name" href="#/songs?tab=tag&tag=${encodeURIComponent(t.id)}"><b>${esc(t.name)}</b><small>${store.tagCount(t.id)} dal</small></a>
          <button type="button" class="icon-btn icon-btn-blue" data-act="rename" aria-label="Átnevezés">${icon('edit')}</button>
          <button type="button" class="icon-btn icon-btn-red" data-act="delete" aria-label="Törlés">${icon('trash')}</button>
        </div>`).join('')}</div>`
    : emptyState('tag', 'pink', 'Még nincs címke', 'Hozz létre címkéket fent, majd a dal szerkesztésekor rendeld hozzájuk a dalokat. Egy dalnak több címkéje is lehet.')}`;
  }

  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const name = input.value.trim();
    if (!name) { toast('Adj nevet a címkének.', 'error'); return; }
    if (store.findTagByName(name)) { toast('Már létezik ilyen nevű címke.', 'error'); return; }
    await store.createTag(name);
    toast(`„${name}” címke létrehozva.`, 'success');
    render();
    el.querySelector('.add-tag input').focus();
  });

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('.tag-row').dataset.id;
    const t = store.state.tags.get(id);
    if (!t) return;
    if (b.dataset.act === 'color') {
      const i = store.TAG_COLORS.indexOf(t.color);
      await store.updateTag(id, { color: store.TAG_COLORS[(i + 1) % store.TAG_COLORS.length] });
      render();
    }
    if (b.dataset.act === 'rename') {
      const name = await promptBox('Címke átnevezése', { label: 'Új név', value: t.name });
      if (name === null) return;
      try { await store.updateTag(id, { name }); toast('Címke átnevezve.', 'success'); render(); } catch (err) { toast(err.message, 'error'); }
    }
    if (b.dataset.act === 'delete') {
      const n = store.tagCount(id);
      const ok = await confirmBox('Címke törlése', `Törlöd a(z) „${t.name}” címkét? ${n ? `${n} dalról lekerül, de maguk a dalok megmaradnak.` : ''}`, { okLabel: 'Törlés', danger: true });
      if (!ok) return;
      await store.deleteTag(id);
      toast('Címke törölve.');
      render();
    }
  });

  render();
  return { id: 'tags', title: 'Címkék', back: '#/songs', nav: 'songs', el };
}
