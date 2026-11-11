// Húzásos vissza-navigáció: vízszintes legyintés (balról jobbra vagy jobbról balra) = Vissza gomb.
// Húzás közben egy nyíl jelzi, mikor elég hosszú a mozdulat; ha a felhasználó visszahúzza
// az ujját, nem történik semmi. Ahol a vízszintes húzásnak más szerepe van, ott kimarad.

const START_SLOP = 14;      // ennyi elmozdulás után döntjük el az irányt (px)
const TRIGGER = 90;         // ennyi vízszintes út kell a visszalépéshez (px)
const MAX_TIME = 900;       // ennél lassabb mozdulat már nem legyintés (ms)

// Ezeken belül kezdett húzás soha nem lép vissza (szövegmezők, csúszkák, saját húzásos felületek)
const IGNORE = [
  'input', 'textarea', 'select', '[contenteditable]', '.modal-backdrop',
  '.tag-chips', '.swatches', '.font-choices', '.seg', '.grip', '.drag-placeholder',
  '.crop-stage', '.hero.editing', '.photo-scroll', '.pf-drawer', '.perform', '.select-bar',
].join(',');

/**
 * Bekapcsolja a húzásos visszalépést.
 * opts.enabled()  – be van-e kapcsolva (beállítás)
 * opts.canGoBack() – van-e hová visszalépni az aktuális képernyőről
 * opts.back()      – a visszalépés (ugyanaz, mint a Vissza gomb)
 */
export function initSwipeBack({ enabled, canGoBack, back }) {
  const ind = document.createElement('div');
  ind.className = 'swipe-back';
  ind.setAttribute('aria-hidden', 'true');
  ind.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14.5 5 7.5 12l7 7"/></svg>';
  document.body.appendChild(ind);

  let g = null;

  const reset = () => {
    g = null;
    ind.classList.remove('show', 'ready', 'left', 'right');
    ind.style.removeProperty('--p');
  };

  document.addEventListener('touchstart', (e) => {
    if (g || e.touches.length !== 1) { reset(); return; }
    if (!enabled() || !canGoBack()) return;
    if (document.body.classList.contains('is-dragging')) return;
    if (e.target.closest?.(IGNORE)) return;
    // kijelölt szöveg mellett ne lépjünk vissza véletlenül
    if (String(window.getSelection?.() || '').length) return;
    const t = e.touches[0];
    g = { x: t.clientX, y: t.clientY, t: Date.now(), dir: 0, decided: false };
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!g) return;
    if (e.touches.length !== 1 || document.body.classList.contains('is-dragging')) { reset(); return; }
    const t = e.touches[0];
    const dx = t.clientX - g.x; const dy = t.clientY - g.y;
    if (!g.decided) {
      if (Math.abs(dx) < START_SLOP && Math.abs(dy) < START_SLOP) return;
      // csak egyértelműen vízszintes mozdulat számít – a görgetés zavartalan marad
      if (Math.abs(dx) < Math.abs(dy) * 1.8) { reset(); return; }
      g.decided = true;
      g.dir = dx > 0 ? 1 : -1;
      ind.classList.add('show', g.dir > 0 ? 'left' : 'right');
    }
    // ha az ujj visszafordul a másik irányba, a mozdulat megszakad
    const along = dx * g.dir;
    const p = Math.max(0, Math.min(1, along / TRIGGER));
    ind.style.setProperty('--p', p.toFixed(3));
    ind.classList.toggle('ready', p >= 1 && Math.abs(dy) < Math.abs(dx));
  }, { passive: true });

  const end = () => {
    if (!g) return;
    const ok = g.decided && ind.classList.contains('ready') && Date.now() - g.t < MAX_TIME * 2;
    reset();
    if (ok) {
      try { navigator.vibrate?.(10); } catch { /* */ }
      back();
    }
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', reset, { passive: true });
  window.addEventListener('blur', reset);
  window.addEventListener('hashchange', reset);
}
