// Üdvözlő az első indításkor (csak teljesen új, üres felhasználónál), és a Beállításokból újra megnyitható.
// 4 rövid lépés, mindegyik kihagyható. Újranyitáskor a meglévő adatokhoz csak akkor nyúl,
// ha a felhasználó maga változtat valamit (pl. új nevet ír be), vagy mintadalt kér.

import * as store from './store.js';
import { esc, toast, confirmBox } from './util.js';
import { icon } from './icons.js';

export const SAMPLE_TITLE = 'Tavaszi szél vizet áraszt';
export const SAMPLE_ARTIST = 'magyar népdal';

// Ismert magyar népdal: a népdalok szövege és dallama közkincs (nem áll szerzői jogi védelem
// alatt), így az alkalmazásban szabadon közölhető. Akkordok: A-moll, a közismert C – G – Am – Dm – E
// kísérettel (nyilvános akkordlap alapján), szintetizátoron is jól szól.
export const SAMPLE_LYRICS = `[1. versszak]
[C]Tavaszi szél [G]vizet [C]áraszt,
[C]vi[G]rágom, [C]vi[G]rágom,
[C]minden madár [G]társat [Am]választ,
[Dm]vi[E]rágom, [Am]virágom.

[2. versszak]
[C]Hát én immár [G]kit vá[C]lasszak,
[C]vi[G]rágom, [C]vi[G]rágom?
[C]Te engemet, [G]én té[Am]gedet,
[Dm]vi[E]rágom, [Am]virágom.`;

export const SAMPLE_INST = { key: 'Am', tempo: 96, style: 'Folk / lassú', bank: 'Minta', button: 1, memo: 'mintadal – nyugodtan töröld' };

/** A mintadal felvétele (ha még nincs). Visszaad: a dal. */
export async function addSampleSong() {
  const ex = [...store.state.songs.values()].find((s) => s.sample);
  if (ex) return ex;
  return store.saveSong({ title: SAMPLE_TITLE, artist: SAMPLE_ARTIST, lyrics: SAMPLE_LYRICS, inst: SAMPLE_INST, sample: true });
}

/**
 * Figyelmeztetés a H/B jelölés váltása előtt (a már beírt B akkordok jelentése megváltozik).
 * true = „Váltás”, false = „Mégse” (ilyenkor semmi nem változhat).
 */
export function confirmNotationSwitch() {
  return confirmBox('Akkordjelölés váltása',
    'Figyelem: a már beírt B akkordok jelentése megváltozik (magyar jelölésben a B = nemzetközi Bb). Biztosan váltasz?',
    { okLabel: 'Váltás', cancelLabel: 'Mégse' });
}

/** Kell-e megmutatni induláskor: csak új, üres felhasználónál, és ha még nem zárta le. */
export function shouldShowWelcome() {
  return store.state.fresh && !store.settings('app').welcomeDone;
}

/**
 * Az üdvözlő megnyitása. reopen = a Beállításokból (meglévő adatok mellett).
 * Visszaad: { sampleId } ha mintadal készült, különben {}.
 */
export function openWelcome({ reopen = false } = {}) {
  return new Promise((resolve) => {
    const app = store.settings('app');
    const startName = reopen ? String(store.settings('home').title?.text || '') : '';
    const startNotation = app.chordNotation === 'intl' ? 'intl' : 'hu';
    const st = { name: startName, notation: startNotation, sample: false };
    let step = 0;
    const STEPS = 4;

    const back = document.createElement('div');
    back.className = 'modal-backdrop welcome-backdrop';
    const box = document.createElement('div');
    box.className = 'modal welcome';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Üdvözöl a DalPad');
    back.appendChild(box);
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));

    const body = () => {
      if (step === 0) {
        return `<h2 class="modal-title">Üdvözöl a DalPad!</h2>
          <p>Dalszöveg- és akkordkönyv a színpadra – internet nélkül is működik.</p>
          <label class="field"><span class="field-label">Mi a zenekarod (vagy a te) neved?</span>
            <input class="input input-lg" name="wl-name" maxlength="40" autocomplete="off" placeholder="pl. Hajnal Zenekar" value="${esc(st.name)}"></label>
          <p class="muted small">Ez lesz a kezdőkép főcíme – később a kezdőlapon a ceruzával módosítható. Ha üresen hagyod, a „DalPad” felirat marad.</p>`;
      }
      if (step === 1) {
        return `<h2 class="modal-title">Akkordjelölés</h2>
          <p>Hogyan jelölöd a hangokat? (A Beállításokban bármikor átállítható.)</p>
          <div class="notation-choice" role="radiogroup" aria-label="Akkordjelölés">
            <label><input type="radio" name="wl-notation" value="hu" ${st.notation === 'hu' ? 'checked' : ''}><span><b>Magyar (H / B)</b><br><small class="muted">H = fehér billentyű, B = a H alatti fekete</small></span></label>
            <label><input type="radio" name="wl-notation" value="intl" ${st.notation === 'intl' ? 'checked' : ''}><span><b>Nemzetközi (B / Bb)</b><br><small class="muted">B = fehér billentyű, Bb = fekete</small></span></label>
          </div>`;
      }
      if (step === 2) {
        return `<h2 class="modal-title">Így viheted be a dalaidat</h2>
          <ul class="welcome-list">
            <li>${icon('edit')}<span><b>Beírás vagy bemásolás</b> – Dalok → <b>+ Új dal</b>.</span></li>
            <li>${icon('camera')}<span><b>Fotózás füzetből</b> – a telefon kamerájával, a szöveget a készülék ismeri fel, internet nélkül.</span></li>
            <li>${icon('folder')}<span><b>Fájlból vagy egész mappából</b> – Word, TXT, ODT, RTF fájlok (Dalok → Mappa / Fájlok importálása).</span></li>
          </ul>`;
      }
      return `<h2 class="modal-title">Mentsd rendszeresen!</h2>
        <p>${icon('shield')} A dalaid <b>csak ezen a készüléken</b> vannak, ezért érdemes rendszeresen mentést készíteni: <b>Beállítások → Mentés, import és export → Teljes mentés letöltése</b>, és a fájlt a telefonon kívül is eltenni.</p>
        <label class="switch-row"><input type="checkbox" name="wl-sample" ${st.sample ? 'checked' : ''}><span class="switch"></span>
          <span>Kérek egy <b>mintadalt</b>, – a <b>„Tavaszi szél vizet áraszt”</b> népdalt akkordokkal és hangszer-jegyzettel (egy koppintással törölhető)</span></label>`;
    };

    const render = () => {
      box.innerHTML = `<div class="welcome-step">${body()}</div>
        <div class="welcome-dots" aria-hidden="true">${Array.from({ length: STEPS }, (_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
        <div class="modal-buttons">
          <button type="button" class="btn btn-ghost" data-w="skip">Kihagyás</button>
          ${step > 0 ? '<button type="button" class="btn btn-ghost" data-w="prev">Vissza</button>' : ''}
          <button type="button" class="btn btn-primary" data-w="next">${step < STEPS - 1 ? 'Tovább' : `${icon('check')} Kész`}</button>
        </div>
        <button type="button" class="icon-btn welcome-close" data-w="close" aria-label="Üdvözlő bezárása">${icon('x')}</button>`;
      const first = box.querySelector('input[name=wl-name]');
      if (first) setTimeout(() => first.focus(), 60);
    };

    // a lépés mezőinek beolvasása (csak „Tovább”/„Kész” esetén – a „Kihagyás” nem változtat semmit)
    const read = () => {
      const n = box.querySelector('input[name=wl-name]'); if (n) st.name = n.value.trim();
      const r = box.querySelector('input[name=wl-notation]:checked'); if (r) st.notation = r.value;
      const s = box.querySelector('input[name=wl-sample]'); if (s) st.sample = s.checked;
    };
    const used = { name: false, notation: false, sample: false };

    const finish = async () => {
      document.removeEventListener('keydown', onKey, true);
      back.classList.remove('show');
      setTimeout(() => back.remove(), 200);
      const result = {};
      try {
        const appPatch = { welcomeDone: true };
        if (used.notation && st.notation !== startNotation) appPatch.chordNotation = st.notation;
        if (used.name && st.name && st.name !== startName) {
          appPatch.bandName = st.name;
          const home = store.clone(store.settings('home'));
          home.title.text = st.name;
          await store.saveSettings('home', home);
        }
        // újranyitáskor csak akkor ment, ha a felhasználó tényleg változtatott valamit
        if (!reopen || appPatch.chordNotation || appPatch.bandName) await store.patchSettings('app', appPatch);
        if (used.sample && st.sample) {
          const s = await addSampleSong();
          result.sampleId = s.id;
          toast('A mintadal bekerült a dalok közé.', 'success', 2500);
        }
      } catch (e) { toast(`Hiba: ${e.message}`, 'error'); }
      resolve(result);
    };

    let asking = false; // nyitva van-e a jelölésváltás megerősítése (Escape ilyenkor csak azt zárja)
    const onKey = (e) => { if (e.key === 'Escape' && !asking) { e.stopPropagation(); finish(); } };
    document.addEventListener('keydown', onKey, true);

    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-w]');
      if (!b) return;
      const act = b.dataset.w;
      if (act === 'close') { finish(); return; }
      if (act === 'prev') { step = Math.max(0, step - 1); render(); return; }
      if (act === 'next') {
        read();
        if (step === 0) used.name = true;
        if (step === 1) {
          // újranyitáskor (meglévő dalok mellett) a jelölés váltása előtt figyelmeztet
          let ok = true;
          if (reopen && st.notation !== startNotation) {
            asking = true;
            try { ok = await confirmNotationSwitch(); } finally { asking = false; }
          }
          if (!ok) {
            st.notation = startNotation;
            render();
            return;
          }
          used.notation = true;
        }
        if (step === 3) used.sample = true;
      }
      // a „Kihagyás” ezt a lépést változtatás nélkül átugorja
      if (step >= STEPS - 1) { finish(); return; }
      step++;
      render();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.name === 'wl-name') { e.preventDefault(); box.querySelector('[data-w=next]').click(); }
    });
    render();
  });
}
