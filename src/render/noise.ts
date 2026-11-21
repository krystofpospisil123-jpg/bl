// Canvas helpers that work both on the main thread and inside Web Workers.
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export function createCanvas(w: number, h: number): AnyCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

/** Tileable value noise used to break up flat colours. */
export function makeNoiseCanvas(size = 128, seed = 1, grid = 16): AnyCanvas {
  const c = createCanvas(size, size);
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const img = g.createImageData(size, size);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const cells = size / grid;
  const v: number[] = [];
  for (let i = 0; i < cells * cells; i++) v.push(rnd());
  const at = (x: number, y: number) => v[((y + cells) % cells) * cells + ((x + cells) % cells)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = x / grid, fy = y / grid;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const n = (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
      const val = Math.round(255 * (0.7 * n + 0.3 * rnd()));
      const k = (y * size + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = val;
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}
