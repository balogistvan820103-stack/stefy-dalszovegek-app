// PNG alkalmazásikonok előállítása függőség nélkül (az icons/icon.svg rajzolatát követi).
// Futtatás: node tools/make-icons.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const BLUE = hex('#3b82f6'); const PURPLE = hex('#7c3aed'); const PINK = hex('#db2777');
const GOLD1 = hex('#ffe08a'); const GOLD2 = hex('#f59e0b'); const TEAL = hex('#14d8c4');

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax; const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// minta a 512-es koordinátarendszerben; visszaad [r,g,b,a]
function sample(x, y, maskable) {
  // maszkolható ikon: teljes négyzet háttér, a rajzolat a biztonsági zónába kicsinyítve
  let rounded = !maskable;
  let u = x; let v = y;
  if (maskable) { u = 256 + (x - 256) / 0.8; v = 256 + (y - 256) / 0.8; }
  // háttér
  if (rounded) {
    const r = 112; const cx = Math.min(Math.max(x, r), 512 - r); const cy = Math.min(Math.max(y, r), 512 - r);
    if (Math.hypot(x - cx, y - cy) > r) return [0, 0, 0, 0];
  }
  const t = (x + y) / 1024;
  let col = t < 0.5 ? mix(BLUE, PURPLE, t * 2) : mix(PURPLE, PINK, (t - 0.5) * 2);
  if (Math.hypot(u - 256, v - 256) < 190) col = mix(col, TEAL, 0.18);
  const gold = mix(GOLD1, GOLD2, Math.max(0, Math.min(1, (v - 110) / 300)));
  const inNote =
    segDist(u, v, 206, 360, 206, 150) <= 17 ||
    segDist(u, v, 206, 150, 376, 116) <= 17 ||
    segDist(u, v, 376, 116, 376, 320) <= 17 ||
    ((u - 160) ** 2) / 56 ** 2 + ((v - 362) ** 2) / 44 ** 2 <= 1 ||
    ((u - 330) ** 2) / 56 ** 2 + ((v - 322) ** 2) / 44 ** 2 <= 1;
  if (inNote) col = gold;
  return [...col, 255];
}

function render(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4; const scale = 512 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const c = sample((px + (sx + 0.5) / ss) * scale, (py + (sy + 0.5) / ss) * scale, maskable);
        r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
      }
      const o = (py * size + px) * 4;
      if (a) { buf[o] = Math.round(r / a); buf[o + 1] = Math.round(g / a); buf[o + 2] = Math.round(b / a); }
      buf[o + 3] = Math.round(a / (ss * ss));
    }
  }
  return png(size, buf);
}

mkdirSync(join(root, 'icons'), { recursive: true });
writeFileSync(join(root, 'icons', 'icon-192.png'), render(192, false));
writeFileSync(join(root, 'icons', 'icon-512.png'), render(512, false));
writeFileSync(join(root, 'icons', 'icon-maskable-512.png'), render(512, true));
console.log('Ikonok elkészültek.');
