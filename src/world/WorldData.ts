// Loads the manifest and individual chunks produced by scripts/build-chunks.ts.
import type { ChunkData, ChunkInfo, Manifest, RoadGraphs } from './format.ts';
import { openDataSource, type DataGet } from './DataSource.ts';

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

  private constructor(private get: DataGet, readonly manifest: Manifest) {}

  static async load(baseUrl = `${import.meta.env.BASE_URL}data/`): Promise<WorldData> {
    const get = await openDataSource(baseUrl);
    const res = await get('manifest.json');
    if (!res.ok) throw new Error(`Data města se nepodařilo načíst (manifest.json: ${res.status}).`);
    return new WorldData(get, await res.json());
  }

  /** Decodes a height PNG (R = high byte, G = low byte) to elevations in metres. */
  async fetchHeights(path: string): Promise<Float32Array> {
    const blob = await (await this.get(path)).blob();
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
    return { heights: await this.fetchHeights(file), size, step };
  }

  /** Whole-area orthophoto used under the ground cover (null if the data has none). */
  async loadGroundPhoto(): Promise<{ bitmap: ImageBitmap; step: number; half: number } | null> {
    const g = this.manifest.groundPhoto;
    if (!g) return null;
    const res = await this.get(g.file);
    if (!res.ok) return null;
    const bitmap = await createImageBitmap(await res.blob());
    return { bitmap, step: g.step, half: this.manifest.halfExtent };
  }

  /** Decodes an image from the world data (no colour conversion, so masks stay exact). */
  async loadImage(path: string): Promise<ImageBitmap> {
    const res = await this.get(path);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  }

  /** Cars and pedestrians made in Blender (GLB). */
  async loadModelsFile(): Promise<ArrayBuffer> {
    const res = await this.get('models/vehicles.glb');
    if (!res.ok) throw new Error(`models/vehicles.glb: ${res.status}`);
    return res.arrayBuffer();
  }

  async loadGraphs(): Promise<RoadGraphs> {
    const res = await this.get(this.manifest.graphFile ?? 'roads.json');
    if (!res.ok) throw new Error(`roads.json not found (${res.status}). Run "npm run data:build".`);
    return res.json();
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
        this.get(info.file).then((r) => r.json() as Promise<ChunkData>),
        this.fetchHeights(info.heightFile),
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
