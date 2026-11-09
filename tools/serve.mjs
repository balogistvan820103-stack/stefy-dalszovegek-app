// Egyszerű, függőség nélküli helyi webszerver az előnézethez és a teszteléshez.
// Használat: node tools/serve.mjs [port] [--host 0.0.0.0]
// A különböző portok külön böngésző-tárolót kapnak, így a tesztkörnyezet
// (pl. 5181) nem keveredik az éles előnézet (5180) adataival.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a))) || 5180;
const hostIdx = args.indexOf('--host');
const host = hostIdx >= 0 ? args[hostIdx + 1] : '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
};

const BLOCKED = ['_mentesek', 'node_modules', '.git'];

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root + sep) && file !== root) { res.writeHead(403).end(); return; }
    if (BLOCKED.some((b) => file.includes(sep + b + sep) || file.endsWith(sep + b))) { res.writeHead(404).end(); return; }
    const st = await stat(file);
    if (!st.isFile()) throw new Error('nem fájl');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nem található');
  }
}).listen(port, host, () => {
  console.log(`STEFY Dalszövegek: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`);
});
