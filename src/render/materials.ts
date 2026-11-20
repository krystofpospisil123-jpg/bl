// Shared materials and procedurally generated textures (no external assets).
import * as THREE from 'three';

/** Facade texture: one tile = one window bay (3.2 m wide) x one floor (3 m high). */
function makeFacadeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  // Subtle plaster noise
  for (let i = 0; i < 400; i++) {
    const v = 235 + Math.floor(Math.random() * 20);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
  }
  // Window: dark glass with a light frame and sill.
  g.fillStyle = '#d9d9d9';
  g.fillRect(17, 14, 30, 34);
  g.fillStyle = '#3b4652';
  g.fillRect(19, 16, 26, 30);
  g.fillStyle = '#56636f';
  g.fillRect(19, 16, 26, 12);
  g.fillStyle = '#d9d9d9';
  g.fillRect(31, 16, 2, 30);
  g.fillStyle = '#bdbdbd';
  g.fillRect(15, 48, 34, 3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Roof tile texture (u along the slope direction, in metres / 2). */
function makeRoofTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 8) {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, y, 64, 2);
    for (let x = (y / 8) % 2 ? 0 : 8; x < 64; x += 16) {
      g.fillStyle = 'rgba(0,0,0,0.08)';
      g.fillRect(x, y, 1, 8);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Tileable value noise used to break up flat colours in ground textures. */
export function makeNoiseCanvas(size = 128, seed = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const grid = 16;
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
      const fine = rnd();
      const val = Math.round(255 * (0.75 * n + 0.25 * fine));
      const k = (y * size + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = val;
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

export class Materials {
  readonly terrainBase = new THREE.MeshLambertMaterial({ color: 0xffffff });
  readonly walls: THREE.MeshLambertMaterial;
  readonly roofs: THREE.MeshLambertMaterial;
  readonly flatRoofs = new THREE.MeshLambertMaterial({ vertexColors: true });
  readonly trees = new THREE.MeshLambertMaterial({ vertexColors: true });
  readonly water = new THREE.MeshPhongMaterial({
    color: 0x3d6f7d, specular: 0x8899aa, shininess: 80,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  readonly bridge = new THREE.MeshLambertMaterial({ color: 0x8a8580 });
  readonly bridgeDeck = new THREE.MeshLambertMaterial({ color: 0x4a4a4c });
  readonly overview = new THREE.MeshLambertMaterial({ vertexColors: true });

  constructor() {
    this.walls = new THREE.MeshLambertMaterial({ vertexColors: true, map: makeFacadeTexture() });
    this.roofs = new THREE.MeshLambertMaterial({ vertexColors: true, map: makeRoofTexture() });
  }
}
