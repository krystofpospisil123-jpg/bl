// Builds a single self-contained HTML file (code + styles + gzip-packed world data), for
// hosts that cannot serve extra files next to the page, or to open the game offline.
// Run after `vite build`:  npm run build:single  ->  dist-single/blansko.html
// `--fragment` writes page content without <html>/<head>/<body> (for hosts that add them).
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from './lib/config.ts';

const fragment = process.argv.includes('--fragment');
const dist = path.join(ROOT, 'dist');
const dataDir = path.join(ROOT, 'public/data');

async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix + e.name;
    if (e.isDirectory()) out.push(...(await listFiles(path.join(dir, e.name), rel + '/')));
    else out.push(rel);
  }
  return out.sort();
}

async function packData(): Promise<string> {
  const files = await listFiles(dataDir);
  const parts: Buffer[] = [];
  const index: Record<string, [number, number]> = {};
  let offset = 0;
  for (const f of files) {
    const buf = await fs.readFile(path.join(dataDir, f));
    index[f] = [offset, buf.length];
    parts.push(buf);
    offset += buf.length;
  }
  const indexBuf = Buffer.from(JSON.stringify(index));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(indexBuf.length);
  const raw = Buffer.concat([head, indexBuf, ...parts]);
  const gz = zlib.gzipSync(raw, { level: 9 });
  console.log(`Packed ${files.length} data files: ${(raw.length / 1e6).toFixed(1)} MB -> ${(gz.length / 1e6).toFixed(1)} MB gzip`);
  return gz.toString('base64');
}

async function main() {
  const assets = await fs.readdir(path.join(dist, 'assets'));
  const js = await fs.readFile(path.join(dist, 'assets', assets.find((a) => a.endsWith('.js'))!), 'utf8');
  const css = await fs.readFile(path.join(dist, 'assets', assets.find((a) => a.endsWith('.css'))!), 'utf8');
  if (js.includes('</script')) throw new Error('Bundle contains "</script", cannot inline it safely');
  const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').trim();
  const pack = await packData();
  const safeArea =
    '#hud{top:calc(10px + env(safe-area-inset-top,0px));left:calc(10px + env(safe-area-inset-left,0px));max-width:min(320px,calc(100vw - 40px))}' +
    'body.touch #hud{max-width:min(260px,calc(100vw - 120px))}' +
    '#attribution{padding-bottom:calc(2px + env(safe-area-inset-bottom,0px));padding-right:calc(6px + env(safe-area-inset-right,0px))}';
  const content = [
    '<title>Blansko: Open World</title>',
    `<style>${css}\n:root{color-scheme:dark}${safeArea}</style>`,
    body,
    `<script type="application/octet-stream" id="world-pack">${pack}</script>`,
    `<script type="module">${js}</script>`,
  ].join('\n');
  const out = fragment
    ? content
    : `<!doctype html>\n<html lang="cs">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no, viewport-fit=cover" />\n</head>\n<body>\n${content}\n</body>\n</html>\n`;
  await fs.mkdir(path.join(ROOT, 'dist-single'), { recursive: true });
  const file = path.join(ROOT, 'dist-single', fragment ? 'blansko-fragment.html' : 'blansko.html');
  await fs.writeFile(file, out);
  console.log(`Wrote ${path.relative(ROOT, file)} (${(out.length / 1e6).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
