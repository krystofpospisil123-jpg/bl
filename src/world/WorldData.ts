// Loads the manifest and individual chunks produced by scripts/build-chunks.ts.
import type { ChunkData, ChunkInfo, Manifest } from './format.ts';

export interface LoadedChunk {
  info: ChunkInfo;
  data: ChunkData;
  /** Elevations in metres, (n x n) row-major, row 0 = north (min z). */
  heights: Float32Array;
  /** Samples per side. */
  n: number;
}

export class WorldData {
  private cache = new Map<string, Promise<LoadedChunk>>();

  private constructor(readonly baseUrl: string, readonly manifest: Manifest) {}

  static async load(baseUrl = `${import.meta.env.BASE_URL}data/`): Promise<WorldData> {
    const res = await fetch(baseUrl + 'manifest.json');
    if (!res.ok) throw new Error(`manifest.json not found (${res.status}). Run "npm run data" first.`);
    return new WorldData(baseUrl, await res.json());
  }

  /** Decodes a height PNG (R = high byte, G = low byte) to elevations in metres. */
  async fetchHeights(url: string): Promise<Float32Array> {
    const blob = await (await fetch(url)).blob();
    // Disable colour management and premultiplication so the bytes stay exact.
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const out = new Float32Array(canvas.width * canvas.height);
    const { heightBase, heightScale } = this.manifest;
    for (let i = 0; i < out.length; i++) out[i] = heightBase + ((px[i * 4] << 8) | px[i * 4 + 1]) * heightScale;
    return out;
  }

  async loadOverview(): Promise<{ heights: Float32Array; size: number; step: number }> {
    const { file, size, step } = this.manifest.overview;
    return { heights: await this.fetchHeights(this.baseUrl + file), size, step };
  }

  chunkInfo(cx: number, cz: number): ChunkInfo | undefined {
    const n = this.manifest.chunksPerSide;
    if (cx < 0 || cz < 0 || cx >= n || cz >= n) return undefined;
    return this.manifest.chunks[cz * n + cx];
  }

  /** Chunk coordinates containing world position (x, z). */
  chunkCoordsAt(x: number, z: number): [number, number] {
    const { halfExtent, chunkSize } = this.manifest;
    return [Math.floor((x + halfExtent) / chunkSize), Math.floor((z + halfExtent) / chunkSize)];
  }

  loadChunk(cx: number, cz: number): Promise<LoadedChunk> {
    const key = `${cx},${cz}`;
    let p = this.cache.get(key);
    if (!p) {
      const info = this.chunkInfo(cx, cz);
      if (!info) return Promise.reject(new Error(`No chunk ${key}`));
      p = Promise.all([
        fetch(this.baseUrl + info.file).then((r) => r.json() as Promise<ChunkData>),
        this.fetchHeights(this.baseUrl + info.heightFile),
      ]).then(([data, heights]) => {
        return { info, data, heights, n: Math.round(Math.sqrt(heights.length)) };
      });
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
    }
    return p;
  }

  unloadChunk(cx: number, cz: number): void {
    this.cache.delete(`${cx},${cz}`);
  }
}
