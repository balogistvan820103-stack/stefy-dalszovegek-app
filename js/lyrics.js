// Dalszöveg értelmezése megjelenítéshez: refrénjelek és szakaszcímkék felismerése.
// Tiszta függvények (nincs DOM) – a tesztek közvetlenül ezeket hívják.
// A dal elmentett szövegét SOSEM módosítja, csak a megjelenítést vezérli.

const WORD = '(?:refr[ée]n|refr|ref)';
// ismétlésjel: 2x, (2x), x2, 2×, ism., bis
const REP = '\\(?\\s*(?:\\d\\s*[x×]|[x×]\\s*\\d|ism\\.?|bis)\\s*\\)?';

const RE = {
  // [Refrén]  [Ref. 2]  [R]  [Refrén 2x]  – utána jöhet szöveg is
  bracket: new RegExp(`^\\[\\s*(?:${WORD}|r)\\s*\\.?\\s*(\\d{1,2})?\\s*\\.?\\s*(${REP})?\\s*\\]\\s*[:.]?\\s*(.*)$`, 'iu'),
  // Refrén:  Ref.  Refr.:  Refrén 2:  – utána jöhet a refrén első sora
  wordPunct: new RegExp(`^${WORD}\\s*(\\d{1,2})?\\s*[.:]+\\s*(.*)$`, 'iu'),
  // Refrén   Ref   Refrén 2x  – egyedül a sorban
  wordAlone: new RegExp(`^${WORD}\\s*(\\d{1,2})?\\s*(${REP})?$`, 'iu'),
  // R:  R.  R.:  R2:  – utána jöhet a refrén első sora
  rPunct: new RegExp('^r\\s*(\\d{1,2})?\\s*[.:]+\\s*(.*)$', 'iu'),
  // R   R2   R 2x  – egyedül a sorban
  rAlone: new RegExp(`^r\\s*(\\d{1,2})?\\s*(${REP})?$`, 'iu'),
  repOnly: new RegExp(`^${REP}$`, 'iu'),
  section: /^\[[^\]]{1,40}\]$/,
};

const repText = (s) => (s || '').replace(/[()\s]/g, '').replace(/x/i, '×').toLowerCase();

/**
 * Refrénjel-e a sor eleje?
 * Visszaad: null, vagy { label, rest, mark }
 *   label – kiírandó címke (pl. „Refrén”, „Refrén 2”, „Refrén 2×”)
 *   rest  – a jel utáni szöveg ugyanabban a sorban (a refrén első sora), vagy ''
 *   mark  – a jel eredeti alakja (pl. „R:”), ha a sorban szöveg is követi
 */
export function refrainMarker(line) {
  const t = String(line ?? '').trim();
  if (!t) return null;
  let num = ''; let rep = ''; let rest = '';
  let m;
  if ((m = t.match(RE.bracket))) { num = m[1] || ''; rep = m[2] || ''; rest = m[3] || ''; }
  else if ((m = t.match(RE.wordAlone))) { num = m[1] || ''; rep = m[2] || ''; }
  else if ((m = t.match(RE.rAlone))) { num = m[1] || ''; rep = m[2] || ''; }
  else if ((m = t.match(RE.wordPunct))) { num = m[1] || ''; rest = m[2] || ''; }
  else if ((m = t.match(RE.rPunct))) { num = m[1] || ''; rest = m[2] || ''; }
  else return null;
  rest = rest.trim();
  // „Refrén: 2x” – a maradék csak ismétlésjel, nem dalszöveg
  if (rest && RE.repOnly.test(rest)) { rep = rest; rest = ''; }
  const label = ['Refrén', num, repText(rep)].filter(Boolean).join(' ');
  const mark = rest ? t.slice(0, t.length - rest.length).trim() : '';
  return { label, rest, mark };
}

/**
 * Sorokra bontás típusokkal:
 *   gap        – üres sor
 *   section    – egyéb szögletes zárójeles címke, pl. [1. versszak]
 *   ref-label  – refrénjel külön sorban (címkeként jelenik meg)
 *   ref-line   – a refrén egy sora (mark: a sor elején álló jel, ha volt)
 *   line       – sima sor
 * A refrén a jeltől a következő üres sorig vagy a következő jelig/címkéig tart.
 */
export function parseLyrics(text) {
  const out = [];
  let inRef = false;
  for (const raw of String(text ?? '').split('\n')) {
    const t = raw.trim();
    if (!t) { inRef = false; out.push({ kind: 'gap', text: '' }); continue; }
    const r = refrainMarker(raw);
    if (r) {
      inRef = true;
      if (r.rest) out.push({ kind: 'ref-line', text: r.rest, mark: r.mark, ref: true });
      else out.push({ kind: 'ref-label', text: r.label, ref: true });
      continue;
    }
    if (RE.section.test(t)) { inRef = false; out.push({ kind: 'section', text: t.slice(1, -1).trim() }); continue; }
    out.push(inRef ? { kind: 'ref-line', text: raw, ref: true } : { kind: 'line', text: raw });
  }
  return out;
}

/**
 * Szerkesztő „Refrén” gombja: a kijelölt sorok elé [Refrén] sor kerül, utánuk – ha kell – üres sor.
 * Kijelölés nélkül a kurzor körüli versszakot (összefüggő, nem üres sorok) jelöli meg.
 * Visszaad: { text, selStart, selEnd, changed, reason }
 */
export function markRefrain(text, selStart, selEnd) {
  const src = String(text ?? '');
  const lines = src.split('\n');
  const starts = []; let p = 0;
  for (const l of lines) { starts.push(p); p += l.length + 1; }
  const lineAt = (pos) => { let i = 0; while (i + 1 < lines.length && starts[i + 1] <= pos) i++; return i; };
  let a = lineAt(Math.min(selStart, selEnd));
  let end = Math.max(selStart, selEnd);
  // ha a kijelölés pont egy sor elején ér véget, az a sor már nem tartozik bele
  let b = lineAt(end);
  if (end > Math.min(selStart, selEnd) && end === starts[b] && b > a) b--;
  if (selStart === selEnd) {
    if (!lines[a].trim()) return { text: src, selStart, selEnd, changed: false, reason: 'Állj a kurzorral a refrén egyik sorára, vagy jelöld ki a refrén sorait.' };
    while (a > 0 && lines[a - 1].trim()) a--;
    while (b < lines.length - 1 && lines[b + 1].trim()) b++;
  }
  while (a <= b && !lines[a].trim()) a++;
  while (b >= a && !lines[b].trim()) b--;
  if (a > b) return { text: src, selStart, selEnd, changed: false, reason: 'A kijelölésben nincs szöveg.' };
  if (refrainMarker(lines[a]) || (a > 0 && refrainMarker(lines[a - 1]) && !refrainMarker(lines[a - 1]).rest)) {
    return { text: src, selStart, selEnd, changed: false, reason: 'Ez a rész már refrénként van megjelölve.' };
  }
  const needBlankAfter = b < lines.length - 1 && lines[b + 1].trim() !== '';
  const outLines = [...lines.slice(0, a), '[Refrén]', ...lines.slice(a, b + 1), ...(needBlankAfter ? [''] : []), ...lines.slice(b + 1)];
  const newStart = starts[a];
  const newEnd = newStart + '[Refrén]\n'.length + lines.slice(a, b + 1).join('\n').length;
  return { text: outLines.join('\n'), selStart: newStart, selEnd: newEnd, changed: true, reason: '' };
}
