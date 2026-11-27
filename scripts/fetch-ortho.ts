// Downloads the ČÚZK orthophoto (aerial image, CC BY 4.0) for the area at 0.5 m/px, used to
// give every building its real roof colour. Output: data/raw/ortho_*.jpg + ortho.json (S-JTSK
// extents of each tile). Not shipped with the game, only sampled by build-chunks.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RAW_DIR, HALF_EXTENT, FETCH_MARGIN, BOUNDS, localToSJTSK, boundsSJTSK } from './lib/config.ts';
import { fetchWithRetry } from './lib/http.ts';

const SERVICE = 'https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO/MapServer/export';
const RES = 0.5;
const TILES = 2; // per side; each tile stays under the 4096 px service limit

/**
 * `--coarse`: the whole (enlarged) area at 2 m/px, appended after the detailed tiles of the
 * Blansko square (which keep priority where they overlap).
 */
async function coarse() {
  const RES2 = 2, MAX = 4000;
  const e = boundsSJTSK(BOUNDS, 30);
  const nx = Math.ceil((e.xmax - e.xmin) / (MAX * RES2)), ny = Math.ceil((e.ymax - e.ymin) / (MAX * RES2));
  const tw = (e.xmax - e.xmin) / nx, th = (e.ymax - e.ymin) / ny;
  const meta = JSON.parse(await fs.readFile(path.join(RAW_DIR, 'ortho.json'), 'utf8'));
  meta.tiles = meta.tiles.filter((t: { file: string }) => !t.file.startsWith('orthoc_'));
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const t = { xmin: e.xmin + i * tw, xmax: e.xmin + (i + 1) * tw, ymin: e.ymin + j * th, ymax: e.ymin + (j + 1) * th };
      const w = Math.round(tw / RES2), h = Math.round(th / RES2);
      const params = new URLSearchParams({
        bbox: `${t.xmin},${t.ymin},${t.xmax},${t.ymax}`, bboxSR: '5514', imageSR: '5514',
        size: `${w},${h}`, format: 'jpg', transparent: 'false', f: 'image',
      });
      const file = `orthoc_${i}_${j}.jpg`;
      console.log(`Downloading ${file} (${w}x${h})`);
      const res = await fetchWithRetry(`${SERVICE}?${params}`, {}, { timeoutMs: 300_000 });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error(`Not a JPEG: ${buf.subarray(0, 200).toString()}`);
      await fs.writeFile(path.join(RAW_DIR, file), buf);
      meta.tiles.push({ file, ...t, w, h });
    }
  await fs.writeFile(path.join(RAW_DIR, 'ortho.json'), JSON.stringify(meta, null, 1));
  console.log('Done');
}

async function main() {
  if (process.argv.includes('--coarse')) return coarse();
  const r = HALF_EXTENT + 20;
  const pts = [[-r, -r], [r, -r], [r, r], [-r, r]].map(([x, y]) => localToSJTSK(x, y));
  const xmin = Math.floor(Math.min(...pts.map((p) => p[0]))), xmax = Math.ceil(Math.max(...pts.map((p) => p[0])));
  const ymin = Math.floor(Math.min(...pts.map((p) => p[1]))), ymax = Math.ceil(Math.max(...pts.map((p) => p[1])));
  const tw = (xmax - xmin) / TILES, th = (ymax - ymin) / TILES;
  const tiles: { file: string; xmin: number; ymin: number; xmax: number; ymax: number; w: number; h: number }[] = [];
  for (let j = 0; j < TILES; j++)
    for (let i = 0; i < TILES; i++) {
      const t = { xmin: xmin + i * tw, xmax: xmin + (i + 1) * tw, ymin: ymin + j * th, ymax: ymin + (j + 1) * th };
      const w = Math.round(tw / RES), h = Math.round(th / RES);
      const params = new URLSearchParams({
        bbox: `${t.xmin},${t.ymin},${t.xmax},${t.ymax}`, bboxSR: '5514', imageSR: '5514',
        size: `${w},${h}`, format: 'jpg', transparent: 'false', f: 'image',
      });
      const file = `ortho_${i}_${j}.jpg`;
      console.log(`Downloading ${file} (${w}x${h})`);
      const res = await fetchWithRetry(`${SERVICE}?${params}`, {}, { timeoutMs: 300_000 });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error(`Not a JPEG: ${buf.subarray(0, 200).toString()}`);
      await fs.writeFile(path.join(RAW_DIR, file), buf);
      tiles.push({ file, ...t, w, h });
    }
  await fs.writeFile(path.join(RAW_DIR, 'ortho.json'), JSON.stringify({ res: RES, tiles }, null, 1));
  void FETCH_MARGIN;
  console.log('Done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
