// Main-thread client for the ground texture worker (falls back to painting inline).
import * as THREE from 'three';
import type { ChunkData } from './format.ts';
import { paintGround } from './builders/groundTexture.ts';
import GroundWorker from './groundWorker.ts?worker&inline';

export class GroundPainter {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, (t: THREE.Texture) => void>();

  constructor() {
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        this.worker = new GroundWorker();
        this.worker.onmessage = (e: MessageEvent<{ id: number; bitmap: ImageBitmap }>) => {
          const done = this.pending.get(e.data.id);
          this.pending.delete(e.data.id);
          done?.(makeTexture(e.data.bitmap));
        };
        this.worker.onerror = () => {
          // Worker unavailable (e.g. blocked): paint on the main thread from now on.
          this.worker?.terminate();
          this.worker = null;
        };
      }
    } catch {
      this.worker = null;
    }
  }

  /** Texture rows run north to south, so terrain UVs use v = 0 at the chunk's min z. */
  paint(data: ChunkData, minX: number, minZ: number, chunkSize: number, size: number): Promise<THREE.Texture> {
    if (!this.worker) {
      return Promise.resolve(makeTexture(paintGround(data, minX, minZ, chunkSize, size) as HTMLCanvasElement));
    }
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker!.postMessage({ id, data, minX, minZ, chunkSize, size });
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
  return tex;
}
