// Real geometry for the pavements along streets: raised paving with a stone kerb, dropped
// kerbs (ramps) where side roads and drives cross, and no pavement where nothing is built.
// The asphalt itself and its markings stay in the ground texture; the kerb gives the street
// its depth. Built for the chunk's own area from the full-resolution heights, shown at LOD 0.
import * as THREE from 'three';
import type { ChunkData, Polyline } from '../format.ts';
import type { HeightField } from '../HeightField.ts';

type Rect = { minX: number; minZ: number; maxX: number; maxZ: number };

/** Streets that get pavements, with the pavement width (m) per side. */
const PAVEMENT: Record<string, number> = { primary: 2.2, secondary: 2.2, tertiary: 2.0, residential: 1.8, unclassified: 1.5, living_street: 1.6 };
const KERB = 0.13; // height of the kerb above the road (m)
const STEP = 2; // sample spacing along the street (m)
const NEAR_BUILDING = 28; // no pavement where there is no building this close

const hash = (a: number, b: number) => {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

export function buildPavementGeometry(data: ChunkData, rect: Rect, heights: HeightField): THREE.BufferGeometry | null {
  // Building centres (and a rough radius) for the "is anything built here" test.
  const buildings: { x: number; z: number; r: number }[] = [];
  for (const b of data.buildings) {
    const o = b.rings[0];
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < o.length; i += 2) {
      minX = Math.min(minX, o[i]); maxX = Math.max(maxX, o[i]);
      minZ = Math.min(minZ, o[i + 1]); maxZ = Math.max(maxZ, o[i + 1]);
    }
    buildings.push({ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, r: Math.hypot(maxX - minX, maxZ - minZ) / 2 });
  }
  const builtNear = (x: number, z: number) => {
    for (const b of buildings) if (Math.hypot(b.x - x, b.z - z) - b.r < NEAR_BUILDING) return true;
    return false;
  };
  const insideBuilding = (x: number, z: number) => {
    for (const b of data.buildings) {
      const o = b.rings[0];
      let inside = false;
      for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) {
        if (o[i + 1] > z !== o[j + 1] > z && x < ((o[j] - o[i]) * (z - o[i + 1])) / (o[j + 1] - o[i + 1]) + o[i]) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  };
  // All road segments of this chunk (for crossings): [ax, az, bx, bz, halfWidth, roadId].
  const segs: number[] = [];
  for (const r of data.roads) {
    if (r.tunnel) continue;
    for (let i = 0; i + 3 < r.pts.length; i += 2) segs.push(r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3], r.w / 2, r.id);
  }
  const nearOtherRoad = (x: number, z: number, own: number, pad: number) => {
    for (let k = 0; k < segs.length; k += 6) {
      if (segs[k + 5] === own) continue;
      const ax = segs[k], az = segs[k + 1], dx = segs[k + 2] - ax, dz = segs[k + 3] - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) < segs[k + 4] + pad) return true;
    }
    return false;
  };

  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  const c = new THREE.Color();
  const quad = (a: number[], b: number[], cc: number[], d: number[], uvs: number[][], color: THREE.Color) => {
    // Two triangles a-b-c and a-c-d (a, b, c, d counter-clockwise seen from the visible side).
    for (const k of [a, b, cc, a, cc, d]) {
      pos.push(k[0], k[1], k[2]);
      col.push(color.r, color.g, color.b);
    }
    for (const i of [0, 1, 2, 0, 2, 3]) uv.push(uvs[i][0], uvs[i][1]);
  };

  const done = new Set<number>();
  for (const road of data.roads) {
    const sw = PAVEMENT[road.kind];
    if (!sw || road.bridge || road.tunnel || done.has(road.id)) continue;
    done.add(road.id);
    const p = road.pts;
    // Resample the street every STEP metres.
    const pts: { x: number; z: number; nx: number; nz: number; d: number }[] = [];
    let acc = 0, dist = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      while (acc <= len) {
        pts.push({ x: p[i] + (dx * acc) / len, z: p[i + 1] + (dz * acc) / len, nx: -dz / len, nz: dx / len, d: dist + acc });
        acc += STEP;
      }
      acc -= len;
      dist += len;
    }
    if (pts.length < 2) continue;
    for (const side of [-1, 1]) {
      const inner = road.w / 2 + 0.05, outer = inner + sw;
      // Per sample: is there a pavement here (built-up, not at a side road, not inside a building)?
      const ok = pts.map((q) => {
        const mx = q.x + q.nx * side * (inner + sw / 2), mz = q.z + q.nz * side * (inner + sw / 2);
        return builtNear(mx, mz) && !nearOtherRoad(mx, mz, road.id, 1.2) && !insideBuilding(mx, mz);
      });
      // Kerb height per sample: full, ramping down next to a gap (dropped kerb).
      const dropAt = (i: number) => {
        if (!ok[i]) return -1;
        const near = Math.min(ok[i - 1] === false || i === 0 ? 1 : 9, ok[i + 1] === false || i === pts.length - 1 ? 1 : 9, ok[i - 2] === false ? 2 : 9, ok[i + 2] === false ? 2 : 9);
        return near === 1 ? 0.18 : near === 2 ? 0.6 : 1;
      };
      const edge = (q: (typeof pts)[number], off: number, up: number) => {
        const x = q.x + q.nx * side * off, z = q.z + q.nz * side * off;
        return [x, heights.sample(x, z) + up, z];
      };
      for (let i = 0; i + 1 < pts.length; i++) {
        const f0 = dropAt(i), f1 = dropAt(i + 1);
        if (f0 < 0 || f1 < 0) continue;
        const q0 = pts[i], q1 = pts[i + 1];
        // Only the chunk's own samples, so neighbouring chunks do not duplicate the strip.
        if (q0.x < rect.minX || q0.x >= rect.maxX || q0.z < rect.minZ || q0.z >= rect.maxZ) continue;
        const h0 = KERB * f0, h1 = KERB * f1;
        const bot0 = edge(q0, inner, 0), bot1 = edge(q1, inner, 0);
        const topIn0 = edge(q0, inner, h0), topIn1 = edge(q1, inner, h1);
        const topOut0 = edge(q0, outer, h0), topOut1 = edge(q1, outer, h1);
        const lip0 = edge(q0, outer + 0.45, 0), lip1 = edge(q1, outer + 0.45, 0);
        const tone = 0.93 + hash(q0.x, q0.z) * 0.12;
        const slab = c.setRGB(0.8 * tone, 0.78 * tone, 0.74 * tone);
        const kerbTone = c.clone().setRGB(0.86, 0.85, 0.82);
        const u0 = q0.d, u1 = q1.d;
        // The side that faces the road: the winding flips with the side.
        const flip = side > 0;
        const order = (a: number[], b: number[], cc: number[], d: number[]) => (flip ? [a, b, cc, d] : [b, a, d, cc]);
        // Kerb face (from the road up to the pavement), visible from the road.
        {
          const [a, b, cc, d] = order(bot0, bot1, topIn1, topIn0);
          const uvs = flip ? [[u0, 0], [u1, 0], [u1, h1 * 2], [u0, h0 * 2]] : [[u1, 0], [u0, 0], [u0, h0 * 2], [u1, h1 * 2]];
          quad(a, b, cc, d, uvs, kerbTone);
        }
        // Pavement top.
        {
          const [a, b, cc, d] = order(topIn0, topIn1, topOut1, topOut0);
          const w = (v: number[]) => [v[0] / 2.4, v[2] / 2.4];
          const uvs = flip ? [w(topIn0), w(topIn1), w(topOut1), w(topOut0)] : [w(topIn1), w(topIn0), w(topOut0), w(topOut1)];
          quad(a, b, cc, d, uvs, slab);
        }
        // Outer bevel back down to the ground.
        {
          const [a, b, cc, d] = order(topOut0, topOut1, lip1, lip0);
          const w = (v: number[]) => [v[0] / 2.4, v[2] / 2.4];
          const uvs = flip ? [w(topOut0), w(topOut1), w(lip1), w(lip0)] : [w(topOut1), w(topOut0), w(lip0), w(lip1)];
          quad(a, b, cc, d, uvs, slab);
        }
      }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); // non-indexed: flat normals, so kerb edges stay crisp
  g.computeBoundingSphere();
  return g;
}

export type { Polyline };
