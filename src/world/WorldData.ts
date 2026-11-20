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

  decodeHeights(buf: ArrayBuffer): Float32Array {
    const raw = new Uint16Array(buf);
    const out = new Float32Array(raw.length);
    const { heightBase, heightScale } = this.manifest;
    for (let i = 0; i < raw.length; i++) out[i] = heightBase + raw[i] * heightScale;
    return out;
  }

  async loadOverview(): Promise<{ heights: Float32Array; size: number; step: number }> {
    const { file, size, step } = this.manifest.overview;
    const buf = await (await fetch(this.baseUrl + file)).arrayBuffer();
    return { heights: this.decodeHeights(buf), size, step };
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
        fetch(this.baseUrl + info.heightFile).then((r) => r.arrayBuffer()),
      ]).then(([data, hbuf]) => {
        const heights = this.decodeHeights(hbuf);
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
