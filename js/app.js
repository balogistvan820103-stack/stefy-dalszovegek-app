// Alkalmazás-keret: útválasztás, felső sáv, alsó navigáció, globális szolgáltatások.

import * as store from './store.js';
import * as wake from './wakelock.js';
import { $, esc, toast, confirmBox } from './util.js';
import { icon } from './icons.js';
import { homeView } from './views/home.js';
import { songsView, tagsView, applyListTitleSize } from './views/songs.js';
import { readerView, editorView } from './views/reader.js';
import { setlistsView, setlistView, pickerView } from './views/setlists.js';
import { performView } from './views/perform.js';
import { settingsView } from './views/settings.js';

export const APP_VERSION = '1.2.1';

const routes = [
  { re: /^\/(?:home)?$/, view: homeView },
  { re: /^\/songs$/, view: songsView },
  { re: /^\/tags$/, view: tagsView },
  { re: /^\/song\/([^/]+)$/, view: readerView },
  { re: /^\/edit\/([^/]+)$/, view: editorView },
  { re: /^\/setlists$/, view: setlistsView },
  { re: /^\/setlist\/([^/]+)$/, view: setlistView },
  { re: /^\/setlist\/([^/]+)\/add$/, view: pickerView },
  { re: /^\/perform\/([^/]+)\/(\d+)$/, view: performView },
  { re: /^\/settings$/, view: settingsView },
];

const NAV = [
  { key: 'home', href: '#/', label: 'Kezdőlap', icon: 'home', color: 'gold' },
  { key: 'songs', href: '#/songs', label: 'Dalok', icon: 'songs', color: 'blue' },
  { key: 'perform', href: '#/setlists', label: 'Fellépés', icon: 'mic', color: 'purple' },
  { key: 'settings', href: '#/settings', label: 'Beállítások', icon: 'settings', color: 'teal' },
];

let current = null;
let currentHash = '';
let ignoreNext = false;
let replaceNext = false;
const stack = [];
const scrollPos = new Map();

/** Navigáció. replace: az aktuális előzménybejegyzést cseréli (pl. mentés után). */
export function go(hash, { replace = false } = {}) {
  if (!hash.startsWith('#')) hash = '#' + hash;
  if (hash === location.hash) { route(true); return; }
  if (replace) { replaceNext = true; location.replace(hash); } else location.hash = hash;
}

/** Az URL csendes frissítése újrarajzolás nélkül (pl. fellépés módban lapozáskor). */
export function silentReplace(hash) {
  history.replaceState(null, '', hash);
  currentHash = hash;
  if (stack.length) stack[stack.length - 1] = hash;
}

/** Vissza az előző képernyőre. strict: csak akkor lép vissza, ha az előző épp a fallback cél. */
export function goBack(fallback = '#/', { strict = false } = {}) {
  const prev = stack[stack.length - 2];
  if (stack.length > 1 && (!strict || prev === fallback)) history.back();
  else go(fallback, { replace: true });
}

async function route(force = false) {
  const hash = location.hash || '#/';
  if (ignoreNext) { ignoreNext = false; return; }
  if (!force && hash === currentHash) return;

  if (!force && current?.canLeave && !(await current.canLeave())) {
    // A navigációt visszacsináljuk (az előzmények sorrendje sértetlen marad), majd rákérdezünk.
    const wasBack = stack.length > 1 && stack[stack.length - 2] === hash;
    const blocked = current;
    ignoreNext = true;
    if (wasBack) history.forward(); else history.back();
    const ok = await confirmBox('Nem mentett módosítások', blocked.leaveMessage || 'A módosítások nincsenek elmentve. Biztosan kilépsz mentés nélkül?', { okLabel: 'Kilépés mentés nélkül', cancelLabel: 'Maradok', danger: true });
    if (ok && current === blocked) {
      blocked.canLeave = null;
      if (wasBack) history.back(); else go(hash);
    }
    return;
  }

  // előzmény-verem a vissza gombhoz
  if (replaceNext) { replaceNext = false; if (stack.length) stack[stack.length - 1] = hash; else stack.push(hash); }
  else if (stack.length > 1 && stack[stack.length - 2] === hash) stack.pop();
  else if (stack[stack.length - 1] !== hash) stack.push(hash);
  if (stack.length > 60) stack.splice(0, stack.length - 60);

  if (currentHash) scrollPos.set(currentHash, window.scrollY);
  try { current?.cleanup?.(); } catch (e) { console.error(e); }
  currentHash = hash;

  const [path, qs] = hash.slice(1).split('?');
  const query = new URLSearchParams(qs || '');
  let match = null;
  let def = null;
  for (const r of routes) { match = path.match(r.re); if (match) { def = r; break; } }
  const ctx = { params: match ? match.slice(1).map(decodeURIComponent) : [], query, go, goBack, silentReplace, hash, rerender: () => route(true), version: APP_VERSION };

  let view;
  try {
    view = def ? await def.view(ctx) : notFound();
  } catch (e) {
    console.error(e);
    view = errorView(e);
  }
  if (hash !== currentHash) { view.cleanup?.(); return; } // időközben máshová navigáltunk
  current = view;
  renderShell(view);
  const main = $('#view');
  main.replaceChildren(view.el);
  if (view.restoreScroll && scrollPos.has(hash)) window.scrollTo(0, scrollPos.get(hash));
  else window.scrollTo(0, 0);
  view.mounted?.();
}

function notFound() {
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = `<div class="empty"><span class="tile tile-red tile-xl">${icon('info')}</span><h3>Az oldal nem található</h3><p>Lehet, hogy a keresett elem már törölve lett.</p><a class="btn btn-primary" href="#/">Kezdőlap</a></div>`;
  return { title: 'Nem található', back: '#/', nav: null, el };
}

function errorView(e) {
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = `<div class="empty"><span class="tile tile-red tile-xl">${icon('info')}</span><h3>Hiba történt</h3><p>${esc(e?.message || e)}</p><a class="btn btn-primary" href="#/">Kezdőlap</a></div>`;
  return { title: 'Hiba', back: '#/', nav: null, el };
}

function renderShell(view) {
  const app = $('#app');
  app.classList.toggle('no-chrome', !!view.fullscreen);
  app.dataset.view = view.id || '';
  $('#viewTitle').textContent = view.title || '';
  const back = $('#backBtn');
  back.hidden = !view.back;
  back.innerHTML = `${icon('back')}`;
  back.onclick = () => (view.onBack ? view.onBack() : goBack(view.back));
  const actions = $('#viewActions');
  actions.replaceChildren();
  if (view.actions) {
    if (typeof view.actions === 'string') actions.innerHTML = view.actions;
    else actions.append(...[].concat(view.actions));
  }
  renderLockBadge();
  for (const a of document.querySelectorAll('#bottomnav a')) {
    const on = a.dataset.key === view.nav;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

function renderLockBadge() {
  const slot = $('#lockBadge');
  const locked = store.settings('app').performLock;
  slot.innerHTML = locked ? `<button type="button" class="lock-badge" title="Zárolás feloldása">${icon('lock')}<span>Zárolva</span></button>` : '';
  slot.querySelector('button')?.addEventListener('click', async () => {
    const ok = await confirmBox('Zárolás feloldása', 'Feloldod a fellépés-zárolást? Ezután újra lehet szerkeszteni és átrendezni.', { okLabel: 'Feloldás' });
    if (ok) {
      await store.patchSettings('app', { performLock: false });
      toast('Zárolás feloldva.', 'success');
      route(true);
    }
  });
}

function renderNav() {
  $('#bottomnav').innerHTML = NAV.map((n) => `
    <a href="${n.href}" data-key="${n.key}" class="nav-${n.color}">
      <span class="nav-ico">${icon(n.icon)}</span><span class="nav-label">${n.label}</span>
    </a>`).join('');
  // a már aktív fülre koppintás a gyökérnézetbe visz
  $('#bottomnav').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && location.hash === a.getAttribute('href')) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
}

export function rerender() { route(true); }

/* ---------------- Szolgáltatások ---------------- */

function registerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      let refreshing = false;
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || refreshing) return;
        refreshing = true;
        toast('Az alkalmazás frissült. Újraindítás után az új verzió fut.', 'success', 5000);
      });
      reg.update?.();
    } catch (e) {
      console.warn('Service worker hiba:', e);
    }
  });
}

async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* nem támogatott */ }
}

async function start() {
  renderNav();
  try {
    await store.init();
  } catch (e) {
    $('#view').innerHTML = `<div class="page"><div class="empty"><h3>Az adatok nem tölthetők be</h3><p>${esc(e.message)}</p></div></div>`;
    return;
  }
  wake.setEnabled(store.settings('app').wakeLock);
  window.addEventListener('hashchange', () => route());
  store.onChange((what) => { if (what === 'settings:app' || what === 'all') renderLockBadge(); });
  // „Helyben mentve” jelzés felvillan minden sikeres mentés után
  const ind = $('#saveInd');
  store.onChange(() => { ind.classList.remove('flash'); void ind.offsetWidth; ind.classList.add('flash'); });
  applyListTitleSize();
  await route(true);
  requestPersistence();
}

window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast(`Hiba: ${e.reason?.message || e.reason}`, 'error', 5000);
});

registerSW();
start();
