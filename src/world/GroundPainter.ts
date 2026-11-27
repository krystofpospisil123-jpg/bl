// Main-thread client for the ground texture worker (falls back to painting inline).
// Only the newest request per chunk is kept; older and cancelled requests resolve to null
// right away, so nothing keeps unloaded chunks alive while the worker is busy.
import * as THREE from 'three';
import type { ChunkData } from './format.ts';
import { paintGround } from './builders/groundTexture.ts';
import GroundWorker from './groundWorker.ts?worker&inline';

type Done = (t: THREE.Texture | null) => void;

export class GroundPainter {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Done>();
  private latestByKey = new Map<string, number>();
  /** Whole-area orthophoto (north-up) and its metres per pixel / half extent. */
  private photo?: { bitmap: ImageBitmap; step: number; minX: number; minZ: number };

  setPhoto(bitmap: ImageBitmap, step: number, minX: number, minZ: number) {
    this.photo = { bitmap, step, minX, minZ };
  }

  /** Crops the photo patch for a chunk with a 2-pixel margin for seamless filtering. */
  private async photoPatch(minX: number, minZ: number, chunkSize: number): Promise<{ img?: ImageBitmap; margin: number }> {
    if (!this.photo) return { margin: 0 };
    const { bitmap, step } = this.photo;
    const m = 2;
    const sx = Math.round((minX - this.photo.minX) / step) - m, sy = Math.round((minZ - this.photo.minZ) / step) - m;
    const sw = Math.round(chunkSize / step) + 2 * m;
    try {
      return { img: await createImageBitmap(bitmap, sx, sy, sw, sw), margin: m * step };
    } catch {
      return { margin: 0 };
    }
  }

  constructor() {
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        this.worker = new GroundWorker();
        this.worker.onmessage = (e: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>) => {
          const done = this.pending.get(e.data.id);
          this.pending.delete(e.data.id);
          if (!done) {
            e.data.bitmap?.close();
            return;
          }
          done(e.data.bitmap ? makeTexture(e.data.bitmap) : null);
        };
        this.worker.onerror = () => this.disableWorker();
      }
    } catch {
      this.worker = null;
    }
  }

  private disableWorker() {
    // Worker unavailable (e.g. blocked): fail pending jobs (they are re-requested) and paint inline.
    this.worker?.terminate();
    this.worker = null;
    for (const done of this.pending.values()) done(null);
    this.pending.clear();
    this.latestByKey.clear();
  }

  /** Cancels any outstanding request for a chunk (e.g. when it is unloaded). */
  cancel(key: string) {
    const id = this.latestByKey.get(key);
    if (id === undefined) return;
    this.latestByKey.delete(key);
    const done = this.pending.get(id);
    if (done) {
      this.pending.delete(id);
      this.worker?.postMessage({ cancel: id });
      done(null);
    }
  }

  /**
   * Resolves to the painted texture, or null if the request was superseded or failed.
   * Texture rows run north to south, so terrain UVs use v = 0 at the chunk's min z.
   */
  paint(key: string, data: ChunkData, minX: number, minZ: number, chunkSize: number, size: number): Promise<THREE.Texture | null> {
    this.cancel(key);
    const id = this.nextId++;
    this.latestByKey.set(key, id);
    return new Promise((resolve) => {
      this.pending.set(id, (t) => {
        if (this.latestByKey.get(key) === id) this.latestByKey.delete(key);
        resolve(t);
      });
      this.photoPatch(minX, minZ, chunkSize).then(({ img, margin }) => {
        if (!this.pending.has(id)) {
          img?.close(); // cancelled meanwhile
          return;
        }
        if (!this.worker) {
          const done = this.pending.get(id)!;
          this.pending.delete(id);
          done(makeTexture(paintGround(data, minX, minZ, chunkSize, size, img, margin) as HTMLCanvasElement));
          img?.close();
          return;
        }
        const job = { id, data, minX, minZ, chunkSize, size, photo: img, photoMargin: margin };
        this.worker.postMessage({ job }, img ? [img] : []);
      });
    });
  }
}

function makeTexture(img: ImageBitmap | HTMLCanvasElement): THREE.Texture {
  const tex = img instanceof HTMLCanvasElement ? new THREE.CanvasTexture(img) : new THREE.Texture(img);
  tex.flipY = false; // ImageBitmaps cannot be flipped on upload; canvases match that here
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  // Free the bitmap's memory together with the texture.
  if (!(img instanceof HTMLCanvasElement)) tex.addEventListener('dispose', () => img.close());
  return tex;
}
