// Képernyő ébren tartása az alkalmazás MINDEN képernyőjén (Screen Wake Lock API).
// Android a háttérbe kerüléskor automatikusan elengedi a zárat – visszatéréskor
// újra kérjük, és ha a rendszer elutasítja, a következő érintésnél újrapróbáljuk.

const listeners = new Set();
let sentinel = null;
let enabled = false;
let status = 'off'; // off | active | paused | unsupported | error | pending
let lastError = '';

export const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator && window.isSecureContext;

export function unsupportedReason() {
  if (!window.isSecureContext) return 'Az oldal nem biztonságos (https vagy localhost) kapcsolaton fut, ezért a böngésző nem engedi a képernyő ébren tartását.';
  if (!('wakeLock' in navigator)) return 'Ez a böngésző nem támogatja a képernyő ébren tartását. Frissítsd a Chrome-ot, vagy állítsd hosszabbra a képernyő-kikapcsolási időt az Android beállításaiban.';
  return '';
}

function set(s, err = '') {
  status = s;
  lastError = err;
  for (const fn of listeners) fn(status, lastError);
}

export function onStatus(fn) { listeners.add(fn); fn(status, lastError); return () => listeners.delete(fn); }
export function getStatus() { return { status, error: lastError, enabled }; }

async function acquire() {
  if (!enabled) return;
  if (!supported) { set('unsupported', unsupportedReason()); return; }
  if (document.visibilityState !== 'visible') { set('paused'); return; }
  if (sentinel && !sentinel.released) { set('active'); return; }
  set('pending');
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
      if (!enabled) return;
      set(document.visibilityState === 'visible' ? 'pending' : 'paused');
      if (document.visibilityState === 'visible') setTimeout(acquire, 800);
    });
    if (!enabled) { await release(); return; }
    set('active');
  } catch (e) {
    sentinel = null;
    const msg = e?.name === 'NotAllowedError'
      ? 'A rendszer most nem engedélyezte (pl. energiatakarékos mód). Érintsd meg a képernyőt az újrapróbáláshoz.'
      : (e?.message || 'Ismeretlen hiba.');
    set('error', msg);
  }
}

async function release() {
  const s = sentinel;
  sentinel = null;
  if (s && !s.released) { try { await s.release(); } catch { /* */ } }
}

export async function setEnabled(on) {
  enabled = !!on;
  if (enabled) await acquire();
  else { await release(); set('off'); }
  return status;
}

document.addEventListener('visibilitychange', () => {
  if (!enabled) return;
  if (document.visibilityState === 'visible') acquire();
  else set('paused');
});
document.addEventListener('fullscreenchange', () => { if (enabled) acquire(); });
// Ha a kérés elutasításra került, a következő felhasználói érintéskor újrapróbáljuk.
window.addEventListener('pointerdown', () => {
  if (enabled && supported && (status === 'error' || status === 'pending' || status === 'paused') && !sentinel) acquire();
}, { passive: true });
