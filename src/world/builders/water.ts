// Water surfaces (river ribbons, ponds) and bridge decks for one chunk.
import * as THREE from 'three';
import type { ChunkData, Polyline } from '../format.ts';
import type { HeightField } from '../HeightField.ts';

interface Rect { minX: number; minZ: number; maxX: number; maxZ: number }

const inRect = (x: number, z: number, r: Rect) => x >= r.minX && x < r.maxX && z >= r.minZ && z < r.maxZ;

/**
 * Walks a polyline in short steps and calls `emit` for every sub-segment whose midpoint
 * lies in this chunk (polylines are duplicated in neighbouring chunks).
 */
function walk(pl: Polyline, rect: Rect, maxStep: number, emit: (ax: number, az: number, bx: number, bz: number, ta: number, tb: number, seg: number) => void) {
  const p = pl.pts;
  for (let i = 0; i + 2 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / maxStep));
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps, t1 = (s + 1) / steps;
      const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      if (inRect((x0 + x1) / 2, (z0 + z1) / 2, rect)) emit(x0, z0, x1, z1, t0, t1, i / 2);
    }
  }
}

export function buildWaterGeometry(data: ChunkData, rect: Rect, heights: HeightField): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const quad = (ax: number, az: number, bx: number, bz: number, w: number, ya: number, yb: number) => {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    // Extend slightly along the direction so consecutive pieces overlap without gaps.
    const ex = (dx / len) * 0.3, ez = (dz / len) * 0.3;
    const nx = (-dz / len) * (w / 2), nz = (dx / len) * (w / 2);
    const a1 = [ax - ex + nx, ya, az - ez + nz], a2 = [ax - ex - nx, ya, az - ez - nz];
    const b1 = [bx + ex + nx, yb, bz + ez + nz], b2 = [bx + ex - nx, yb, bz + ez - nz];
    pushUp(pos, a1, b1, b2);
    pushUp(pos, a1, b2, a2);
  };
  for (const w of data.waterways) {
    if (w.tunnel) continue;
    walk(w, rect, 4, (ax, az, bx, bz) => quad(ax, az, bx, bz, w.w, heights.sample(ax, az) + 0.12, heights.sample(bx, bz) + 0.12));
  }
  // Ponds and riverbank polygons, draped per vertex.
  for (const a of data.water) {
    const contour = toVec2(a.rings[0]);
    const holes = a.rings.slice(1).map(toVec2);
    const all = contour.concat(...holes);
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      const v = (p: THREE.Vector2) => [p.x, heights.sample(p.x, p.y) + 0.1, p.y];
      pushUp(pos, v(all[i]), v(all[j]), v(all[k]));
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Bridge decks: group 0 = road surface, group 1 = concrete sides and parapets. */
export function buildBridgeGeometry(data: ChunkData, rect: Rect): THREE.BufferGeometry | null {
  const top: number[] = [];
  const side: number[] = [];
  const add = (pl: Polyline, w: number) => {
    const e = pl.elev!;
    walk(pl, rect, 6, (ax, az, bx, bz, t0, t1, seg) => {
      const ya = e[seg] + (e[seg + 1] - e[seg]) * t0 + 0.05;
      const yb = e[seg] + (e[seg + 1] - e[seg]) * t1 + 0.05;
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * (w / 2), nz = (dx / len) * (w / 2);
      const L = [ax + nx, az + nz, bx + nx, bz + nz], R = [ax - nx, az - nz, bx - nx, bz - nz];
      pushUp(top, [L[0], ya, L[1]], [L[2], yb, L[3]], [R[2], yb, R[3]]);
      pushUp(top, [L[0], ya, L[1]], [R[2], yb, R[3]], [R[0], ya, R[1]]);
      // Underside
      const d = 1.0;
      const down = [0, -1, 0];
      pushOriented(side, [L[0], ya - d, L[1]], [R[2], yb - d, R[3]], [L[2], yb - d, L[3]], down);
      pushOriented(side, [L[0], ya - d, L[1]], [R[0], ya - d, R[1]], [R[2], yb - d, R[3]], down);
      // Sides from underside up to the parapet top (0.9 m above the deck).
      for (const [s, sign] of [[L, 1], [R, -1]] as const) {
        const a0 = [s[0], ya - d, s[1]], b0 = [s[2], yb - d, s[3]], a1 = [s[0], ya + 0.9, s[1]], b1 = [s[2], yb + 0.9, s[3]];
        const want = [nx * sign, 0, nz * sign];
        pushOriented(side, a0, b0, b1, want);
        pushOriented(side, a0, b1, a1, want);
        pushOriented(side, a0, b1, b0, [-want[0], 0, -want[2]]);
        pushOriented(side, a0, a1, b1, [-want[0], 0, -want[2]]);
      }
    });
  };
  for (const r of data.roads) if (r.bridge && r.elev && !r.tunnel) add(r, r.w);
  for (const r of data.rails) if (r.bridge && r.elev) add(r, 4.5);
  if (!top.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...top, ...side], 3));
  g.addGroup(0, top.length / 3, 0);
  g.addGroup(top.length / 3, side.length / 3, 1);
  g.computeVertexNormals();
  return g;
}

function toVec2(r: number[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < r.length; i += 2) out.push(new THREE.Vector2(r[i], r[i + 1]));
  return out;
}

function pushOriented(out: number[], a: number[], b: number[], c: number[], want: number[]) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * want[0] + ny * want[1] + nz * want[2] < 0) out.push(...a, ...c, ...b);
  else out.push(...a, ...b, ...c);
}

/** Pushes a triangle oriented to face upward. */
function pushUp(out: number[], a: number[], b: number[], c: number[]) {
  pushOriented(out, a, b, c, [0, 1, 0]);
}
