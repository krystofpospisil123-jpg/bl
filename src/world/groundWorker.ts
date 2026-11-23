// Web Worker: paints chunk ground textures off the main thread and returns ImageBitmaps.
// Jobs are queued so that cancelled (stale) jobs can be skipped before they are painted.
import { paintGround } from './builders/groundTexture.ts';
import type { ChunkData } from './format.ts';

interface Job {
  id: number;
  data: ChunkData;
  minX: number;
  minZ: number;
  chunkSize: number;
  size: number;
  photo?: ImageBitmap;
  photoMargin?: number;
}
type Msg = { job: Job } | { cancel: number };

const queue: Job[] = [];
let scheduled = false;

function run() {
  scheduled = false;
  const j = queue.shift();
  if (!j) return;
  try {
    const canvas = paintGround(j.data, j.minX, j.minZ, j.chunkSize, j.size, j.photo, j.photoMargin) as OffscreenCanvas;
    j.photo?.close();
    const bitmap = canvas.transferToImageBitmap();
    (self as unknown as Worker).postMessage({ id: j.id, bitmap }, [bitmap]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: j.id, error: String(err) });
  }
  schedule();
}

function schedule() {
  if (!scheduled && queue.length) {
    scheduled = true;
    setTimeout(run, 0);
  }
}

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if ('cancel' in m) {
    const i = queue.findIndex((j) => j.id === m.cancel);
    if (i >= 0) queue.splice(i, 1)[0].photo?.close();
    return;
  }
  queue.push(m.job);
  schedule();
};
