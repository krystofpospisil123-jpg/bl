// Dev tool: renders an orthophoto crop (game coords x0 z0 x1 z1) with a 20 m grid, for placing scenes.
// npx tsx scripts/dev/ortho-crop.ts -160 60 100 300 out.jpg
import { loadOrtho } from '../lib/ortho.ts';
import jpeg from 'jpeg-js';
import fs from 'node:fs';
const [x0, z0, x1, z1] = process.argv.slice(2, 6).map(Number); // game coords (z = south)
const res = Number(process.env.RES ?? 0.5);
const grid = Number(process.env.GRID ?? 20);
const o = (await loadOrtho())!;
const w = Math.round((x1 - x0) / res), h = Math.round((z1 - z0) / res);
const img = Buffer.alloc(w * h * 4);
for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
  const x = x0 + i * res, z = z0 + j * res;
  const c = o.sample(x, -z) ?? [0, 0, 0];
  const k = (j * w + i) * 4;
  img[k] = c[0]; img[k + 1] = c[1]; img[k + 2] = c[2]; img[k + 3] = 255;
}
// Grid every 20 m with labels as thin lines
for (let gx = Math.ceil(x0 / grid) * grid; gx < x1; gx += grid) { const i = Math.round((gx - x0) / res); for (let j = 0; j < h; j += 2) { const k = (j * w + i) * 4; img[k] = 255; img[k + 1] = 255; img[k + 2] = 0; } }
for (let gz = Math.ceil(z0 / grid) * grid; gz < z1; gz += grid) { const j = Math.round((gz - z0) / res); for (let i = 0; i < w; i += 2) { const k = (j * w + i) * 4; img[k] = 255; img[k + 1] = 255; img[k + 2] = 0; } }
fs.writeFileSync(process.argv[6], jpeg.encode({ data: img, width: w, height: h }, 85).data);
console.log(w, h);
