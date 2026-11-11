// Beállítások: ébren tartás, dalszöveg-megjelenés, hátterek, zárolás, mentés/import, tárhely.

import * as store from '../store.js';
import * as wake from '../wakelock.js';
import * as backup from '../backup.js';
import { esc, toast, confirmBox, modal, fmtDateTime, fmtBytes, debounce } from '../util.js';
import { icon, tile } from '../icons.js';
import { fontPanel, applyReaderStyle, lyricsHTML, mediaURL, processImage, pickFile } from '../components.js';
import { txtImportFlow } from '../txtimport.js';
import { applyListTitleSize } from './songs.js';

const SAMPLE = '[Refrén]\nMindig veled a színpadon,\nfényben, dalban, hajnalon.\nSzól a zene, száll a szó,\nveled minden olyan jó.';

const WAKE_TEXT = {
  off: 'Kikapcsolva – a képernyő a rendszer beállítása szerint kikapcsolhat.',
  active: 'Aktív – a képernyő az alkalmazás minden képernyőjén ébren marad.',
  pending: 'Bekapcsolás folyamatban…',
  paused: 'Szünetel, amíg az alkalmazás a háttérben van – visszatéréskor automatikusan újra bekapcsol.',
  unsupported: '',
  error: '',
};

export function settingsView(ctx) {
  const el = document.createElement('div');
  el.className = 'page settings-page';
  const app = store.settings('app');
  el.innerHTML = `
    <section class="card set-sec">
      <h2 class="sec-head">${tile('sun', 'gold')} Képernyő ébren tartása</h2>
      <label class="switch-row"><input type="checkbox" data-k="wakeLock" ${app.wakeLock ? 'checked' : ''}><span class="switch"></span><span>Képernyő ébren tartása az alkalmazás minden képernyőjén</span></label>
      <p class="status-line" data-wake-status></p>
    </section>

    <section class="card set-sec">
      <h2 class="sec-head">${tile('back', 'blue')} Navigáció és kijelzés</h2>
      <label class="switch-row"><input type="checkbox" data-k="twoColumns" ${app.twoColumns !== false ? 'checked' : ''}><span class="switch"></span><span>${icon('list')} Két hasáb fekvő tableten, ha a dal egy hasábban nem fér ki</span></label>
      <label class="switch-row"><input type="checkbox" data-k="showClock" ${app.showClock !== false ? 'checked' : ''}><span class="switch"></span><span>${icon('clock')} Pontos idő mutatása minden képernyőn (fellépés módban nagy méretben)</span></label>
      <label class="switch-row"><input type="checkbox" data-k="swipeBack" ${app.swipeBack !== false ? 'checked' : ''}><span class="switch"></span><span>Húzásos vissza-navigáció – vízszintes legyintés (balról jobbra vagy jobbról balra) = Vissza</span></label>
      <p class="muted small">${icon('info')} Húzás közben megjelenik egy nyíl; ha elég hosszú a mozdulat, a nyíl kiemelődik, és felengedéskor visszalép. Szövegmezőkben, a címkesoron, húzásos átrendezéskor és fellépés módban (ahol a legyintés lapoz) nem működik.</p>
    </section>

    <section class="card set-sec">
      <h2 class="sec-head">${tile('type', 'purple')} Dalszöveg megjelenése</h2>
      <div class="font-preview"><div class="lyrics"></div></div>
      <div data-font-panel></div>
      <label class="switch-row"><input type="checkbox" data-k="showArtist" ${app.showArtist ? 'checked' : ''}><span class="switch"></span><span>Előadó mutatása a dallistákban</span></label>
      <label class="field"><span class="field-label">Dalcímek mérete a listákban <b data-v="lts">${app.listTitleSize} px</b></span>
        <input type="range" min="14" max="44" step="1" value="${app.listTitleSize}" data-lts></label>
      <div class="lts-preview"><span class="song-title">Erdőben nyíló gyöngyvirág</span></div>
    </section>

    <section class="card set-sec">
      <h2 class="sec-head">${tile('image', 'blue')} Dalszöveg saját háttere</h2>
      <p class="muted small">Csak a dalszöveg olvasófelülete és a fellépés mód mögött jelenik meg. A kezdőképernyő háttere ettől független.</p>
      <div class="bg-row">
        <div class="bg-thumb" data-thumb="bg-reader"></div>
        <div class="bg-btns">
          <button type="button" class="btn btn-blue" data-act="pick-reader">${icon('image')} Kép kiválasztása / cseréje</button>
          <button type="button" class="btn btn-ghost" data-act="del-reader">${icon('trash')} Kép törlése</button>
        </div>
      </div>
      <label class="field"><span class="field-label">Sötétítő réteg az olvashatóságért <b data-v="overlay"></b></span>
        <input type="range" min="0" max="0.95" step="0.05" data-reader="overlay" value="${store.settings('reader').overlay}"></label>
    </section>

    <section class="card set-sec">
      <h2 class="sec-head">${tile('home', 'orange')} Kezdőképernyő</h2>
      <div class="bg-row">
        <div class="bg-thumb" data-thumb="bg-home"></div>
        <div class="bg-btns">
          <a class="btn btn-primary" href="#/?edit=1">${icon('edit')} Feliratok és háttér szerkesztése</a>
          <button type="button" class="btn btn-blue" data-act="pick-home">${icon('image')} Kezdőkép kiválasztása / cseréje</button>
          <button type="button" class="btn btn-ghost" data-act="del-home">${icon('trash')} Kezdőkép törlése</button>
        </div>
      </div>
    </section>

    <section class="card set-sec">
      <h2 class="sec-head">${tile('mic', 'red')} Fellépés mód</h2>
      <label class="switch-row"><input type="checkbox" data-k="performLock" ${app.performLock ? 'checked' : ''}><span class="switch"></span><span>Zárolás – tiltja a véletlen szerkesztést, törlést és átrendezést</span></label>
      <label class="switch-row"><input type="checkbox" data-k="showNext" ${app.showNext ? 'checked' : ''}><span class="switch"></span><span>A következő dal címének mutatása fellépés közben</span></label>
      <p class="muted small">${icon('info')} Tipp: Bluetooth lapozópedállal is lapozhatsz (jobbra/balra nyíl, PageUp/PageDown).</p>
    </section>

    <section class="card set-sec">
      <h2 class="sec-head">${tile('tag', 'pink')} Címkék</h2>
      <a class="btn btn-pink" href="#/tags">${icon('tag')} Címkék kezelése (létrehozás, átnevezés, törlés)</a>
    </section>

    <section class="card set-sec">
      <h2 class="sec-head">${tile('shield', 'teal')} Mentés, import és export</h2>
      <p class="muted small">A teljes mentés tartalmazza a dalokat, címkéket, kedvenceket, fellépés-listákat, sorrendeket és beállításokat. Rendszeresen ments, és tárold a fájlt a telefonon kívül is (pl. e-mailben, felhőben).</p>
      <label class="switch-row"><input type="checkbox" data-media checked><span class="switch"></span><span>Háttérképek is kerüljenek a mentésbe</span></label>
      <div class="row-wrap">
        <button type="button" class="btn btn-teal" data-act="export">${icon('download')} Teljes mentés letöltése (JSON)</button>
        <button type="button" class="btn btn-purple" data-act="share" hidden>${icon('share')} Mentés megosztása</button>
        <button type="button" class="btn btn-gold" data-act="import">${icon('upload')} Importálás fájlból</button>
      </div>
      <h3 class="sub-head">${icon('folder')} Dalok beolvasása Word-, TXT-, ODT- és RTF-fájlokból</h3>
      <div class="row-wrap">
        <button type="button" class="btn btn-orange" data-act="txt-folder">${icon('folder')} Mappa importálása</button>
        <button type="button" class="btn btn-blue" data-act="txt-files">${icon('upload')} Fájlok tömeges importálása</button>
      </div>
      <div class="snapshots"></div>
    </section>

    <section class="card set-sec">
      <h2 class="sec-head">${tile('database', 'green')} Tárhely és offline működés</h2>
      <ul class="info-list" data-storage></ul>
    </section>

    <section class="card set-sec about">
      <h2 class="sec-head">${tile('songs', 'blue')} Névjegy</h2>
      <p><b>STEFY Dalszövegek</b> · ${esc(ctx.version)}<br><span class="muted">Offline digitális zenész-könyv. Nincs fiók, nincs reklám, nincs automatikus adatküldés – minden adat ezen az eszközön marad.</span></p>
    </section>`;

  /* ---- ébren tartás ---- */
  const wakeStatus = el.querySelector('[data-wake-status]');
  const offWake = wake.onStatus((status, err) => {
    let text = WAKE_TEXT[status] || '';
    if (status === 'unsupported') text = wake.unsupportedReason();
    if (status === 'error') text = `Nem sikerült bekapcsolni: ${err}`;
    if (!wake.supported && status === 'off') text = `Figyelem: ${wake.unsupportedReason()}`;
    wakeStatus.textContent = text;
    wakeStatus.className = `status-line st-${status}${!wake.supported ? ' st-unsupported' : ''}`;
  });

  el.addEventListener('change', async (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const val = e.target.checked;
    await store.patchSettings('app', { [k]: val });
    if (k === 'wakeLock') {
      const st = await wake.setEnabled(val);
      if (val && st === 'unsupported') toast(wake.unsupportedReason(), 'error', 6000);
      else if (val && st === 'active') toast('A képernyő ébren marad.', 'success');
    }
    if (k === 'performLock') toast(val ? 'Zárolás bekapcsolva.' : 'Zárolás feloldva.', 'success');
  });

  /* ---- dalszöveg-megjelenés ---- */
  const preview = el.querySelector('.font-preview');
  const paintPreview = () => {
    applyReaderStyle(preview);
    preview.querySelector('.lyrics').innerHTML = lyricsHTML(SAMPLE, store.settings('reader').highlightSections);
  };
  const panel = fontPanel({ onChange: paintPreview });
  el.querySelector('[data-font-panel]').replaceWith(panel);
  paintPreview();

  const ltsInput = el.querySelector('[data-lts]');
  const saveLts = debounce(() => store.saveSettings('app', store.settings('app')), 300);
  ltsInput.addEventListener('input', () => {
    store.settings('app').listTitleSize = Number(ltsInput.value);
    el.querySelector('[data-v="lts"]').textContent = `${ltsInput.value} px`;
    applyListTitleSize(ltsInput.value);
    saveLts();
  });

  const overlayInput = el.querySelector('[data-reader="overlay"]');
  const overlayVal = el.querySelector('[data-v="overlay"]');
  const saveOverlay = debounce(() => store.saveSettings('reader', store.settings('reader')), 300);
  const paintOverlay = () => { overlayVal.textContent = `${Math.round(Number(overlayInput.value) * 100)}%`; };
  paintOverlay();
  overlayInput.addEventListener('input', () => {
    store.settings('reader').overlay = Number(overlayInput.value);
    paintOverlay();
    paintThumb('bg-reader');
    saveOverlay();
  });

  /* ---- hátterek ---- */
  async function paintThumb(key) {
    const t = el.querySelector(`[data-thumb="${key}"]`);
    const url = await mediaURL(key);
    t.style.backgroundImage = url ? `url("${url}")` : '';
    t.classList.toggle('empty-thumb', !url);
    t.innerHTML = url ? (key === 'bg-reader' ? `<span class="thumb-shade" style="opacity:${store.settings('reader').overlay}"></span><span class="thumb-text">Aa</span>` : '') : `<span>${icon('image')}<br>Nincs saját kép</span>`;
  }
  paintThumb('bg-reader');
  paintThumb('bg-home');

  async function pickBg(key, label) {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const blob = await processImage(file);
      await store.setMedia(key, blob);
      await paintThumb(key);
      toast(`${label} háttérképe beállítva.`, 'success');
    } catch (err) {
      toast(`${err.message} A korábbi kép megmaradt.`, 'error', 6500);
    }
  }
  async function delBg(key, label) {
    const rec = await store.getMedia(key);
    if (!rec) { toast('Nincs beállított saját kép.', 'info'); return; }
    if (!(await confirmBox('Háttérkép törlése', `Törlöd a(z) ${label.toLowerCase()} saját háttérképét?`, { okLabel: 'Törlés', danger: true }))) return;
    await store.deleteMedia(key);
    await paintThumb(key);
    toast('Háttérkép törölve.');
  }

  /* ---- mentés / import ---- */
  const shareBtn = el.querySelector('[data-act=share]');
  try {
    shareBtn.hidden = !(navigator.canShare && navigator.canShare({ files: [new File(['{}'], 'a.json', { type: 'application/json' })] }));
  } catch { shareBtn.hidden = true; }

  async function doExport(share) {
    const includeMedia = el.querySelector('[data-media]').checked;
    const blob = await backup.exportBlob({ includeMedia });
    const name = backup.exportFileName();
    if (share) {
      try {
        await navigator.share({ files: [new File([blob], name, { type: 'application/json' })], title: 'STEFY Dalszövegek mentés' });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return;
        toast('A megosztás nem sikerült, helyette letöltöm a fájlt.', 'info');
      }
    }
    backup.downloadBlob(blob, name);
    toast(`Mentés elkészült: ${name} (${fmtBytes(blob.size)})`, 'success', 5000);
  }

  async function doImport() {
    const file = await pickFile('application/json,.json,text/plain');
    if (!file) return;
    let parsed;
    try {
      parsed = backup.parseBackup(await backup.readFile(file));
    } catch (err) {
      await modal({ title: 'Az import nem lehetséges', body: `<p class="err-text">${esc(err.message)}</p><p class="muted">A meglévő adataid nem változtak.</p>`, buttons: [{ label: 'Rendben', value: true, kind: 'primary' }] });
      return;
    }
    const s = parsed.summary;
    const cur = store.stats();
    const body = `
      <div class="import-summary">
        <p><b>Fájl:</b> ${esc(file.name)} (${fmtBytes(file.size)})${s.exportedAt ? `<br><b>Mentés ideje:</b> ${esc(fmtDateTime(s.exportedAt))}` : ''}</p>
        <div class="sum-grid">
          <span>${tile('songs', 'blue', 'tile-sm')} <b>${s.songs}</b> dal</span>
          <span>${tile('star', 'gold', 'tile-sm')} <b>${s.favorites}</b> kedvenc</span>
          <span>${tile('tag', 'pink', 'tile-sm')} <b>${s.tags}</b> címke</span>
          <span>${tile('mic', 'purple', 'tile-sm')} <b>${s.setlists}</b> fellépés-lista</span>
          <span>${tile('settings', 'teal', 'tile-sm')} Beállítások: <b>${s.hasSettings ? 'igen' : 'nem'}</b></span>
          <span>${tile('image', 'orange', 'tile-sm')} Háttérképek: <b>${s.media.length}</b></span>
        </div>
        ${s.sampleTitles.length ? `<p class="muted small">Például: ${s.sampleTitles.map(esc).join(', ')}${s.songs > s.sampleTitles.length ? '…' : ''}</p>` : ''}
        ${parsed.warnings.length ? `<p class="warn-text">${parsed.warnings.map(esc).join('<br>')}</p>` : ''}
        <p class="muted small">Jelenleg az eszközön: ${cur.songs} dal, ${cur.tags} címke, ${cur.setlists} lista.</p>
        <div class="mode-list">
          <label class="mode"><input type="radio" name="mode" value="keep" checked><span><b>Meglévő adatok megtartása</b><small>Csak az új elemek kerülnek be. Ha egy dal vagy lista már megvan, a meglévő változat marad.</small></span></label>
          <label class="mode"><input type="radio" name="mode" value="append"><span><b>Importált adatok hozzáfűzése</b><small>Minden importált dal és lista bekerül (a teljesen azonos dalok kivételével), ütközésnél új példányként.</small></span></label>
          <label class="mode mode-danger"><input type="radio" name="mode" value="replace"><span><b>Teljes visszaállítás</b><small>A jelenlegi dalok, címkék, listák és beállítások helyére a fájl tartalma kerül.</small></span></label>
        </div>
        <p class="muted small">${icon('shield')} Import előtt automatikus biztonsági pillanatkép készül, amelyből vissza lehet állni.</p>
      </div>`;
    const mode = await modal({
      title: 'Import előnézet',
      body,
      wide: true,
      buttons: [{ label: 'Mégse', value: null, kind: 'ghost' }, { label: 'Importálás', value: true, kind: 'primary' }],
      getValue: (box) => box.querySelector('input[name=mode]:checked').value,
    });
    if (!mode) return;
    if (mode === 'replace') {
      const ok = await confirmBox('Teljes visszaállítás – megerősítés', `FIGYELEM: a jelenlegi ${cur.songs} dal, ${cur.tags} címke, ${cur.setlists} lista és a beállítások helyére a fájl tartalma kerül. Biztosan folytatod? (Előtte pillanatkép készül.)`, { okLabel: 'Igen, teljes visszaállítás', danger: true });
      if (!ok) return;
    }
    try {
      const res = await backup.applyImport(parsed.data, mode);
      toast(`Import kész: ${res.songsAdded} dal${res.songsSkipped ? `, ${res.songsSkipped} kihagyva (már megvolt)` : ''}, ${res.tagsAdded} címke, ${res.setlistsAdded} lista.`, 'success', 6000);
      wake.setEnabled(store.settings('app').wakeLock);
      ctx.rerender();
    } catch (err) {
      console.error(err);
      await modal({ title: 'Az import nem sikerült', body: `<p class="err-text">${esc(err.message)}</p><p class="muted">A művelet egyben fut, ezért a meglévő adataid nem változtak.</p>`, buttons: [{ label: 'Rendben', value: true, kind: 'primary' }] });
    }
  }

  async function renderSnapshots() {
    const box = el.querySelector('.snapshots');
    const snaps = await store.listSnapshots();
    box.innerHTML = snaps.length ? `<h3 class="sub-head">${icon('clock')} Import előtti pillanatképek</h3>
      ${snaps.map((s) => `<div class="snap-row" data-id="${esc(s.id)}"><span><b>${esc(s.label)}</b><small>${esc(fmtDateTime(s.createdAt))} · ${s.data?.songs?.length || 0} dal, ${s.data?.setlists?.length || 0} lista</small></span>
        <button type="button" class="btn btn-ghost btn-sm" data-act="snap-restore">${icon('reset')} Visszaállítás</button></div>`).join('')}` : '';
  }
  renderSnapshots();

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'pick-reader': pickBg('bg-reader', 'A dalszöveg'); break;
      case 'del-reader': delBg('bg-reader', 'dalszöveg'); break;
      case 'pick-home': pickBg('bg-home', 'A kezdőképernyő'); break;
      case 'del-home': delBg('bg-home', 'kezdőképernyő'); break;
      case 'export': doExport(false); break;
      case 'share': doExport(true); break;
      case 'import': doImport(); break;
      case 'txt-folder':
      case 'txt-files':
        if (await txtImportFlow({ folder: b.dataset.act === 'txt-folder' })) { renderSnapshots(); renderStorage(); }
        break;
      case 'snap-restore': {
        const id = b.closest('[data-id]').dataset.id;
        const snap = (await store.listSnapshots()).find((x) => x.id === id);
        if (!snap) return;
        const ok = await confirmBox('Pillanatkép visszaállítása', `Visszaállítod az adatokat erre az állapotra: „${snap.label}” (${fmtDateTime(snap.createdAt)})? A jelenlegi állapotról előtte újabb pillanatkép készül.`, { okLabel: 'Visszaállítás', danger: true });
        if (!ok) return;
        await backup.restoreSnapshot(snap);
        toast('Pillanatkép visszaállítva.', 'success');
        ctx.rerender();
        break;
      }
      case 'persist': {
        const ok = await navigator.storage?.persist?.();
        toast(ok ? 'Tartós tárolás engedélyezve.' : 'A böngésző most nem engedélyezte a tartós tárolást (telepített alkalmazásként gyakran automatikus).', ok ? 'success' : 'info', 5000);
        renderStorage();
        break;
      }
      default: break;
    }
  });

  async function renderStorage() {
    const ul = el.querySelector('[data-storage]');
    const st = store.stats();
    let usage = '–'; let persisted = null;
    try { const est = await navigator.storage?.estimate?.(); if (est) usage = `${fmtBytes(est.usage)} / ${fmtBytes(est.quota)}`; } catch { /* */ }
    try { persisted = await navigator.storage?.persisted?.(); } catch { /* */ }
    const sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
    ul.innerHTML = `
      <li>${icon('songs')} ${st.songs} dal · ${st.tags} címke · ${st.setlists} fellépés-lista · ${st.favorites} kedvenc</li>
      <li>${icon('database')} Felhasznált hely: ${usage}</li>
      <li>${icon('shield')} Tartós tárolás: ${persisted === null ? 'nem ellenőrizhető' : (persisted ? '<b class="ok">engedélyezve</b>' : 'nincs engedélyezve')} ${persisted === false ? '<button type="button" class="btn btn-ghost btn-sm" data-act="persist">Kérés</button>' : ''}</li>
      <li>${icon('wifiOff')} Offline indítás: ${sw ? '<b class="ok">készen áll</b>' : (window.isSecureContext ? 'előkészítés alatt (töltsd újra az oldalt)' : 'nem elérhető – az oldal nem https/localhost címről fut')}</li>`;
  }
  renderStorage();

  return {
    id: 'settings',
    title: 'Beállítások',
    back: '#/',
    nav: 'settings',
    el,
    restoreScroll: true,
    cleanup: () => { offWake(); panel.flush(); saveOverlay.flush(); saveLts.flush(); },
  };
}
