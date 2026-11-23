// Reads the downloaded ČÚZK orthophoto tiles and samples colours in local coordinates.
import fs from 'node:fs/promises';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { RAW_DIR, localToSJTSK } from './config.ts';

interface Tile { xmin: number; ymin: number; xmax: number; ymax: number; w: number; h: number; data: Uint8Array }

export interface Ortho {
  /** RGB (0..255) at map coordinates (x east, y north), or null outside the image. */
  sample(x: number, y: number): [number, number, number] | null;
}

export async function loadOrtho(): Promise<Ortho | null> {
  let meta: { tiles: (Omit<Tile, 'data'> & { file: string })[] };
  try {
    meta = JSON.parse(await fs.readFile(path.join(RAW_DIR, 'ortho.json'), 'utf8'));
  } catch {
    console.warn('No orthophoto (run npm run data:ortho) – roof colours will be estimated');
    return null;
  }
  const tiles: Tile[] = [];
  for (const t of meta.tiles) {
    const img = jpeg.decode(await fs.readFile(path.join(RAW_DIR, t.file)), { useTArray: true, maxMemoryUsageInMB: 1024 });
    tiles.push({ ...t, data: img.data });
  }
  return {
    sample(x, y) {
      const [sx, sy] = localToSJTSK(x, y);
      for (const t of tiles) {
        if (sx < t.xmin || sx >= t.xmax || sy < t.ymin || sy >= t.ymax) continue;
        const px = Math.floor(((sx - t.xmin) / (t.xmax - t.xmin)) * t.w);
        const py = Math.floor(((t.ymax - sy) / (t.ymax - t.ymin)) * t.h);
        const k = (py * t.w + px) * 4;
        return [t.data[k], t.data[k + 1], t.data[k + 2]];
      }
      return null;
    },
  };
}

/**
 * Typical roof colour inside a footprint ring (map coords): samples a 1 m grid away from
 * the edges and averages the middle of the brightness range (drops shadows and glare).
 */
export function roofColour(ortho: Ortho, ring: [number, number][], inside: (p: [number, number]) => boolean): string | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const step = Math.max(0.75, Math.min(2, Math.sqrt((maxX - minX) * (maxY - minY)) / 25));
  const collect = (margin: number) => {
    const out: [number, number, number][] = [];
    for (let x = minX + step / 2; x < maxX; x += step)
      for (let y = minY + step / 2; y < maxY; y += step) {
        const p: [number, number] = [x, y];
        if (!inside(p)) continue;
        if (margin > 0 && !(inside([x + margin, y]) && inside([x - margin, y]) && inside([x, y + margin]) && inside([x, y - margin]))) continue;
        const c = ortho.sample(x, y);
        if (c) out.push(c);
      }
    return out;
  };
  let px = collect(1.2);
  if (px.length < 4) px = collect(0);
  if (px.length < 2) return null;
  px.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const lo = Math.floor(px.length * 0.35), hi = Math.max(lo + 1, Math.floor(px.length * 0.85));
  let r = 0, g = 0, b = 0;
  for (let i = lo; i < hi; i++) { r += px[i][0]; g += px[i][1]; b += px[i][2]; }
  const n = hi - lo;
  const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${hex(r / n)}${hex(g / n)}${hex(b / n)}`;
}
