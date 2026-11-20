// Terrain mesh for one chunk, with skirts that hide cracks between LOD levels.
import * as THREE from 'three';
import type { LoadedChunk } from '../WorldData.ts';

/**
 * @param step sample stride (1 = full 2 m resolution). Must divide the chunk's interval count.
 */
export function buildTerrainGeometry(chunk: LoadedChunk, minX: number, minZ: number, cellSize: number, step: number): THREE.BufferGeometry {
  const { heights: h, n } = chunk;
  const intervals = n - 1;
  const m = intervals / step + 1; // vertices per side
  const skirt = 1.5 + step * 0.6;
  const vertCount = m * m + 4 * m;
  const pos = new Float32Array(vertCount * 3);
  const nor = new Float32Array(vertCount * 3);
  const uv = new Float32Array(vertCount * 2);

  const H = (i: number, j: number) => h[Math.min(intervals, Math.max(0, j)) * n + Math.min(intervals, Math.max(0, i))];
  const writeVertex = (k: number, i: number, j: number, dy: number) => {
    // i, j in full-resolution sample units
    pos[k * 3] = minX + i * cellSize;
    pos[k * 3 + 1] = H(i, j) + dy;
    pos[k * 3 + 2] = minZ + j * cellSize;
    // Normal from central differences over the LOD stride (one-sided at chunk edges).
    const i0 = Math.max(0, i - step), i1 = Math.min(intervals, i + step);
    const j0 = Math.max(0, j - step), j1 = Math.min(intervals, j + step);
    const dx = (H(i1, j) - H(i0, j)) / ((i1 - i0) * cellSize);
    const dz = (H(i, j1) - H(i, j0)) / ((j1 - j0) * cellSize);
    const len = Math.hypot(dx, 1, dz);
    nor[k * 3] = -dx / len;
    nor[k * 3 + 1] = 1 / len;
    nor[k * 3 + 2] = -dz / len;
    uv[k * 2] = i / intervals;
    uv[k * 2 + 1] = 1 - j / intervals;
  };

  for (let jj = 0; jj < m; jj++) for (let ii = 0; ii < m; ii++) writeVertex(jj * m + ii, ii * step, jj * step, 0);
  // Skirt vertices: north, south, west, east edges, pushed down.
  const base = m * m;
  for (let t = 0; t < m; t++) {
    writeVertex(base + t, t * step, 0, -skirt);
    writeVertex(base + m + t, t * step, intervals, -skirt);
    writeVertex(base + 2 * m + t, 0, t * step, -skirt);
    writeVertex(base + 3 * m + t, intervals, t * step, -skirt);
  }

  const idx: number[] = [];
  for (let jj = 0; jj < m - 1; jj++)
    for (let ii = 0; ii < m - 1; ii++) {
      const a = jj * m + ii, b = a + 1, c = a + m, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  // Skirt strips (both windings so they are visible from either side).
  const strip = (top: (t: number) => number, bottom: (t: number) => number) => {
    for (let t = 0; t < m - 1; t++) {
      const a = top(t), b = top(t + 1), c = bottom(t), d = bottom(t + 1);
      idx.push(a, c, b, b, c, d, a, b, c, b, d, c);
    }
  };
  strip((t) => t, (t) => base + t);
  strip((t) => (m - 1) * m + t, (t) => base + m + t);
  strip((t) => t * m, (t) => base + 2 * m + t);
  strip((t) => t * m + m - 1, (t) => base + 3 * m + t);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
