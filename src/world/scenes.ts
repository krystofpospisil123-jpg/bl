// Hand-placed details for well-known places, laid out from the ČÚZK orthophoto (dev tool:
// scripts/dev/ortho-crop.ts) and the player's street photos (used as visual reference only).
// Everything else in the city is generated. Coordinates are game coordinates (x east, z south).
import type { Area } from './format.ts';

export type PropKind = 'bench' | 'bollard' | 'pyramid' | 'planter' | 'jet' | 'bin';

export interface PropSpot {
  kind: PropKind;
  x: number;
  z: number;
  /** Heading (rad, 0 = facing +z). */
  yaw: number;
  /** Optional size factor (e.g. planter radius). */
  size?: number;
}

/** Larger hand-made structures attached to landmark buildings. */
export interface Extra {
  kind: 'clockTower' | 'bastion' | 'portal' | 'gable';
  x: number;
  z: number;
  /** Direction the feature faces (rad, 0 = +z). */
  yaw: number;
  /** Base height above the terrain (e.g. eave height for a gable). */
  base?: number;
  size?: number;
}

export interface Scene {
  areas: Area[];
  props: PropSpot[];
  /** Extra trees: [x, z, height, type]. */
  trees: number[];
  extras: Extra[];
}

/**
 * Park west of náměstí Republiky: paved area with four round tree beds (seen as circles on
 * the orthophoto). Kept as it was; the fountains and flower pyramids belong to the square.
 */
function treeBedPark(): Scene {
  const paving = [-31, 46, 2, 46, 12, 62, 11, 97, -31, 97];
  const props: PropSpot[] = [];
  const trees: number[] = [];
  for (const [x, z] of [[-16, 74], [-6, 64], [-1, 76], [-10, 86]]) {
    props.push({ kind: 'planter', x, z, yaw: 0, size: 4.2 });
    trees.push(x, z, 11 + ((x * 7 + z) % 3), 0);
  }
  for (let z = 52; z <= 94; z += 7) props.push({ kind: 'bench', x: -29.3, z, yaw: Math.PI / 2 });
  return { areas: [{ id: -1001, kind: 'plaza', rings: [paving] }], props, trees, extras: [] };
}

/**
 * Náměstí Republiky: a long paved square between two parking strips. Its axis runs from the
 * street with the zebra crossing (south-west) straight to the yellow building with pilasters
 * (the Komerční banka building, OSM 253861544) in the north-east, at about 28 degrees to the
 * map grid. Floor fountains on the axis, two rows of flower pyramids, benches, tree rows.
 */
function namestiRepubliky(): Scene {
  const start = { x: -25, z: 147 }, end = { x: 30, z: 118 };
  const len = Math.hypot(end.x - start.x, end.z - start.z);
  const ux = (end.x - start.x) / len, uz = (end.z - start.z) / len; // along the axis
  const vx = -uz, vz = ux; // across (to the south-east side)
  const half = 10;
  /** Point at distance t along the axis and s across it. */
  const at = (t: number, s: number) => ({ x: start.x + ux * t + vx * s, z: start.z + uz * t + vz * s });
  const corners = [at(0, -half), at(len, -half), at(len, half), at(0, half)];
  const square = corners.flatMap((c) => [c.x, c.z]);
  const props: PropSpot[] = [];
  const trees: number[] = [];
  // Two fields of floor fountain jets on the axis.
  for (const t0 of [20, 38]) for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
    const p = at(t0 + i * 1.5, -1.5 + j * 1.5);
    props.push({ kind: 'jet', ...p, yaw: 0 });
  }
  // Flower pyramids in two rows either side of the axis.
  for (const t of [9, 29, 47, 58]) for (const s2 of [-6.5, 6.5]) props.push({ kind: 'pyramid', ...at(t, s2), yaw: 0 });
  // Benches along both long edges, facing the middle.
  for (let t = 4; t < len - 3; t += 11) {
    props.push({ kind: 'bench', ...at(t, -8.8), yaw: Math.atan2(vx, vz) });
    props.push({ kind: 'bench', ...at(t + 5, 8.8), yaw: Math.atan2(-vx, -vz) });
  }
  for (const [t, s2] of [[15, -8.8], [33, 8.8], [52, -8.8]]) props.push({ kind: 'bin', ...at(t, s2), yaw: 0 });
  // Bollards across the end that meets the street.
  for (let s2 = -half + 0.5; s2 <= half - 0.5; s2 += 2.4) props.push({ kind: 'bollard', ...at(-0.8, s2), yaw: 0 });
  // Rows of trees between the square and the parking on both sides.
  for (let t = 5; t < len; t += 12) {
    const a = at(t, -half - 1.8), b = at(t + 6, half + 1.8);
    trees.push(a.x, a.z, 9 + (t % 3), 0, b.x, b.z, 9 + ((t + 1) % 3), 0);
  }
  return { areas: [{ id: -1002, kind: 'plaza', rings: [square] }], props, trees, extras: [] };
}

/**
 * Zámek Blansko: the entrance front faces south-west (OSM outline edge (67,-119)->(86,-97)).
 * Clock tower on the left of the gate, renaissance gable to the right, round stone bastion
 * at the southern corner (the rounded part of the outline).
 */
function zamek(): Scene {
  const ax = 67, az = -119, bx = 86, bz = -97;
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const nx = -dz, nz = dx; // outward (south-west)
  const yaw = Math.atan2(nx, nz);
  const at = (t: number, out = 0) => ({ x: ax + dx * len * t + nx * out, z: az + dz * len * t + nz * out });
  const gate = at(0.45, 0.05);
  const tower = at(0.17, -3.4); // front face flush with the facade
  const gable = at(0.8, 0.1);
  const extras: Extra[] = [
    { kind: 'portal', ...gate, yaw },
    { kind: 'clockTower', ...tower, yaw, size: 7 },
    { kind: 'gable', ...gable, yaw, base: 10.5, size: 13 },
    { kind: 'bastion', x: 91, z: -86, yaw, size: 5.5 },
  ];
  return { areas: [], props: [], trees: [], extras };
}

const SCENES: Scene[] = [treeBedPark(), namestiRepubliky(), zamek()];

function ringBox(r: number[]) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    minX = Math.min(minX, r[i]); maxX = Math.max(maxX, r[i]);
    minZ = Math.min(minZ, r[i + 1]); maxZ = Math.max(maxZ, r[i + 1]);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Scene content that falls into a chunk (areas overlapping it, everything else inside it). */
export function sceneFor(rect: { minX: number; minZ: number; maxX: number; maxZ: number }): Scene {
  const inside = (x: number, z: number) => x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ;
  const out: Scene = { areas: [], props: [], trees: [], extras: [] };
  for (const s of SCENES) {
    for (const a of s.areas) {
      const b = ringBox(a.rings[0]);
      if (b.maxX >= rect.minX && b.minX < rect.maxX && b.maxZ >= rect.minZ && b.minZ < rect.maxZ) out.areas.push(a);
    }
    out.props.push(...s.props.filter((p) => inside(p.x, p.z)));
    out.extras.push(...s.extras.filter((e) => inside(e.x, e.z)));
    for (let i = 0; i < s.trees.length; i += 4) if (inside(s.trees[i], s.trees[i + 1])) out.trees.push(...s.trees.slice(i, i + 4));
  }
  return out;
}
