// Web Worker: paints chunk ground textures off the main thread and returns ImageBitmaps.
import { paintGround } from './builders/groundTexture.ts';
import type { ChunkData } from './format.ts';

interface Job {
  id: number;
  data: ChunkData;
  minX: number;
  minZ: number;
  chunkSize: number;
  size: number;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const j = e.data;
  const canvas = paintGround(j.data, j.minX, j.minZ, j.chunkSize, j.size) as OffscreenCanvas;
  const bitmap = canvas.transferToImageBitmap();
  (self as unknown as Worker).postMessage({ id: j.id, bitmap }, [bitmap]);
};
