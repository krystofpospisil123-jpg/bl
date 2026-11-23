// Hand-placed details for places the player sees first, laid out from the ČÚZK orthophoto
// (dev tool: scripts/dev/ortho-crop.ts). Everything else in the city is generated.
// Coordinates are game coordinates (x east, z south) in metres.
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

export interface Scene {
  areas: Area[];
  props: PropSpot[];
  /** Extra trees: [x, z, height, type]. */
  trees: number[];
}

/** Náměstí Republiky: paved square with round tree beds, flower pyramids and floor fountains. */
function namestiRepubliky(): Scene {
  const square = [-31, 46, 2, 46, 12, 62, 11, 97, -31, 97];
  const props: PropSpot[] = [];
  const trees: number[] = [];
  // Round beds with a large tree each (seen as circles on the orthophoto).
  for (const [x, z] of [[-16, 74], [-6, 64], [-1, 76], [-10, 86]]) {
    props.push({ kind: 'planter', x, z, yaw: 0, size: 4.2 });
    trees.push(x, z, 11 + ((x * 7 + z) % 3), 0);
  }
  // Floor fountain jets in a 3 x 4 grid at the open end of the square.
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) props.push({ kind: 'jet', x: -22 + i * 1.6, z: 52 + j * 1.6, yaw: 0 });
  // Flower pyramids along the square.
  for (const [x, z] of [[-26, 60], [-26, 72], [-26, 84], [4, 70], [4, 84]]) props.push({ kind: 'pyramid', x, z, yaw: 0 });
  // Benches along both long edges, facing the middle.
  for (let z = 50; z <= 94; z += 6) {
    props.push({ kind: 'bench', x: -29.3, z, yaw: Math.PI / 2 });
    if (z > 64) props.push({ kind: 'bench', x: 9.2, z, yaw: -Math.PI / 2 });
  }
  // Bollards between the square and the parking on the west side.
  for (let z = 47; z <= 96; z += 2.2) props.push({ kind: 'bollard', x: -31.6, z, yaw: 0 });
  for (const [x, z] of [[-28.5, 66], [-28.5, 80], [8.5, 76]]) props.push({ kind: 'bin', x, z, yaw: 0 });
  return { areas: [{ id: -1001, kind: 'plaza', rings: [square] }], props, trees };
}

const SCENES: Scene[] = [namestiRepubliky()];

function ringBox(r: number[]) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    minX = Math.min(minX, r[i]); maxX = Math.max(maxX, r[i]);
    minZ = Math.min(minZ, r[i + 1]); maxZ = Math.max(maxZ, r[i + 1]);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Scene content that falls into a chunk (areas overlapping it, props and trees inside it). */
export function sceneFor(rect: { minX: number; minZ: number; maxX: number; maxZ: number }): Scene {
  const inside = (x: number, z: number) => x >= rect.minX && x < rect.maxX && z >= rect.minZ && z < rect.maxZ;
  const out: Scene = { areas: [], props: [], trees: [] };
  for (const s of SCENES) {
    for (const a of s.areas) {
      const b = ringBox(a.rings[0]);
      if (b.maxX >= rect.minX && b.minX < rect.maxX && b.maxZ >= rect.minZ && b.minZ < rect.maxZ) out.areas.push(a);
    }
    out.props.push(...s.props.filter((p) => inside(p.x, p.z)));
    for (let i = 0; i < s.trees.length; i += 4) if (inside(s.trees[i], s.trees[i + 1])) out.trees.push(...s.trees.slice(i, i + 4));
  }
  return out;
}
