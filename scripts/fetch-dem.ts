// Downloads the ČÚZK DMR 5G digital terrain model (bare earth, 2 m grid) for the
// Blansko area via the public ArcGIS ImageServer and resamples it to the local grid.
//
// Output: data/raw/dem.tif (as served, S-JTSK) and data/raw/dem_local.json/.bin
// (Float32 heights in metres, local grid, row 0 = north edge).
//
// Manual fallback: download DMR 5G tiles for Blansko from https://ags.cuzk.gov.cz
// (or the ČÚZK geoportal), export a GeoTIFF in EPSG:5514 covering the area and save it
// as data/raw/dem.tif, then run `npm run data:dem -- --skip-download`.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fromArrayBuffer } from 'geotiff';
import { RAW_DIR, HALF_EXTENT, FETCH_MARGIN, HEIGHT_STEP, localToSJTSK } from './lib/config.ts';
import { fetchWithRetry } from './lib/http.ts';

const SERVICE = 'https://ags.cuzk.gov.cz/arcgis2/rest/services/dmr5g/ImageServer/exportImage';
const SOURCE_RES = 2; // metres per pixel requested from the service

async function download(tifPath: string) {
  const r = HALF_EXTENT + FETCH_MARGIN;
  const pts = [
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r],
  ].map(([x, y]) => localToSJTSK(x, y));
  const pad = 20;
  const xmin = Math.floor(Math.min(...pts.map((p) => p[0])) - pad);
  const xmax = Math.ceil(Math.max(...pts.map((p) => p[0])) + pad);
  const ymin = Math.floor(Math.min(...pts.map((p) => p[1])) - pad);
  const ymax = Math.ceil(Math.max(...pts.map((p) => p[1])) + pad);
  const w = Math.round((xmax - xmin) / SOURCE_RES);
  const h = Math.round((ymax - ymin) / SOURCE_RES);

  const params = new URLSearchParams({
    bbox: `${xmin},${ymin},${xmax},${ymax}`,
    bboxSR: '5514',
    imageSR: '5514',
    size: `${w},${h}`,
    format: 'tiff',
    pixelType: 'F32',
    noData: '-9999',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });
  console.log(`Requesting DMR 5G ${w}x${h} px, S-JTSK bbox ${xmin},${ymin},${xmax},${ymax}`);
  const res = await fetchWithRetry(`${SERVICE}?${params}`, {}, { timeoutMs: 300_000 });
  const ct = res.headers.get('content-type') ?? '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (!ct.includes('tif') && buf.subarray(0, 2).toString() !== 'II' && buf.subarray(0, 2).toString() !== 'MM') {
    throw new Error(`Unexpected response (${ct}): ${buf.subarray(0, 300).toString()}`);
  }
  await fs.writeFile(tifPath, buf);
  // The TIFF from exportImage may lack georeferencing tags, so store the bbox alongside.
  await fs.writeFile(tifPath + '.json', JSON.stringify({ xmin, ymin, xmax, ymax, width: w, height: h }, null, 2));
  console.log(`Saved ${(buf.length / 1e6).toFixed(1)} MB to ${path.relative(process.cwd(), tifPath)}`);
}

async function resample(tifPath: string) {
  const tiff = await fromArrayBuffer((await fs.readFile(tifPath)).buffer as ArrayBuffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const [raster] = (await image.readRasters()) as unknown as Float32Array[];

  // Prefer the GeoTIFF georeferencing; fall back to the bbox sidecar.
  let xmin: number, ymax: number, resX: number, resY: number;
  try {
    const [ox, oy] = image.getOrigin();
    const [rx, ry] = image.getResolution();
    xmin = ox;
    ymax = oy;
    resX = rx;
    resY = -ry;
  } catch {
    const meta = JSON.parse(await fs.readFile(tifPath + '.json', 'utf8'));
    xmin = meta.xmin;
    ymax = meta.ymax;
    resX = (meta.xmax - meta.xmin) / width;
    resY = (meta.ymax - meta.ymin) / height;
  }

  const sample = (sx: number, sy: number): number => {
    const fx = (sx - xmin) / resX - 0.5;
    const fy = (ymax - sy) / resY - 0.5;
    const x0 = Math.max(0, Math.min(width - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(height - 2, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - x0));
    const ty = Math.min(1, Math.max(0, fy - y0));
    const i = y0 * width + x0;
    const a = raster[i], b = raster[i + 1], c = raster[i + width], d = raster[i + width + 1];
    if (a < -1000 || b < -1000 || c < -1000 || d < -1000) return NaN;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };

  // Local grid covering exactly the playable area (edges included).
  const n = Math.round((2 * HALF_EXTENT) / HEIGHT_STEP) + 1;
  const out = new Float32Array(n * n);
  let min = Infinity, max = -Infinity, missing = 0;
  for (let row = 0; row < n; row++) {
    const y = HALF_EXTENT - row * HEIGHT_STEP; // north -> south
    for (let col = 0; col < n; col++) {
      const x = -HALF_EXTENT + col * HEIGHT_STEP;
      const [sx, sy] = localToSJTSK(x, y);
      let h = sample(sx, sy);
      if (!Number.isFinite(h)) {
        missing++;
        h = 0;
      }
      out[row * n + col] = h;
      if (h !== 0) {
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    }
  }
  if (missing) console.warn(`  ${missing} samples had no data`);
  await fs.writeFile(path.join(RAW_DIR, 'dem_local.bin'), Buffer.from(out.buffer));
  await fs.writeFile(
    path.join(RAW_DIR, 'dem_local.json'),
    JSON.stringify({ size: n, step: HEIGHT_STEP, halfExtent: HALF_EXTENT, min, max, missing }, null, 2),
  );
  console.log(`Local DEM ${n}x${n} @ ${HEIGHT_STEP} m, elevation ${min.toFixed(1)}–${max.toFixed(1)} m a.s.l.`);
}

async function main() {
  await fs.mkdir(RAW_DIR, { recursive: true });
  const tifPath = path.join(RAW_DIR, 'dem.tif');
  if (!process.argv.includes('--skip-download')) await download(tifPath);
  await resample(tifPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
