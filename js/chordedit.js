// „Akkordozás” mód: a dal úgy látszik, mint olvasáskor; egy szóra koppintva akkordválasztó jön fel.
// Az akkord a szó elejére kerül (◀ ▶ nyilakkal betűnként tolható), meglévő akkord cserélhető, törölhető,
// minden lépés visszavonható. A módosítás csak a „Kész – mentés” gombbal kerül a dalba.

import * as store from './store.js';
import { esc, toast, confirmBox } from './util.js';
import { icon } from './icons.js';
import { lyricsHTML } from './components.js';
import { parseChordLine, buildChordLine, isChord, usedChords, rootChoices, chordParts, chordFormatter } from './chords.js';

const QUALITIES = [['', 'dúr'], ['m', 'm'], ['7', '7'], ['m7', 'm7'], ['maj7', 'maj7'], ['sus2', 'sus2'], ['sus4', 'sus4'],
  ['dim', 'dim'], ['aug', 'aug'], ['6', '6'], ['m6', 'm6'], ['9', '9'], ['add9', 'add9']];

/* ---------------- Tiszta szerkesztő-műveletek (tesztelhetők) ---------------- */

/** Akkord beállítása / cseréje egy sorban. ci = null → új akkord a pos helyre. Visszaad: { line, ci } */
export function setChordAt(line, ci, pos, name) {
  const { text, chords } = parseChordLine(line);
  const list = chords.map((c) => ({ ...c }));
  let target;
  if (ci === null || ci === undefined || !list[ci]) { target = { pos: Math.max(0, Math.min(text.length, pos)), name }; list.push(target); }
  else { target = list[ci]; target.name = name; }
  return rebuild(text, list, target);
}

/** Akkord eltolása betűnként (d = -1 / +1); a szóközöket átugorja. */
export function moveChord(line, ci, d) {
  const { text, chords } = parseChordLine(line);
  const list = chords.map((c) => ({ ...c }));
  const target = list[ci];
  if (!target) return { line, ci };
  let p = target.pos + d;
  if (d > 0) while (p < text.length && /\s/.test(text[p])) p++;
  else while (p > 0 && /\s/.test(text[p])) p--;
  target.pos = Math.max(0, Math.min(text.length, p));
  return rebuild(text, list, target);
}

export function deleteChord(line, ci) {
  const { text, chords } = parseChordLine(line);
  return buildChordLine(text, chords.filter((_, i) => i !== ci));
}

function rebuild(text, list, target) {
  const order = list.map((c, i) => ({ c, i })).sort((a, b) => (a.c.pos - b.c.pos) || (a.i - b.i));
  const out = buildChordLine(text, order.map((x) => x.c));
  return { line: out, ci: order.findIndex((x) => x.c === target) };
}

/* ---------------- Felület ---------------- */

export function chordEditor({ root, lyr, text, onExit }) {
  const notation = () => store.settings('app').chordNotation || 'hu';
  let work = String(text || '');
  const original = work;
  const undo = [];
  let sel = null; // { li, ci } meglévő akkord, vagy { li, pos, ci: null } új hely

  root.classList.add('chord-edit');
  const banner = document.createElement('div');
  banner.className = 'ce-banner';
  banner.innerHTML = `
    <span class="ce-hint">${icon('edit')} Akkordozás: koppints egy szóra (új akkord) vagy egy akkordra (csere, törlés).</span>
    <button type="button" class="btn btn-ghost btn-sm" data-ce="undo" disabled>↶ Visszavonás</button>
    <button type="button" class="btn btn-ghost btn-sm" data-ce="cancel">Mégse</button>
    <button type="button" class="btn btn-primary btn-sm" data-ce="done">${icon('check')} Kész – mentés</button>`;
  lyr.before(banner);
  const sheet = document.createElement('div');
  sheet.className = 'ce-sheet';
  sheet.hidden = true;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Akkordválasztó');
  root.appendChild(sheet);

  const lines = () => work.split('\n');
  const setLine = (li, line) => { const ls = lines(); ls[li] = line; work = ls.join('\n'); };
  const dirty = () => work !== original;

  const paint = () => {
    lyr.innerHTML = lyricsHTML(work, store.settings('reader').highlightSections, { tap: true });
    banner.querySelector('[data-ce=undo]').disabled = !undo.length;
    markSel();
  };

  const markSel = () => {
    lyr.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
    if (!sel) return;
    let elx;
    if (sel.ci !== null) {
      elx = lyr.querySelector(`.cn[data-l="${sel.li}"][data-ci="${sel.ci}"]`);
      elx?.classList.add('sel');
      elx?.closest('.ch-word')?.classList.add('sel');
    } else {
      elx = lyr.querySelector(`.ch-word[data-l="${sel.li}"][data-s="${sel.pos}"]`);
      elx?.classList.add('sel');
    }
    // a kijelölt szó ne kerüljön a választó alá
    if (elx && !sheet.hidden) {
      const r = elx.getBoundingClientRect();
      const limit = window.innerHeight - sheet.offsetHeight - 16;
      if (r.bottom > limit) window.scrollBy({ top: r.bottom - limit + 20 });
      else {
        const top = banner.getBoundingClientRect().bottom + 12;
        if (r.top < top) window.scrollBy({ top: r.top - top - 10 });
      }
    }
  };

  const push = () => { undo.push(work); if (undo.length > 300) undo.shift(); };

  const current = () => {
    if (!sel) return null;
    const { text: t, chords } = parseChordLine(lines()[sel.li] ?? '');
    const c = sel.ci !== null ? chords[sel.ci] : null;
    return { t, chords, c, pos: c ? c.pos : sel.pos };
  };

  const renderSheet = () => {
    const cur = current();
    if (!cur) { sheet.hidden = true; return; }
    const { t, c, pos } = cur;
    const fmt = chordFormatter(work, 0, notation());
    const parts = c ? chordParts(c.name, notation()) : null;
    // a szó, benne kiemelve az a betű, ami fölött az akkord áll
    let ws = pos; while (ws > 0 && !/\s/.test(t[ws - 1])) ws--;
    let we = pos; while (we < t.length && !/\s/.test(t[we])) we++;
    const word = pos < t.length
      ? `${esc(t.slice(ws, pos))}<mark>${esc(t[pos])}</mark>${esc(t.slice(pos + 1, we))}`
      : `${esc(t.slice(ws, we))}<mark>&nbsp;</mark>`;
    const used = usedChords(work);
    sheet.innerHTML = `<div class="ce-sheet-box">
      <div class="ce-head"><span class="ce-cur">${c ? esc(fmt(c.name)) : '—'}</span>
        <span class="ce-word">${c ? 'Akkord a szó fölött' : 'Új akkord ide'}: „${word}”</span></div>
      ${used.length ? `<div class="ce-row"><span class="ce-lab">A dalban már használt akkordok</span>
        ${used.map((u) => `<button type="button" class="ce-k used${c && c.name === u ? ' on' : ''}" data-set="${esc(u)}">${esc(fmt(u))}</button>`).join('')}</div>` : ''}
      <div class="ce-row"><span class="ce-lab">Alaphang</span>
        ${rootChoices(notation()).map((r) => `<button type="button" class="ce-k${parts && parts.root === r ? ' on' : ''}" data-root="${esc(r)}">${esc(r)}</button>`).join('')}</div>
      <div class="ce-row"><span class="ce-lab">Fajta</span>
        ${QUALITIES.map(([q, label]) => `<button type="button" class="ce-k${parts && parts.suffix === q ? ' on' : ''}" data-q="${esc(q)}" ${c ? '' : 'disabled'}>${esc(label)}</button>`).join('')}</div>
      <div class="ce-row"><span class="ce-lab">Basszushang és egyéni akkord</span>
        <select class="input ce-bass" aria-label="Basszushang" ${c ? '' : 'disabled'}><option value="">nincs /basszus</option>
          ${rootChoices(notation()).map((r) => `<option value="${esc(r)}"${parts && parts.bass === r ? ' selected' : ''}>/${esc(r)}</option>`).join('')}</select>
        <input class="input ce-custom" placeholder="pl. F#m7b5" value="${c ? esc(c.name) : ''}" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Egyéni akkord">
        <button type="button" class="ce-k" data-custom>Beállít</button></div>
      <div class="ce-actions">
        <button type="button" class="ce-k" data-move="-1" ${c ? '' : 'disabled'} aria-label="Egy betűvel balra">◀</button>
        <button type="button" class="ce-k" data-move="1" ${c ? '' : 'disabled'} aria-label="Egy betűvel jobbra">▶</button>
        <button type="button" class="btn btn-danger btn-sm" data-del ${c ? '' : 'disabled'}>${icon('trash')} Törlés</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-primary btn-sm" data-close>${icon('check')} Kész</button>
      </div></div>`;
    sheet.hidden = false;
  };

  const apply = (name) => {
    if (!sel) return;
    if (!isChord(name)) { toast(`„${name}” nem érvényes akkordnév (pl. Am, F#m7, H7, D/F#).`, 'error', 3000); return; }
    push();
    const r = setChordAt(lines()[sel.li], sel.ci, sel.pos ?? 0, name);
    setLine(sel.li, r.line);
    sel = { li: sel.li, ci: r.ci };
    paint(); renderSheet(); markSel();
  };

  const compose = (patch) => {
    const cur = current();
    const p = cur?.c ? chordParts(cur.c.name, notation()) : { root: '', suffix: '', bass: '' };
    const n = { ...p, ...patch };
    if (!n.root) { toast('Előbb az alaphangot válaszd ki.', 'info', 1800); return; }
    apply(n.root + n.suffix + (n.bass ? `/${n.bass}` : ''));
  };

  const onLyrClick = (e) => {
    const cn = e.target.closest('.cn[data-ci]');
    if (cn) { sel = { li: Number(cn.dataset.l), ci: Number(cn.dataset.ci) }; renderSheet(); markSel(); return; }
    const w = e.target.closest('.ch-word[data-l]');
    if (!w) return;
    const li = Number(w.dataset.l); const s = Number(w.dataset.s);
    const { text: t, chords } = parseChordLine(lines()[li] ?? '');
    let e2 = s; while (e2 < t.length && !/\s/.test(t[e2])) e2++;
    const ci = chords.findIndex((c) => c.pos >= s && c.pos < Math.max(e2, s + 1));
    sel = ci >= 0 ? { li, ci } : { li, pos: s, ci: null };
    renderSheet(); markSel();
  };
  lyr.addEventListener('click', onLyrClick);

  sheet.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.set) apply(b.dataset.set);
    else if (b.dataset.root !== undefined) compose({ root: b.dataset.root });
    else if (b.dataset.q !== undefined) compose({ suffix: b.dataset.q });
    else if (b.hasAttribute('data-custom')) apply(sheet.querySelector('.ce-custom').value.trim());
    else if (b.dataset.move) {
      push();
      const r = moveChord(lines()[sel.li], sel.ci, Number(b.dataset.move));
      setLine(sel.li, r.line); sel = { li: sel.li, ci: r.ci };
      paint(); renderSheet(); markSel();
    } else if (b.hasAttribute('data-del')) {
      push();
      setLine(sel.li, deleteChord(lines()[sel.li], sel.ci));
      sel = null; sheet.hidden = true;
      paint();
      toast('Akkord törölve.', 'success', 1000);
    } else if (b.hasAttribute('data-close')) { sel = null; sheet.hidden = true; markSel(); }
  });
  sheet.addEventListener('change', (e) => { if (e.target.classList.contains('ce-bass')) compose({ bass: e.target.value }); });
  sheet.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('ce-custom')) { e.preventDefault(); apply(e.target.value.trim()); } });

  // böngésző bezárása / újratöltése mentetlen akkordokkal: figyelmeztetés
  const onUnload = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onUnload);

  const destroy = () => {
    window.removeEventListener('beforeunload', onUnload);
    lyr.removeEventListener('click', onLyrClick);
    banner.remove(); sheet.remove();
    root.classList.remove('chord-edit');
  };

  banner.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ce]');
    if (!b) return;
    if (b.dataset.ce === 'undo') {
      if (!undo.length) return;
      work = undo.pop(); sel = null; sheet.hidden = true;
      paint();
    } else if (b.dataset.ce === 'cancel') {
      if (dirty() && !(await confirmBox('Akkordozás elvetése', 'Elveted az akkordokon végzett módosításokat? A dal az eddigi formájában marad.', { okLabel: 'Elvetés', danger: true }))) return;
      destroy(); onExit(null);
    } else if (b.dataset.ce === 'done') {
      destroy(); onExit(dirty() ? work : null);
    }
  });

  return { paint, dirty, destroy };
}
