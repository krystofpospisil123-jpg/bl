// Terrain elevation queries across all loaded chunks, falling back to the coarse overview.
import type { Manifest } from './format.ts';

export class HeightField {
  private chunks = new Map<number, Float32Array>();
  private overview?: { heights: Float32Array; size: number; step: number };
  private readonly per: number; // height intervals per chunk

  constructor(private m: Manifest) {
    this.per = m.chunkSize / m.heightStep;
  }

  setOverview(o: { heights: Float32Array; size: number; step: number }) {
    this.overview = o;
  }

  setChunk(cx: number, cz: number, heights: Float32Array | undefined) {
    const key = cz * 1000 + cx;
    if (heights) this.chunks.set(key, heights);
    else this.chunks.delete(key);
  }

  /** Bilinear elevation (m a.s.l.) at world (x, z); clamps to the playable area. */
  sample(x: number, z: number): number {
    const { halfExtent: H, chunkSize, heightStep, chunksPerSide } = this.m;
    const cx = Math.min(chunksPerSide - 1, Math.max(0, Math.floor((x + H) / chunkSize)));
    const cz = Math.min(chunksPerSide - 1, Math.max(0, Math.floor((z + H) / chunkSize)));
    const h = this.chunks.get(cz * 1000 + cx);
    if (h) {
      const n = this.per + 1;
      const fx = Math.min(this.per, Math.max(0, (x + H - cx * chunkSize) / heightStep));
      const fz = Math.min(this.per, Math.max(0, (z + H - cz * chunkSize) / heightStep));
      return bilinear(h, n, fx, fz);
    }
    if (this.overview) {
      const o = this.overview;
      const fx = Math.min(o.size - 1, Math.max(0, (x + H) / o.step));
      const fz = Math.min(o.size - 1, Math.max(0, (z + H) / o.step));
      return bilinear(o.heights, o.size, fx, fz);
    }
    return this.m.elevation.min;
  }
}

export function bilinear(h: Float32Array, n: number, fx: number, fz: number): number {
  const i = Math.min(n - 2, Math.floor(fx)), j = Math.min(n - 2, Math.floor(fz));
  const tx = fx - i, tz = fz - j;
  const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
