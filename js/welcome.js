// Üdvözlő az első indításkor (csak teljesen új, üres felhasználónál), és a Beállításokból újra megnyitható.
// 4 rövid lépés, mindegyik kihagyható. Újranyitáskor a meglévő adatokhoz csak akkor nyúl,
// ha a felhasználó maga változtat valamit (pl. új nevet ír be), vagy mintadalt kér.

import * as store from './store.js';
import { esc, toast } from './util.js';
import { icon } from './icons.js';

export const SAMPLE_TITLE = 'DalPad mintadal';

// Teljesen saját, erre a célra kitalált szöveg (nem létező dal szövege).
export const SAMPLE_LYRICS = `[1. versszak]
[C]Hangol a [G]banda, a [Am]terem még [F]csendes,
[C]kávé a [G]pulton, a [F]mikrofon [G]vár,
[C]minden kis [G]lapon a [Am]sorrend is [F]rendes,
[C]este ma [G]újra a [F]szín[G]padon [C]állsz.

[Refrén]
[F]Szólj, dal, [G]szólj, ez a [C]mi esténk [Am]ma,
[F]akkord a [G]szó fölött, [C]kéznél a [Am]lap,
[F]lapozz, ha [G]kell, a pedál [C]vigyáz [Am]ránk,
[F]reggelig [G]tart ez a [C]nap.

[2. versszak]
[C]Akkordot [G]koppintasz, [Am]hangnemet [F]váltasz,
[C]feljebb egy [G]fél hanggal, [F]ha úgy kí[G]vánod,
[C]minden a [G]helyén, ha [Am]újra ki[F]lépsz,
[C]holnap is [G]itt lesz a [F]dalok [G]világ[C]a.`;

export const SAMPLE_INST = { key: 'C', tempo: 112, style: '8Beat', bank: 'Minta', button: 1, memo: 'mintadal – nyugodtan töröld' };

/** A mintadal felvétele (ha még nincs). Visszaad: a dal. */
export async function addSampleSong() {
  const ex = [...store.state.songs.values()].find((s) => s.sample);
  if (ex) return ex;
  return store.saveSong({ title: SAMPLE_TITLE, artist: 'DalPad', lyrics: SAMPLE_LYRICS, inst: SAMPLE_INST, sample: true });
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
          <span>Kérek egy <b>mintadalt</b>, ami megmutatja az akkordokat, a refrénkiemelést és a hangszer-jegyzetet (egy koppintással törölhető)</span></label>`;
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

    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(); } };
    document.addEventListener('keydown', onKey, true);

    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-w]');
      if (!b) return;
      const act = b.dataset.w;
      if (act === 'close') { finish(); return; }
      if (act === 'prev') { step = Math.max(0, step - 1); render(); return; }
      if (act === 'next') {
        read();
        if (step === 0) used.name = true;
        if (step === 1) used.notation = true;
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
