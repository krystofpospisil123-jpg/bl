// Downloads the ČÚZK DMR 5G digital terrain model (bare earth, 2 m grid) for the
// Blansko area via the public ArcGIS ImageServer and resamples it to the local grid.
//
// Output: data/raw/dem_*.tif tiles (as served, S-JTSK) and data/raw/dem_local.json/.bin
// (Float32 heights in metres, local grid, row 0 = north edge).
//
// Manual fallback: download DMR 5G tiles for Blansko from https://ags.cuzk.gov.cz
// (or the ČÚZK geoportal), export a GeoTIFF in EPSG:5514 covering the area and save it
// as data/raw/dem.tif, then run `npm run data:dem -- --skip-download`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fromArrayBuffer } from 'geotiff';
import { RAW_DIR, BOUNDS, HEIGHT_STEP, localToSJTSK, boundsSJTSK } from './lib/config.ts';
import { fetchWithRetry } from './lib/http.ts';

const SERVICE = 'https://ags.cuzk.gov.cz/arcgis2/rest/services/dmr5g/ImageServer/exportImage';
const SOURCE_RES = 2; // metres per pixel requested from the service
const MAX_PX = 2000; // tiles of 4 km (larger requests fail on the service)

interface TileMeta { file: string; xmin: number; ymin: number; xmax: number; ymax: number; width: number; height: number }

/** Downloads the area as a grid of GeoTIFF tiles (S-JTSK), listed in dem_tiles.json. */
async function download(): Promise<TileMeta[]> {
  const e = boundsSJTSK(BOUNDS, 150);
  const pad = 20;
  const xmin = e.xmin - pad, xmax = e.xmax + pad, ymin = e.ymin - pad, ymax = e.ymax + pad;
  const span = MAX_PX * SOURCE_RES;
  const nx = Math.ceil((xmax - xmin) / span), ny = Math.ceil((ymax - ymin) / span);
  const tiles: TileMeta[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const t = { xmin: xmin + i * span, ymin: ymin + j * span, xmax: Math.min(xmax, xmin + (i + 1) * span), ymax: Math.min(ymax, ymin + (j + 1) * span) };
      // Overlap neighbours by a few pixels so bilinear sampling never falls between tiles.
      t.xmin -= 8; t.ymin -= 8; t.xmax += 8; t.ymax += 8;
      const width = Math.round((t.xmax - t.xmin) / SOURCE_RES), height = Math.round((t.ymax - t.ymin) / SOURCE_RES);
      const params = new URLSearchParams({
        bbox: `${t.xmin},${t.ymin},${t.xmax},${t.ymax}`,
        bboxSR: '5514',
        imageSR: '5514',
        size: `${width},${height}`,
        format: 'tiff',
        pixelType: 'F32',
        noData: '-9999',
        interpolation: 'RSP_BilinearInterpolation',
        f: 'image',
      });
      const file = `dem_${i}_${j}.tif`;
      console.log(`Requesting DMR 5G tile ${file} ${width}x${height} px`);
      const res = await fetchWithRetry(`${SERVICE}?${params}`, {}, { timeoutMs: 600_000 });
      const ct = res.headers.get('content-type') ?? '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (!ct.includes('tif') && buf.subarray(0, 2).toString() !== 'II' && buf.subarray(0, 2).toString() !== 'MM') {
        throw new Error(`Unexpected response (${ct}): ${buf.subarray(0, 300).toString()}`);
      }
      await fs.writeFile(path.join(RAW_DIR, file), buf);
      tiles.push({ file, ...t, width, height });
    }
  await fs.writeFile(path.join(RAW_DIR, 'dem_tiles.json'), JSON.stringify(tiles, null, 1));
  return tiles;
}

async function resample(tiles: TileMeta[]) {
  const rasters: { t: TileMeta; r: Float32Array }[] = [];
  for (const t of tiles) {
    const tiff = await fromArrayBuffer((await fs.readFile(path.join(RAW_DIR, t.file))).buffer as ArrayBuffer);
    const image = await tiff.getImage();
    const [r] = (await image.readRasters()) as unknown as Float32Array[];
    rasters.push({ t: { ...t, width: image.getWidth(), height: image.getHeight() }, r });
  }
  const sample = (sx: number, sy: number): number => {
    for (const { t, r } of rasters) {
      const resX = (t.xmax - t.xmin) / t.width, resY = (t.ymax - t.ymin) / t.height;
      const fx = (sx - t.xmin) / resX - 0.5, fy = (t.ymax - sy) / resY - 0.5;
      if (fx < 0 || fy < 0 || fx > t.width - 2 || fy > t.height - 2) continue;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const i = y0 * t.width + x0;
      const a = r[i], b = r[i + 1], c = r[i + t.width], d = r[i + t.width + 1];
      if (a < -1000 || b < -1000 || c < -1000 || d < -1000) continue;
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
    return NaN;
  };

  // Local grid covering exactly the playable area (edges included), row 0 = north edge.
  const w = Math.round((BOUNDS.maxX - BOUNDS.minX) / HEIGHT_STEP) + 1;
  const h = Math.round((BOUNDS.maxY - BOUNDS.minY) / HEIGHT_STEP) + 1;
  const out = new Float32Array(w * h);
  let min = Infinity, max = -Infinity, missing = 0;
  for (let row = 0; row < h; row++) {
    const y = BOUNDS.maxY - row * HEIGHT_STEP;
    for (let col = 0; col < w; col++) {
      const x = BOUNDS.minX + col * HEIGHT_STEP;
      const [sx, sy] = localToSJTSK(x, y);
      let v = sample(sx, sy);
      if (!Number.isFinite(v)) { missing++; v = 0; }
      out[row * w + col] = v;
      if (v !== 0) { min = Math.min(min, v); max = Math.max(max, v); }
    }
  }
  if (missing) console.warn(`  ${missing} samples had no data`);
  await fs.writeFile(path.join(RAW_DIR, 'dem_local.bin'), Buffer.from(out.buffer));
  await fs.writeFile(
    path.join(RAW_DIR, 'dem_local.json'),
    JSON.stringify({ width: w, height: h, step: HEIGHT_STEP, bounds: BOUNDS, min, max, missing }, null, 2),
  );
  console.log(`Local DEM ${w}x${h} @ ${HEIGHT_STEP} m, elevation ${min.toFixed(1)}–${max.toFixed(1)} m a.s.l.`);
}

async function main() {
  await fs.mkdir(RAW_DIR, { recursive: true });
  const tiles = process.argv.includes('--skip-download')
    ? JSON.parse(await fs.readFile(path.join(RAW_DIR, 'dem_tiles.json'), 'utf8'))
    : await download();
  await resample(tiles);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
