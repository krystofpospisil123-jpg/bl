// Street furniture: lamp posts along main and residential streets (instanced per chunk).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ChunkData } from '../format.ts';
import type { HeightField } from '../HeightField.ts';

const LAMP_ROADS: Record<string, number> = { primary: 30, secondary: 32, tertiary: 34, residential: 40, unclassified: 45, living_street: 30, pedestrian: 25 };

function coloured(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const geo = g.toNonIndexed();
  geo.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const arr = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

let lampGeo: THREE.BufferGeometry | null = null;

/** Lamp post facing +Z (the arm reaches over the street). */
function lampGeometry(): THREE.BufferGeometry {
  if (lampGeo) return lampGeo;
  // Blansko-style lamp: light grey base, red pole, red arm curving over the street.
  const red = 0xa3322b, grey = 0xc9ccce;
  const arm: THREE.BufferGeometry[] = [];
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * (Math.PI / 2), a1 = ((i + 1) / segs) * (Math.PI / 2);
    const p0 = new THREE.Vector3(0, 6.6 + Math.sin(a0) * 0.6, (1 - Math.cos(a0)) * 0.6);
    const p1 = new THREE.Vector3(0, 6.6 + Math.sin(a1) * 0.6, (1 - Math.cos(a1)) * 0.6);
    const len = p0.distanceTo(p1);
    // Orient the segment from p0 to p1.
    const dir = p1.clone().sub(p0).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const g = new THREE.CylinderGeometry(0.05, 0.05, len, 6).applyQuaternion(q).translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
    arm.push(coloured(g, red));
  }
  lampGeo = mergeGeometries([
    coloured(new THREE.CylinderGeometry(0.13, 0.16, 1.1, 8).translate(0, 0.55, 0), grey),
    coloured(new THREE.CylinderGeometry(0.07, 0.1, 5.6, 8).translate(0, 3.9, 0), red),
    ...arm,
    coloured(new THREE.BoxGeometry(0.06, 0.06, 0.9).translate(0, 7.2, 1.05), red),
    coloured(new THREE.CylinderGeometry(0.22, 0.32, 0.22, 10).translate(0, 7.1, 1.45), 0x55585b),
    coloured(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 10).translate(0, 6.98, 1.45), 0xfff3d6),
  ])!;
  lampGeo.computeVertexNormals();
  return lampGeo;
}

export interface LampSpot {
  x: number;
  y: number;
  z: number;
}

export function buildLamps(data: ChunkData, rect: { minX: number; minZ: number; maxX: number; maxZ: number }, heights: HeightField, material: THREE.Material) {
  const spots: { x: number; z: number; yaw: number }[] = [];
  const seen = new Set<number>();
  for (const r of data.roads) {
    const spacing = LAMP_ROADS[r.kind];
    if (!spacing || r.bridge || r.tunnel || seen.has(r.id)) continue;
    seen.add(r.id);
    const p = r.pts;
    let acc = spacing * 0.5, side = r.id % 2 ? 1 : -1;
    for (let i = 0; i + 2 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      while (acc < len) {
        const x = ax + dx * acc, z = az + dz * acc;
        // Right-hand normal is (-dz, dx); lamps alternate sides and lean over the street.
        const nx = -dz * side, nz = dx * side;
        const off = r.w / 2 + 0.9;
        const lx = x + nx * off, lz = z + nz * off;
        if (lx >= rect.minX && lx < rect.maxX && lz >= rect.minZ && lz < rect.maxZ) spots.push({ x: lx, z: lz, yaw: Math.atan2(-nx, -nz) });
        acc += spacing;
        side = -side;
      }
      acc -= len;
    }
  }
  const lamps: LampSpot[] = [];
  if (!spots.length) return { mesh: null, lamps };
  const mesh = new THREE.InstancedMesh(lampGeometry(), material, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  spots.forEach((s, i) => {
    const y = heights.sample(s.x, s.z) - 0.1;
    m.compose(new THREE.Vector3(s.x, y, s.z), q.setFromAxisAngle(up, s.yaw), one);
    mesh.setMatrixAt(i, m);
    lamps.push({ x: s.x + Math.sin(s.yaw) * 1.45, y: y + 6.95, z: s.z + Math.cos(s.yaw) * 1.45 });
  });
  mesh.castShadow = true;
  mesh.computeBoundingSphere();
  return { mesh, lamps };
}
