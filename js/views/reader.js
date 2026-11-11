// Dalszöveg-olvasó (saját háttérrel, betűpanellel) és dalszerkesztő.

import * as store from '../store.js';
import { esc, toast, confirmBox, modal, clamp, debounce, fmtISODate } from '../util.js';
import { icon, tile } from '../icons.js';
import { markRefrain } from '../lyrics.js';
import { applyReaderStyle, lyricsHTML, fontPanel, mediaURL, FONT_MIN, FONT_MAX, emptyState } from '../components.js';

export async function readerView(ctx) {
  const id = ctx.params[0];
  const song = store.getSong(id);
  if (!song) {
    const el = document.createElement('div');
    el.className = 'page';
    el.innerHTML = emptyState('songs', 'red', 'A dal nem található', 'Lehet, hogy időközben törölték.', '<a class="btn btn-primary" href="#/songs">Vissza a dalokhoz</a>');
    return { title: 'Dal', back: '#/songs', nav: 'songs', el };
  }
  store.markOpened(id);
  const bgUrl = await mediaURL('bg-reader');

  const el = document.createElement('div');
  el.className = 'reader-page' + (bgUrl ? ' has-bg' : '');
  const tags = (song.tagIds || []).map((t) => store.state.tags.get(t)).filter(Boolean);
  el.innerHTML = `
    <div class="reader-bg" ${bgUrl ? `style="background-image:url('${bgUrl}')"` : ''}></div>
    <div class="reader-shade"></div>
    <article class="reader">
      <header class="reader-head">
        <h2 class="reader-title">${esc(song.title)}</h2>
        ${song.artist || tags.length ? `<div class="reader-meta">${song.artist ? `<span class="artist">${esc(song.artist)}</span>` : ''}
          ${tags.map((t) => `<a class="mini-chip" style="--c:${esc(t.color)}" href="#/songs?tab=tag&tag=${encodeURIComponent(t.id)}">${esc(t.name)}</a>`).join('')}</div>` : ''}
      </header>
      <div class="lyrics"></div>
    </article>
    <div class="font-pop card" hidden></div>
    <div class="float-tools">
      <button type="button" class="ft-btn" data-size="-2" aria-label="Kisebb betű">A<sup>−</sup></button>
      <button type="button" class="ft-btn ft-big" data-size="2" aria-label="Nagyobb betű">A<sup>+</sup></button>
    </div>`;
  const lyr = el.querySelector('.lyrics');
  const paint = () => {
    const r = store.settings('reader');
    applyReaderStyle(el, r);
    lyr.innerHTML = lyricsHTML(song.lyrics, r.highlightSections);
  };
  paint();

  const pop = el.querySelector('.font-pop');
  let panel = null;
  const togglePanel = () => {
    if (pop.hidden) {
      panel = fontPanel({ onChange: () => paint(), compact: true });
      pop.replaceChildren(panel);
      pop.insertAdjacentHTML('beforeend', `<button type="button" class="btn btn-primary btn-block" data-close>${icon('check')} Kész</button>`);
      pop.hidden = false;
    } else { panel?.flush(); pop.hidden = true; }
  };
  pop.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) togglePanel(); });

  const saveSize = debounce(() => store.saveSettings('reader', store.settings('reader')), 400);
  el.querySelector('.float-tools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]');
    if (!b) return;
    const r = store.settings('reader');
    r.fontSize = clamp(Number(r.fontSize) + Number(b.dataset.size), FONT_MIN, FONT_MAX);
    paint();
    toast(`Betűméret: ${r.fontSize} px`, 'info', 900);
    saveSize();
  });

  const favBtn = document.createElement('button');
  const paintFav = (s) => {
    favBtn.className = `icon-btn icon-btn-gold fav-toggle${s.favorite ? ' on' : ''}`;
    favBtn.innerHTML = icon('star');
    favBtn.setAttribute('aria-label', s.favorite ? 'Eltávolítás a kedvencekből' : 'Kedvencnek jelölés');
    favBtn.setAttribute('aria-pressed', String(!!s.favorite));
  };
  paintFav(song);
  favBtn.type = 'button';
  favBtn.addEventListener('click', async () => {
    const s = await store.toggleFavorite(id);
    paintFav(s);
    toast(s.favorite ? 'Hozzáadva a kedvencekhez.' : 'Eltávolítva a kedvencekből.', 'success', 1400);
  });

  const fontBtn = document.createElement('button');
  fontBtn.type = 'button';
  fontBtn.className = 'icon-btn icon-btn-purple';
  fontBtn.setAttribute('aria-label', 'Betűstílus és méret');
  fontBtn.innerHTML = icon('type');
  fontBtn.addEventListener('click', togglePanel);

  const listBtn = document.createElement('button');
  listBtn.type = 'button';
  listBtn.className = 'icon-btn icon-btn-teal';
  listBtn.setAttribute('aria-label', 'Hozzáadás fellépés-listához');
  listBtn.innerHTML = icon('mic');
  listBtn.addEventListener('click', () => addToSetlistDialog(id));

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'icon-btn icon-btn-blue edit-btn';
  editBtn.setAttribute('aria-label', 'Dal szerkesztése');
  editBtn.innerHTML = icon('edit');
  editBtn.addEventListener('click', () => {
    if (store.settings('app').performLock) { toast('A fellépés-zárolás be van kapcsolva – a szerkesztés tiltva. A felső lakat ikonnal oldhatod fel.', 'error', 4500); return; }
    ctx.go(`#/edit/${encodeURIComponent(id)}`);
  });

  return {
    id: 'reader',
    title: song.title,
    back: '#/songs',
    nav: 'songs',
    el,
    actions: [favBtn, fontBtn, listBtn, editBtn],
    cleanup: () => { panel?.flush(); saveSize.flush(); },
  };
}

export async function addToSetlistDialog(songId) {
  const { upcoming, past } = store.setlistsSorted();
  const lists = [...upcoming, ...past];
  const body = document.createElement('div');
  body.innerHTML = lists.length
    ? `<div class="pick-list">${lists.map((l) => {
      const has = l.songIds.includes(songId);
      return `<button type="button" class="pick-row" data-id="${esc(l.id)}" ${has ? 'disabled' : ''}>${tile('mic', 'purple', 'tile-sm')}<span><b>${esc(l.name)}</b><small>${esc(fmtISODate(l.date))} · ${l.songIds.length} dal${has ? ' · már rajta van' : ''}</small></span></button>`;
    }).join('')}</div>`
    : '<p>Még nincs fellépés-listád. Hozz létre egyet a Fellépés menüben.</p>';
  const res = await modal({
    title: 'Hozzáadás fellépés-listához',
    body,
    buttons: [{ label: 'Bezárás', value: null, kind: 'ghost' }],
    onOpen: (box, finish) => box.addEventListener('click', (e) => { const r = e.target.closest('.pick-row'); if (r && !r.disabled) finish(r.dataset.id); }),
  });
  if (!res) return;
  const { added } = await store.addSongsToSetlist(res, [songId]);
  const l = store.state.setlists.get(res);
  toast(added ? `Hozzáadva: „${l.name}” (a lista végére).` : 'A dal már rajta van ezen a listán.', added ? 'success' : 'info');
}

/* ---------------- Szerkesztő ---------------- */

export function editorView(ctx) {
  const isNew = ctx.params[0] === 'new';
  const song = isNew ? null : store.getSong(ctx.params[0]);
  if (!isNew && !song) {
    const el = document.createElement('div');
    el.className = 'page';
    el.innerHTML = emptyState('songs', 'red', 'A dal nem található', 'Lehet, hogy időközben törölték.', '<a class="btn btn-primary" href="#/songs">Vissza a dalokhoz</a>');
    return { title: 'Szerkesztés', back: '#/songs', nav: 'songs', el };
  }
  if (store.settings('app').performLock) {
    const el = document.createElement('div');
    el.className = 'page';
    el.innerHTML = emptyState('lock', 'red', 'Zárolva', 'A fellépés-zárolás be van kapcsolva, ezért a szerkesztés tiltva van. Oldd fel a felső sávban lévő lakat ikonnal.');
    return { title: 'Szerkesztés', back: '#/songs', nav: 'songs', el };
  }

  const selTags = new Set(song?.tagIds || []);
  const presetTag = ctx.query.get('tag');
  if (isNew && presetTag && store.state.tags.has(presetTag)) selTags.add(presetTag);
  const el = document.createElement('div');
  el.className = 'page editor-page';
  el.innerHTML = `
    <form class="card editor" novalidate>
      <label class="field"><span class="field-label">Cím <em>*</em></span>
        <input class="input input-lg" name="title" maxlength="300" required autocomplete="off" value="${esc(song?.title || '')}" placeholder="A dal címe">
        <span class="field-error" hidden>Add meg a dal címét.</span></label>
      <label class="field"><span class="field-label">Előadó <small>(nem kötelező)</small></span>
        <input class="input" name="artist" maxlength="300" autocomplete="off" value="${esc(song?.artist || '')}" placeholder="Előadó vagy zeneszerző"></label>
      <div class="field"><span class="field-label">Címkék <small>(több is választható)</small></span>
        <div class="tag-picker"></div>
        <div class="row-inline">
          <input class="input" name="newTag" maxlength="60" placeholder="Új címke…" autocomplete="off">
          <button type="button" class="btn btn-pink btn-sm" data-act="add-tag">${icon('plus')} Címke</button>
        </div></div>
      <label class="switch-row"><input type="checkbox" name="favorite" ${song?.favorite ? 'checked' : ''}><span class="switch"></span><span>${icon('star')} Kedvenc</span></label>
      <div class="field"><span class="field-label">Dalszöveg</span>
        <div class="ref-btn-row">
          <button type="button" class="btn btn-gold btn-sm" data-act="refrain">${icon('star')} Refrén</button>
          <small class="muted">Jelöld ki a refrén sorait (vagy állj a kurzorral a versszakba), majd nyomd meg.</small>
        </div>
        <textarea class="input lyrics-input" name="lyrics" aria-label="Dalszöveg" rows="16" spellcheck="false" placeholder="Írd vagy másold be ide a dalszöveget.&#10;&#10;Tipp: a [Refrén] vagy [1. versszak] formájú sorok színesen kiemelve jelennek meg.">${esc(song?.lyrics || '')}</textarea></div>
      <div class="form-actions">
        ${!isNew ? `<button type="button" class="btn btn-danger" data-act="delete">${icon('trash')} Törlés</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost" data-act="cancel">Mégse</button>
        <button type="submit" class="btn btn-primary">${icon('check')} Mentés</button>
      </div>
    </form>`;

  const form = el.querySelector('form');
  const picker = el.querySelector('.tag-picker');
  let dirty = false;
  const renderTags = () => {
    const tags = store.tagsSorted();
    picker.innerHTML = tags.length
      ? tags.map((t) => `<button type="button" class="chip${selTags.has(t.id) ? ' on' : ''}" data-tag="${esc(t.id)}" style="--c:${esc(t.color)}" aria-pressed="${selTags.has(t.id)}">${selTags.has(t.id) ? icon('check') : ''}${esc(t.name)}</button>`).join('')
      : '<span class="muted">Még nincs címke – hozz létre egyet lent.</span>';
  };
  renderTags();

  form.addEventListener('input', () => { dirty = true; form.querySelector('.field-error').hidden = true; });
  picker.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]');
    if (!b) return;
    const t = b.dataset.tag;
    if (selTags.has(t)) selTags.delete(t); else selTags.add(t);
    dirty = true;
    renderTags();
  });

  const addTag = async () => {
    const input = form.elements.newTag;
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    input.value = '';
    const t = await store.createTag(name);
    selTags.add(t.id);
    dirty = true;
    renderTags();
  };
  form.elements.newTag.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });

  form.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'add-tag') addTag();
    if (b.dataset.act === 'refrain') {
      const ta = form.elements.lyrics;
      const r = markRefrain(ta.value, ta.selectionStart ?? 0, ta.selectionEnd ?? 0);
      if (!r.changed) { toast(r.reason, 'info', 3500); ta.focus(); return; }
      ta.value = r.text;
      ta.focus();
      ta.setSelectionRange(r.selStart, r.selEnd);
      dirty = true;
      toast('[Refrén] jel beszúrva.', 'success', 1500);
    }
    if (b.dataset.act === 'cancel') ctx.goBack(isNew ? '#/songs' : `#/song/${encodeURIComponent(song.id)}`);
    if (b.dataset.act === 'delete') {
      const ok = await confirmBox('Dal törlése', `Biztosan törlöd a(z) „${song.title}” dalt? A dal a fellépés-listákról is lekerül. Ez nem vonható vissza.`, { okLabel: 'Végleges törlés', danger: true });
      if (!ok) return;
      await store.deleteSong(song.id);
      dirty = false;
      toast('A dal törölve.', 'success');
      ctx.go('#/songs', { replace: true });
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.elements.title.value.trim();
    if (!title) {
      form.querySelector('.field-error').hidden = false;
      form.elements.title.focus();
      return;
    }
    const saved = await store.saveSong({
      id: song?.id,
      title,
      artist: form.elements.artist.value,
      lyrics: form.elements.lyrics.value,
      tagIds: [...selTags],
      favorite: form.elements.favorite.checked,
    });
    dirty = false;
    toast(isNew ? 'Új dal elmentve.' : 'Módosítások elmentve.', 'success');
    if (isNew) ctx.go(`#/song/${encodeURIComponent(saved.id)}`, { replace: true });
    else ctx.goBack(`#/song/${encodeURIComponent(saved.id)}`, { strict: true });
  });

  const onUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onUnload);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'icon-btn icon-btn-gold';
  saveBtn.setAttribute('aria-label', 'Mentés');
  saveBtn.innerHTML = icon('check');
  saveBtn.addEventListener('click', () => form.requestSubmit());

  return {
    id: 'editor',
    title: isNew ? 'Új dal' : 'Dal szerkesztése',
    back: isNew ? '#/songs' : `#/song/${encodeURIComponent(song.id)}`,
    nav: 'songs',
    el,
    actions: [saveBtn],
    canLeave: async () => !dirty,
    leaveMessage: 'A dalon végzett módosítások nincsenek elmentve. Biztosan kilépsz mentés nélkül?',
    mounted: () => { if (isNew) form.elements.title.focus(); },
    cleanup: () => window.removeEventListener('beforeunload', onUnload),
  };
}
