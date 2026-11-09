// Általános segédfüggvények: DOM, szöveg, dátum, értesítések, párbeszédablakok.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Kereséshez: kisbetű, ékezetek nélkül. */
export function norm(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function uid(prefix = '') {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') {
    return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  }
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

export const collator = new Intl.Collator('hu', { sensitivity: 'base', numeric: true });

export function debounce(fn, ms = 250) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const dateFmt = new Intl.DateTimeFormat('hu', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat('hu', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

export function fmtISODate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 'Nincs dátum';
  const [y, m, d] = iso.split('-').map(Number);
  return dateFmt.format(new Date(y, m - 1, d));
}

export function fmtDateTime(ts) {
  if (!ts) return '–';
  try { return dateTimeFmt.format(new Date(ts)); } catch { return '–'; }
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '–';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/* ---------- Értesítések (toast) ---------- */
export function toast(message, type = 'info', ms = 3200) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  };
  el.addEventListener('click', close);
  setTimeout(close, ms);
}

/* ---------- Párbeszédablakok ---------- */
let openModals = 0;

/**
 * Általános modális ablak.
 * buttons: [{ label, value, kind: 'primary'|'danger'|'ghost' }]
 * Visszatérés: a megnyomott gomb value-ja, vagy null (bezárás).
 */
export function modal({ title, body = '', buttons = [{ label: 'OK', value: true, kind: 'primary' }], onOpen, wide = false, getValue } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const box = document.createElement('div');
    box.className = 'modal' + (wide ? ' modal-wide' : '');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = `
      ${title ? `<h2 class="modal-title">${esc(title)}</h2>` : ''}
      <div class="modal-body"></div>
      <div class="modal-buttons"></div>`;
    const bodyEl = box.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
    const btnRow = box.querySelector('.modal-buttons');
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      openModals--;
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.remove('show');
      setTimeout(() => backdrop.remove(), 200);
      resolve(value);
    };
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn btn-${b.kind || 'ghost'}`;
      btn.textContent = b.label;
      btn.addEventListener('click', () => {
        if (getValue && b.value === true) {
          const v = getValue(box);
          if (v === undefined) return; // érvénytelen bemenet – maradjon nyitva
          finish(v);
        } else finish(b.value);
      });
      btnRow.appendChild(btn);
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault();
        const primary = btnRow.querySelector('.btn-primary, .btn-danger');
        primary?.click();
      }
    };
    document.addEventListener('keydown', onKey, true);
    backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) finish(null); });
    backdrop.appendChild(box);
    document.body.appendChild(backdrop);
    openModals++;
    requestAnimationFrame(() => backdrop.classList.add('show'));
    onOpen?.(box, finish);
    const firstInput = box.querySelector('input, textarea, select');
    if (firstInput) setTimeout(() => { firstInput.focus(); firstInput.select?.(); }, 60);
  });
}

export function isModalOpen() { return openModals > 0; }

export async function confirmBox(title, message, { okLabel = 'Igen', cancelLabel = 'Mégse', danger = false } = {}) {
  const res = await modal({
    title,
    body: `<p>${esc(message)}</p>`,
    buttons: [
      { label: cancelLabel, value: false, kind: 'ghost' },
      { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  });
  return res === true;
}

export async function promptBox(title, { label = '', value = '', placeholder = '', type = 'text', okLabel = 'Mentés', required = true, maxLength = 200 } = {}) {
  const res = await modal({
    title,
    body: `<label class="field"><span class="field-label">${esc(label)}</span>
      <input class="input" type="${esc(type)}" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="${maxLength}">
      <span class="field-error" hidden></span></label>`,
    buttons: [
      { label: 'Mégse', value: false, kind: 'ghost' },
      { label: okLabel, value: true, kind: 'primary' },
    ],
    getValue: (box) => {
      const input = box.querySelector('input');
      const v = input.value.trim();
      if (required && !v) {
        const err = box.querySelector('.field-error');
        err.textContent = 'Ez a mező nem lehet üres.';
        err.hidden = false;
        input.focus();
        return undefined;
      }
      return v;
    },
  });
  return typeof res === 'string' ? res : null;
}

export function vibrate(ms = 12) {
  try { navigator.vibrate?.(ms); } catch { /* nem támogatott */ }
}
