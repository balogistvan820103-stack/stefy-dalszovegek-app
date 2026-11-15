// Egyszeri tipp iPhone-on / iPaden, ha az app Safariban, telepítés nélkül fut:
// a főképernyőre tett alkalmazás adatai biztonságosabbak (a Safari a nem használt oldalak adatait törölheti).
// A „már láttam” jelzés csak a böngésző saját tárolójában (localStorage) van – a dalokhoz, beállításokhoz nem nyúl.

import { isIOS, isStandalone } from './util.js';
import { icon } from './icons.js';

const KEY = 'dalpad-ios-tipp-latta';

export function shouldShowIosTip() {
  try { if (localStorage.getItem(KEY)) return false; } catch { /* privát mód: legfeljebb újra megjelenik */ }
  return isIOS() && !isStandalone();
}

export function showIosTip() {
  if (!shouldShowIosTip()) return;
  try { localStorage.setItem(KEY, String(Date.now())); } catch { /* */ }
  const box = document.createElement('div');
  box.className = 'ios-tip';
  box.setAttribute('role', 'status');
  box.innerHTML = `${icon('shield')}<span>A dalaid biztonsága érdekében tedd a főképernyőre: <b>Megosztás → Főképernyőhöz adás</b></span>
    <button type="button" class="icon-btn" aria-label="Tipp bezárása">${icon('x')}</button>`;
  box.querySelector('button').addEventListener('click', () => box.remove());
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 20000);
}
