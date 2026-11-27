// Terrain elevation queries across all loaded chunks, falling back to the coarse overview.
import type { Manifest } from './format.ts';
import type { Overview } from './WorldData.ts';

export class HeightField {
  private chunks = new Map<number, Float32Array>();
  private overview?: Overview;
  private readonly per: number; // height intervals per chunk

  constructor(private m: Manifest) {
    this.per = m.chunkSize / m.heightStep;
  }

  setOverview(o: Overview) {
    this.overview = o;
  }

  setChunk(cx: number, cz: number, heights: Float32Array | undefined) {
    const key = cz * 1000 + cx;
    if (heights) this.chunks.set(key, heights);
    else this.chunks.delete(key);
  }

  /** Bilinear elevation (m a.s.l.) at world (x, z); clamps to the playable area. */
  sample(x: number, z: number): number {
    const { chunkSize, heightStep, chunksX, chunksZ } = this.m;
    const { minX, minZ } = this.m.bounds;
    const cx = Math.min(chunksX - 1, Math.max(0, Math.floor((x - minX) / chunkSize)));
    const cz = Math.min(chunksZ - 1, Math.max(0, Math.floor((z - minZ) / chunkSize)));
    const h = this.chunks.get(cz * 1000 + cx);
    if (h) {
      const n = this.per + 1;
      const fx = Math.min(this.per, Math.max(0, (x - minX - cx * chunkSize) / heightStep));
      const fz = Math.min(this.per, Math.max(0, (z - minZ - cz * chunkSize) / heightStep));
      return bilinear(h, n, fx, fz);
    }
    if (this.overview) {
      const o = this.overview;
      const fx = Math.min(o.width - 1, Math.max(0, (x - o.minX) / o.step));
      const fz = Math.min(o.height - 1, Math.max(0, (z - o.minZ) / o.step));
      return bilinear(o.heights, o.width, fx, fz, o.height);
    }
    return this.m.elevation.min;
  }
}

/** `n`: row length (and row count unless `rows` is given). */
export function bilinear(h: Float32Array, n: number, fx: number, fz: number, rows = n): number {
  const i = Math.min(n - 2, Math.floor(fx)), j = Math.min(rows - 2, Math.floor(fz));
  const tx = fx - i, tz = fz - j;
  const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
