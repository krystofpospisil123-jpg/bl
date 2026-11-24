// Hand-placed details for well-known places, laid out from the ČÚZK orthophoto (dev tool:
// scripts/dev/ortho-crop.ts) and the player's street photos (used as visual reference only).
// Everything else in the city is generated. Coordinates are game coordinates (x east, z south).
import { MarkKind, type Area, type Pylon } from './format.ts';

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
  kind: 'clockTower' | 'bastion' | 'portal' | 'gable' | 'panel' | 'canopy';
  x: number;
  z: number;
  /** Direction the feature faces (rad, 0 = +z). */
  yaw: number;
  /** Base height above the terrain (e.g. eave height for a gable). */
  base?: number;
  size?: number;
  /** Panel/canopy height (m) and colour. */
  height?: number;
  colour?: number;
}

export interface Scene {
  areas: Area[];
  props: PropSpot[];
  /** Extra trees: [x, z, height, type]. */
  trees: number[];
  extras: Extra[];
  /** Painted markings, flat [x, z, yaw, kind] (see format.ts MarkKind). */
  marks?: number[];
  /** Tall double-arm car-park lamps: flat [x, z, yaw]. */
  lamps?: number[];
  pylons?: Pylon[];
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
  // The street (OSM "náměstí Republiky", 7 m wide) is not exactly perpendicular to the axis, so the
  // square's street edge and its bollards follow the street: a line 2 m beyond the kerb.
  const road = { x: -27.7, z: 150.9, dx: -0.342, dz: -0.94 };
  const nx = road.dz * -1, nz = road.dx; // normal pointing from the street towards the square
  const edge = { x: road.x + nx * 5.5, z: road.z + nz * 5.5 };
  /** Axis distance at which the line at offset s across meets the street edge. */
  const tEdge = (s2: number) => {
    const px = start.x + vx * s2 - edge.x, pz = start.z + vz * s2 - edge.z;
    return -(px * nx + pz * nz) / (ux * nx + uz * nz);
  };
  const corners = [at(tEdge(-half), -half), at(len, -half), at(len, half), at(tEdge(half), half)];
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
  // Bollards in a straight row along the street edge.
  const b0 = corners[0], b1 = corners[3];
  const blen = Math.hypot(b1.x - b0.x, b1.z - b0.z);
  for (let d = 0.6; d <= blen - 0.6; d += 2.4) {
    props.push({ kind: 'bollard', x: b0.x + ((b1.x - b0.x) * d) / blen - nx * 0.6, z: b0.z + ((b1.z - b0.z) * d) / blen - nz * 0.6, yaw: 0 });
  }
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

/** Arrows and a dashed centre line along a straight two-way aisle from (ax, az) to (bx, bz). */
function aisleMarks(ax: number, az: number, bx: number, bz: number, every = 24): number[] {
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const yaw = Math.atan2(dx, dz);
  const out: number[] = [];
  for (let d = 2; d < len - 2; d += 5) out.push(ax + dx * d, az + dz * d, yaw, MarkKind.dash);
  // One arrow per direction, each in its own lane (right-hand traffic).
  let k = 0;
  for (let d = 8; d < len - 6; d += every, k++) {
    const kind = k % 3 === 1 ? MarkKind.arrowRight : k % 3 === 2 ? MarkKind.arrowLeft : MarkKind.arrow;
    const rx = -dz, rz = dx; // right-hand side when driving from a to b
    out.push(ax + dx * d + rx * 1.4, az + dz * d + rz * 1.4, yaw, kind);
    out.push(ax + dx * (d + 6) - rx * 1.4, az + dz * (d + 6) - rz * 1.4, yaw + Math.PI, kind);
  }
  return out;
}

const rectRing = (x0: number, z0: number, x1: number, z1: number) => [x0, z0, x1, z0, x1, z1, x0, z1];

/**
 * Kaufland car park on Na Řadech (photos from the car park): dark grey hall in the north with a
 * tall square pylon sign by the entrance, a long white retail hall (blue section next to the
 * supermarket) on the east side, arrows and dashed lines on the aisles, tall double-arm lamps.
 */
function kauflandPark(): Scene {
  const marks = [
    ...aisleMarks(-149, -726, -149, -816),
    ...aisleMarks(-164, -728, -164, -816),
    ...aisleMarks(-182, -744, -182, -816),
    ...aisleMarks(-200, -768.5, -133, -768.5, 30),
  ];
  const lamps: number[] = [];
  for (const x of [-135.5, -156.5, -173]) for (const z of [-736, -758, -790, -812]) lamps.push(x, z, Math.PI / 2);
  const trees: number[] = [];
  // Young trees at the row ends and along the retail hall.
  for (const x of [-141, -156.5, -173, -190]) trees.push(x, -752.5, 5 + (x % 2 ? 0.5 : 0), 0);
  for (let z = -744; z > -828; z -= 14) trees.push(-128.5, z, 5.5, 0);
  const extras: Extra[] = [
    // Dark entrance canopy and a light grey band along the top of the supermarket front.
    { kind: 'canopy', x: -147, z: -829.4, yaw: 0, size: 22, height: 3.3, colour: 0x34383b },
    { kind: 'panel', x: -151.5, z: -829.7, yaw: 0, base: 6.4, size: 57, height: 2.4, colour: 0xc4c8cb },
    // Blue section of the retail hall next to the supermarket, then a smaller canopy further south.
    { kind: 'panel', x: -122.1, z: -815, yaw: -Math.PI / 2, base: 3.4, size: 22, height: 4, colour: 0x1d4c9c },
    { kind: 'panel', x: -121.9, z: -827, yaw: -Math.PI / 2, base: 3.4, size: 2.5, height: 3, colour: 0x5fae45 },
    { kind: 'canopy', x: -122.9, z: -785, yaw: -Math.PI / 2, size: 12, height: 3.2, colour: 0xd9dcde },
  ];
  const pylons: Pylon[] = [
    { x: -160, z: -824, yaw: 0, text: 'Kaufland', generic: 'Hypermarket', height: 12.5, board: 5.5, frame: '#a3a8ac' },
  ];
  return { areas: [], props: [], trees, extras, marks, lamps, pylons };
}

/**
 * Retail row on the west side of Poříčí: the supermarket in the northern part, a shoe shop with
 * orange cladding and a tobacconist further south, one long canopy over the shop fronts, a
 * tall pylon with all tenants by the entrance from the roundabout, parking in front.
 */
function lidlPark(): Scene {
  const areas = [
    // Parking in front of the long hall south of the supermarket (seen on the orthophoto).
    { id: -1010, kind: 'parking', rings: [rectRing(-323.5, -744, -318, -682)] },
    { id: -1011, kind: 'parking', rings: [rectRing(-312.8, -744, -302.4, -682)] },
    { id: -1012, kind: 'parking', rings: [rectRing(-323.5, -674, -318, -630)] },
    { id: -1013, kind: 'parking', rings: [rectRing(-312.8, -674, -302.4, -630)] },
  ];
  const marks = [
    ...aisleMarks(-315.5, -686, -315.5, -762),
    ...aisleMarks(-316, -784, -316, -812, 20),
    ...aisleMarks(-299, -784, -299, -812, 20),
  ];
  const lamps: number[] = [];
  for (const z of [-640, -665, -700, -730]) lamps.push(-307.6, z, Math.PI / 2);
  for (const z of [-790, -810]) lamps.push(-307.5, z, Math.PI / 2);
  const trees: number[] = [];
  for (let z = -700; z > -752; z -= 9) trees.push(-289, z, 4.8, 0);
  for (let z = -640; z > -676; z -= 12) trees.push(-297.5, z, 5, 0);
  const wallX = (z: number) => -327.8 - 0.9 * ((-740.7 - z) / 53); // east wall of the hall
  const yaw = Math.PI / 2;
  const extras: Extra[] = [
    { kind: 'canopy', x: wallX(-767), z: -767, yaw, size: 52, height: 3.4, colour: 0x55595d },
    { kind: 'panel', x: wallX(-749), z: -749, yaw, base: 3.9, size: 12, height: 3.4, colour: 0xd3542a },
    { kind: 'panel', x: wallX(-743), z: -742.5, yaw, base: 3.9, size: 2.8, height: 3.4, colour: 0x8f8580 },
    { kind: 'panel', x: wallX(-760), z: -760, yaw, base: 0.2, size: 8, height: 7.2, colour: 0x2f3236 },
  ];
  const pylons: Pylon[] = [
    {
      x: -293, z: -776, yaw: 0, text: 'Lidl', generic: 'Supermarket', height: 10.5, board: 3, frame: '#7d8287',
      tenants: [['Deichmann', 'Obuv'], ['Tabák', 'Tabák'], ['Action', 'Obchod'], ['Restaurace', 'Restaurace']],
    },
  ];
  return { areas, props: [], trees, extras, marks, lamps, pylons };
}

/**
 * Wanklovo náměstí: the pedestrian street from náměstí Republiky to the south-west, between
 * blocks of flats. Paved with two rows of small round trees down the middle (Street View and
 * the 3D map), benches beside them.
 */
function wanklovoNamesti(): Scene {
  const A = { x: -48, z: 149 }, B = { x: -153, z: 185 };
  const len = Math.hypot(B.x - A.x, B.z - A.z);
  const ux = (B.x - A.x) / len, uz = (B.z - A.z) / len;
  const vx = -uz, vz = ux; // towards the northern buildings
  const at = (t: number, s2: number) => ({ x: A.x + ux * t + vx * s2, z: A.z + uz * t + vz * s2 });
  const ring = [at(-1, -9), at(len + 2, -9), at(len + 2, 11.8), at(-1, 11.8)].flatMap((p) => [p.x, p.z]);
  const trees: number[] = [];
  const props: PropSpot[] = [];
  for (let t = 9; t < len - 3; t += 6.5) for (const s2 of [0.5, 7]) {
    const p = at(t, s2);
    trees.push(p.x, p.z, 6.2 + ((t * 3) % 1.2), 0);
  }
  for (let t = 15; t < len - 8; t += 13) {
    props.push({ kind: 'bench', ...at(t, -1.1), yaw: Math.atan2(-vx, -vz) });
    props.push({ kind: 'bench', ...at(t + 6.5, 8.6), yaw: Math.atan2(vx, vz) });
  }
  for (const t of [22, 61, 100]) props.push({ kind: 'bin', ...at(t, -1.3), yaw: 0 });
  return { areas: [{ id: -1003, kind: 'plaza', rings: [ring] }], props, trees, extras: [] };
}

const SCENES: Scene[] = [treeBedPark(), namestiRepubliky(), zamek(), wanklovoNamesti(), kauflandPark(), lidlPark()];

function ringBox(r: number[]) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    minX = Math.min(minX, r[i]); maxX = Math.max(maxX, r[i]);
    minZ = Math.min(minZ, r[i + 1]); maxZ = Math.max(maxZ, r[i + 1]);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Scene content that falls into a chunk (areas overlapping it, everything else inside it). */
export function sceneFor(rect: { minX: number; minZ: number; maxX: number; maxZ: number }): Required<Scene> {
  const inside = (x: number, z: number) => x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ;
  const out: Required<Scene> = { areas: [], props: [], trees: [], extras: [], marks: [], lamps: [], pylons: [] };
  for (const s of SCENES) {
    for (const a of s.areas) {
      const b = ringBox(a.rings[0]);
      if (b.maxX >= rect.minX && b.minX < rect.maxX && b.maxZ >= rect.minZ && b.minZ < rect.maxZ) out.areas.push(a);
    }
    out.props.push(...s.props.filter((p) => inside(p.x, p.z)));
    out.extras.push(...s.extras.filter((e) => inside(e.x, e.z)));
    for (let i = 0; i < s.trees.length; i += 4) if (inside(s.trees[i], s.trees[i + 1])) out.trees.push(...s.trees.slice(i, i + 4));
    // Markings are painted per chunk texture, so keep those that reach into it (arrows are ~3 m long).
    const m = s.marks ?? [];
    for (let i = 0; i < m.length; i += 4) {
      if (m[i] >= rect.minX - 4 && m[i] < rect.maxX + 4 && m[i + 1] >= rect.minZ - 4 && m[i + 1] < rect.maxZ + 4) out.marks.push(...m.slice(i, i + 4));
    }
    const l = s.lamps ?? [];
    for (let i = 0; i < l.length; i += 3) if (inside(l[i], l[i + 1])) out.lamps.push(...l.slice(i, i + 3));
    out.pylons.push(...(s.pylons ?? []).filter((p) => inside(p.x, p.z)));
  }
  return out;
}
