// Street furniture and parked cars for one chunk, all instanced:
//  - hand-placed scene props (see world/scenes.ts),
//  - benches and bins along pedestrian squares,
//  - parked cars filling OSM parking areas (with collision boxes),
//  - shrubs along residential buildings.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ChunkData } from '../format.ts';
import type { HeightField } from '../HeightField.ts';
import type { PropKind, PropSpot } from '../scenes.ts';
import { bakeCarGeometries, CAR_COLORS } from '../../vehicle/CarModel.ts';

type Rect = { minX: number; minZ: number; maxX: number; maxZ: number };
type GeoKind = PropKind | 'shrub';

function coloured(g: THREE.BufferGeometry, hex: number | ((i: number) => number)): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    // Same colour per triangle so flower dots stay crisp.
    c.setHex(typeof hex === 'number' ? hex : hex(Math.floor(i / 3)));
    arr.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function rnd(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

let library: Record<GeoKind, THREE.BufferGeometry> | null = null;

function makeLibrary(): Record<GeoKind, THREE.BufferGeometry> {
  const wood = 0x8a5a36, metal = 0x2f3234;
  const bench = mergeGeometries([
    ...[0, 1, 2, 3].map((i) => coloured(new THREE.BoxGeometry(1.8, 0.04, 0.09).translate(0, 0.45, -0.18 + i * 0.12), wood)),
    ...[0, 1, 2].map((i) => coloured(new THREE.BoxGeometry(1.8, 0.09, 0.04).translate(0, 0.62 + i * 0.12, -0.27).rotateX(0), wood)),
    ...[-0.75, 0.75].flatMap((x) => [
      coloured(new THREE.BoxGeometry(0.06, 0.45, 0.45).translate(x, 0.22, 0), metal),
      coloured(new THREE.BoxGeometry(0.06, 0.45, 0.05).translate(x, 0.67, -0.27), metal),
    ]),
  ])!;
  const bollard = mergeGeometries([
    coloured(new THREE.CylinderGeometry(0.09, 0.1, 0.9, 10).translate(0, 0.45, 0), 0x1e1f21),
    coloured(new THREE.CylinderGeometry(0.095, 0.095, 0.06, 10).translate(0, 0.78, 0), 0xb8bcbf),
  ])!;
  const flowers = [0xd23a6a, 0xf05c8a, 0xffffff, 0xe8457a, 0x6aa84f, 0x4f8a3a, 0xf7c6d6, 0xc21f4b];
  const r = rnd(7);
  const pyramid = mergeGeometries([
    coloured(new THREE.CylinderGeometry(0.75, 0.8, 0.35, 12).translate(0, 0.17, 0), 0x6d6a66),
    coloured(new THREE.ConeGeometry(0.72, 2.3, 14, 10).translate(0, 1.5, 0), () => flowers[Math.floor(r() * flowers.length)]),
  ])!;
  const planter = mergeGeometries([
    coloured(new THREE.CylinderGeometry(1, 1, 0.45, 32, 1, true).translate(0, 0.22, 0), 0xa8a39a),
    coloured(new THREE.CylinderGeometry(0.97, 0.97, 0.38, 32).translate(0, 0.2, 0), (i) => (i % 7 === 0 ? 0x86b85c : 0x4f7a34)),
  ])!;
  const jet = new THREE.CylinderGeometry(0.03, 0.07, 1, 6, 1, true).translate(0, 0.5, 0);
  const bin = mergeGeometries([
    coloured(new THREE.CylinderGeometry(0.25, 0.22, 0.85, 10).translate(0, 0.43, 0), 0x33483a),
    coloured(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 10).translate(0, 0.87, 0), 0x222222),
  ])!;
  const r2 = rnd(11);
  const shrub = coloured(new THREE.IcosahedronGeometry(0.75, 1).scale(1.2, 0.75, 1).translate(0, 0.5, 0), () => [0x3f6b2c, 0x4a7a33, 0x36602a, 0x56853a][Math.floor(r2() * 4)]);
  for (const g of [bench, bollard, pyramid, planter, bin, shrub]) g.computeVertexNormals();
  return { bench, bollard, pyramid, planter, jet, bin, shrub };
}

let carGeo: { paint: THREE.BufferGeometry; detail: THREE.BufferGeometry } | null = null;

export interface PropMaterials {
  props: THREE.Material;
  jets: THREE.Material;
  parkedCars: THREE.Material;
}

export interface ChunkProps {
  group: THREE.Group;
  /** Collision boxes, flat [x, y, z, yaw, hx, hy, hz, ...]. */
  boxes: number[];
  dispose(): void;
}

function pointInRing(x: number, z: number, r: number[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (x: number, z: number, rings: number[][]) => pointInRing(x, z, rings[0]) && !rings.slice(1).some((h) => pointInRing(x, z, h));

function hash(a: number, b: number) {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/** Perpendicular parking slots (2.5 x 5 m) aligned with the area's longest edge. */
function parkingSlots(rings: number[][], out: { x: number; z: number; yaw: number }[]) {
  const r = rings[0];
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    const l = Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]);
    if (l > best) { best = l; ux = (r[j] - r[i]) / l; uz = (r[j + 1] - r[i + 1]) / l; }
  }
  const vx = -uz, vz = ux;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    const u = r[i] * ux + r[i + 1] * uz, v = r[i] * vx + r[i + 1] * vz;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  // Rows: two rows of cars back to back, then a 6 m aisle.
  const pattern = [{ d: 5, face: 1 }, { d: 5, face: -1 }, { d: 6, face: 0 }];
  let v = minV, k = 0;
  while (v < maxV && out.length < 400) {
    const p = pattern[k++ % 3];
    if (p.face !== 0) {
      const vc = v + p.d / 2;
      for (let u = minU + 1.25; u < maxU; u += 2.5) {
        const fits = [[-1.1, -2.3], [1.1, -2.3], [-1.1, 2.3], [1.1, 2.3]].every(([du, dv]) => {
          const x = (u + du) * ux + (vc + dv) * vx, z = (u + du) * uz + (vc + dv) * vz;
          return inPolygon(x, z, rings);
        });
        if (!fits) continue;
        const x = u * ux + vc * vx, z = u * uz + vc * vz;
        out.push({ x, z, yaw: Math.atan2(vx * p.face, vz * p.face) });
      }
    }
    v += p.d;
  }
}

export function buildStreetProps(data: ChunkData, rect: Rect, heights: HeightField, scene: PropSpot[], mats: PropMaterials): ChunkProps {
  library ??= makeLibrary();
  const group = new THREE.Group();
  const boxes: number[] = [];
  const disposables: { dispose(): void }[] = [];
  const spots: Record<GeoKind, { x: number; z: number; yaw: number; s: number }[]> = {
    bench: [], bollard: [], pyramid: [], planter: [], jet: [], bin: [], shrub: [],
  };
  const inChunk = (x: number, z: number) => x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ;

  for (const p of scene) spots[p.kind].push({ x: p.x, z: p.z, yaw: p.yaw, s: p.size ?? 1 });

  // Benches and bins along the edges of pedestrian squares (OSM areas).
  for (const a of data.areas) {
    if (a.kind !== 'plaza') continue;
    const r = a.rings[0];
    let acc = 0;
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length;
      const dx = r[j] - r[i], dz = r[j + 1] - r[i + 1], len = Math.hypot(dx, dz);
      if (len < 6) continue;
      for (let d = 4; d < len - 3; d += 11) {
        const t = d / len;
        // Inward normal: test both sides.
        let nx = -dz / len, nz = dx / len;
        const mx = r[i] + dx * t, mz = r[i + 1] + dz * t;
        if (!inPolygon(mx + nx * 2, mz + nz * 2, a.rings)) { nx = -nx; nz = -nz; }
        const x = mx + nx * 1.6, z = mz + nz * 1.6;
        if (!inChunk(x, z) || !inPolygon(x, z, a.rings)) continue;
        if (acc++ % 4 === 3) spots.bin.push({ x, z, yaw: 0, s: 1 });
        else spots.bench.push({ x, z, yaw: Math.atan2(nx, nz), s: 1 });
      }
    }
  }

  // Parked cars in parking areas.
  const cars: { x: number; z: number; yaw: number }[] = [];
  for (const a of data.areas) {
    if (a.kind !== 'parking') continue;
    const slots: { x: number; z: number; yaw: number }[] = [];
    parkingSlots(a.rings, slots);
    for (const s of slots) if (inChunk(s.x, s.z) && hash(s.x, s.z) < 0.72) cars.push(s);
  }

  // Shrubs along residential buildings, kept off roads.
  const roadSegs: number[] = [];
  for (const rd of data.roads) for (let i = 0; i + 3 < rd.pts.length; i += 2) roadSegs.push(rd.pts[i], rd.pts[i + 1], rd.pts[i + 2], rd.pts[i + 3], rd.w / 2 + 1.2);
  const nearRoad = (x: number, z: number) => {
    for (let k = 0; k < roadSegs.length; k += 5) {
      const ax = roadSegs[k], az = roadSegs[k + 1], bx = roadSegs[k + 2], bz = roadSegs[k + 3];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      if (Math.hypot(ax + dx * t - x, az + dz * t - z) < roadSegs[k + 4]) return true;
    }
    return false;
  };
  for (const b of data.buildings) {
    if (!['residential', 'apartments', 'house', 'detached', 'yes'].includes(b.kind) || b.h > 30) continue;
    const r = b.rings[0];
    let area = 0;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) area += r[j] * r[i + 1] - r[i] * r[j + 1];
    const sign = area > 0 ? 1 : -1;
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length;
      const dx = r[j] - r[i], dz = r[j + 1] - r[i + 1], len = Math.hypot(dx, dz);
      if (len < 5) continue;
      const nx = (dz / len) * sign, nz = (-dx / len) * sign; // outward
      for (let d = 1.5; d < len - 1; d += 2.6) {
        if (hash(b.id + i, d) > 0.4) continue;
        const x = r[i] + (dx * d) / len + nx * 1.1, z = r[i + 1] + (dz * d) / len + nz * 1.1;
        if (!inChunk(x, z) || nearRoad(x, z)) continue;
        spots.shrub.push({ x, z, yaw: hash(d, i) * 6.28, s: 0.7 + hash(i, d) * 0.6 });
      }
    }
  }

  // --- Instanced meshes
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const kind of Object.keys(spots) as GeoKind[]) {
    const list = spots[kind];
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(library[kind], kind === 'jet' ? mats.jets : mats.props, list.length);
    list.forEach((s, i) => {
      const y = heights.sample(s.x, s.z) - (kind === 'shrub' ? 0.15 : 0.02);
      const scale = kind === 'planter' ? new THREE.Vector3(s.s, 1, s.s) : kind === 'jet' ? new THREE.Vector3(1, 1.3, 1) : new THREE.Vector3(s.s, s.s, s.s);
      m.compose(new THREE.Vector3(s.x, y, s.z), q.setFromAxisAngle(up, s.yaw), scale);
      mesh.setMatrixAt(i, m);
      if (kind === 'planter') boxes.push(s.x, y + 0.25, s.z, 0, s.s * 0.8, 0.25, s.s * 0.8);
      if (kind === 'pyramid') boxes.push(s.x, y + 1, s.z, 0, 0.5, 1, 0.5);
      if (kind === 'bollard') boxes.push(s.x, y + 0.45, s.z, 0, 0.1, 0.45, 0.1);
    });
    mesh.castShadow = kind !== 'jet';
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    disposables.push(mesh);
  }

  if (cars.length) {
    carGeo ??= bakeCarGeometries();
    const paint = new THREE.InstancedMesh(carGeo.paint, mats.parkedCars, cars.length);
    const detail = new THREE.InstancedMesh(carGeo.detail, mats.parkedCars, cars.length);
    const color = new THREE.Color(), white = new THREE.Color(1, 1, 1);
    cars.forEach((c, i) => {
      const y = heights.sample(c.x, c.z) + 0.72;
      m.compose(new THREE.Vector3(c.x, y, c.z), q.setFromAxisAngle(up, c.yaw), new THREE.Vector3(1, 1, 1));
      paint.setMatrixAt(i, m);
      detail.setMatrixAt(i, m);
      color.setHex(CAR_COLORS[Math.floor(hash(c.z, c.x) * CAR_COLORS.length)]);
      paint.setColorAt(i, color);
      detail.setColorAt(i, white);
      boxes.push(c.x, y + 0.1, c.z, c.yaw, 0.88, 0.45, 2.15);
    });
    for (const mesh of [paint, detail]) {
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      disposables.push(mesh);
    }
  }
  return { group, boxes, dispose: () => disposables.forEach((d) => d.dispose()) };
}
