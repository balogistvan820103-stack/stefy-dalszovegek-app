# STEFY Dalszövegek

Önálló, offline-first digitális zenész-könyv (PWA) Android-telefonra és tabletre.
Nincs fiók, nincs reklám, nincs automatikus adatküldés – minden adat az eszközön, a böngésző
helyi tárolójában (IndexedDB) marad. A régi STEFY-BAND alkalmazástól teljesen független.

## Indítás a számítógépen (helyi előnézet)

```
node tools/serve.mjs 5180
```

Majd böngészőben: <http://localhost:5180/>

- `5180` – éles előnézet (a saját adataid itt lesznek)
- `5181` – külön tesztkörnyezet (más port = külön tároló, a teszt nem nyúl a valódi adatokhoz)
- Automatikus adatréteg-tesztek: <http://localhost:5181/tests/> (ideiglenes teszt-adatbázist használ, majd törli)

## Telepítés Android-telefonra (később)

A service worker, az offline indítás és a képernyő ébren tartása csak **https** címen (vagy
`localhost`-on) működik. Telefonon ezért az alkalmazást egy https-tárhelyre kell majd feltölteni
(pl. GitHub Pages) – ez **csak külön engedéllyel** történik. Utána Chrome-ban: ⋮ menü →
„Telepítés” / „Hozzáadás a kezdőképernyőhöz”, és onnantól internet nélkül is indul.

## Funkciók röviden

- Dalok: felvétel, szerkesztés, törlés (megerősítéssel), előadó, több címke, kedvenc, időbélyegek
- Keresés címben, előadóban, címkében és a teljes szövegben – ékezet nélkül is
- Rendezés: kézi (húzással, automatikus görgetéssel), cím (ABC), legutóbb használt, kedvencek elöl, hozzáadás ideje
- Nagy képernyőn kétoszlopos dallista, félkövér, nem levágott címekkel
- Fellépés-listák: név + dátum, többdalos kijelölés, duplikátum-szűrés, húzásos sorrend, duplikálás
- Fellépés mód: teljes képernyő, előző / kedvenc / következő, lapozás húzással, „Ugrás a listára”,
  következő dal címe, Bluetooth lapozópedál (nyilak, PageUp/PageDown), zárolás
- Képernyő ébren tartása minden képernyőn (Screen Wake Lock), háttérbe kerüléskor automatikus újrakérés
- Dalszöveg: 8 betűstílus, 14–70 px betűméret, sortávolság, vastagság, igazítás
- Húzásos vissza-navigáció (`js/swipeback.js`): vízszintes legyintés bármelyik irányba = Vissza; a Beállításokban kikapcsolható
- Refrénkiemelés (`js/lyrics.js`): refrénjel a Refrén / Refren / Refr / Ref (szögletes zárójelben, ponttal vagy
  kettősponttal is) és az önálló R / R: / R. – külön sorban vagy a refrén első sorának elején. A refrén minden sora
  színes csíkot és halvány hátteret kap az üres sorig vagy a következő jelig; szöveg nélküli jelnél „Refrén” címke.
  A szín a Beállításokban választható; a dalok elmentett szövege nem változik. Szerkesztőben „Refrén” gomb.
- Új dal: „Beírás / bemásolás”, „Fotózás füzetből” (Tesseract, magyar „best” csomag, teljesen a készüléken, offline),
  „Fájlból”
- Saját háttér a dalszöveg mögött (állítható sötétítéssel) és külön saját kezdőkép
- Kezdőképernyő: főcím / alcím / szlogen külön szerkeszthető (szöveg, méret, szín, igazítás, pozíció), húzással
- Kedvencek, utolsó 20 megnyitott dal
- Fájlimport: „Mappa importálása” (almappákkal; az almappa neve címke lesz) és „Fájlok tömeges importálása”;
  formátumok: Word (.docx és régi .doc), TXT, OpenDocument (.odt), RTF – teljesen offline, külső könyvtár nélkül
  (`js/docread.js`); a fájlnév lesz a cím, TXT-nél UTF-8 és régi Windows-os (1250) kódolás is, azonos dalok nem duplázódnak
- „Több dal kijelölése”: kijelöltek fellépés-listához adása, címke hozzáadása/levétele, kedvencnek jelölés, törlés
- Címkesor „Mindegyik” szűrővel, állítható dalcím-méret a listákban, „Helyben mentve” jelzés a fejlécben
- Teljes JSON mentés/import előnézettel; módok: megtartás, hozzáfűzés, teljes visszaállítás (külön megerősítéssel);
  import előtt automatikus pillanatkép, amelyből vissza lehet állni. Az import egyetlen tranzakció –
  hibás fájl miatt nem veszhet el adat.

## Szerkezet

```
index.html, manifest.webmanifest, sw.js
css/app.css
js/app.js            – keret, útválasztás, navigáció
js/store.js, db.js   – adatok (IndexedDB), keresés, rendezés
js/backup.js         – export / import / pillanatképek
js/wakelock.js       – képernyő ébren tartása
js/dnd.js            – húzásos átrendezés automatikus görgetéssel
js/components.js     – közös elemek (dalkártya, betűpanel, háttérképek)
js/views/*.js        – képernyők
tests/               – automatikus tesztek
tools/serve.mjs      – helyi szerver; tools/make-icons.mjs – ikonkészítő
```

Új verzió kiadásakor a `sw.js` fájlban a `CACHE` nevét növelni kell, hogy a telefonok frissüljenek.
