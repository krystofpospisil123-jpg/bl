// Extruded buildings for one chunk, merged into a single geometry with three groups:
// 0 = walls (facade texture), 1 = pitched roofs (tile texture), 2 = flat roofs.
import * as THREE from 'three';
import type { Building } from '../format.ts';

const WALL_COLORS: Record<string, number[]> = {
  residential: [0xe8dcc0, 0xf0e2b6, 0xe6c9b0, 0xd9d7cf, 0xe3e6d5, 0xf2ead8, 0xd8c7a8],
  industrial: [0xa9adb0, 0xb7b2a6, 0x9fa8ad, 0xc0bcb2],
  commercial: [0xe4e2dc, 0xd5d8d8, 0xeee6d4, 0xc9cfd2],
  garage: [0xb8b2a6, 0xc4bfb3, 0xa9a49a],
  church: [0xf1ead6, 0xeadcb4],
};
const PITCHED_ROOF_COLORS = [0x9c4a32, 0x8a3f2c, 0xa85a3a, 0x6b4a3a, 0x5a5652, 0x7a3a2c];
const FLAT_ROOF_COLORS = [0x6d6d6b, 0x7c7b77, 0x5f6062, 0x8a8782];

const NO_WINDOWS = new Set(['garage', 'garages', 'carport', 'shed', 'hut', 'roof', 'transformer_tower', 'service', 'kiosk', 'greenhouse']);
const INDUSTRIAL = new Set(['industrial', 'warehouse', 'manufacture', 'hangar', 'barn', 'farm_auxiliary', 'stable', 'cowshed']);
const PITCHABLE = new Set(['house', 'detached', 'semidetached_house', 'residential', 'yes', 'farm', 'bungalow', 'terrace', 'apartments', 'chapel', 'church', 'civic', 'barn']);

function colorGroup(kind: string): string {
  if (NO_WINDOWS.has(kind)) return 'garage';
  if (INDUSTRIAL.has(kind)) return 'industrial';
  if (['church', 'chapel', 'cathedral'].includes(kind)) return 'church';
  if (['commercial', 'retail', 'office', 'civic', 'public', 'school', 'hospital', 'government', 'train_station', 'transportation', 'supermarket'].includes(kind)) return 'commercial';
  return 'residential';
}

function hash(id: number, salt: number): number {
  let h = Math.imul(id ^ (id / 4294967296), 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

class Builder {
  pos: number[][] = [[], [], []];
  uv: number[][] = [[], [], []];
  col: number[][] = [[], [], []];

  /** Adds a triangle to group `grp`, flipping it so its normal points along `want`. */
  tri(grp: number, a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[], color: THREE.Color, want?: number[]) {
    if (want) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * want[0] + ny * want[1] + nz * want[2] < 0) {
        [b, c] = [c, b];
        [ub, uc] = [uc, ub];
      }
    }
    this.pos[grp].push(...a, ...b, ...c);
    this.uv[grp].push(...ua, ...ub, ...uc);
    for (let i = 0; i < 3; i++) this.col[grp].push(color.r, color.g, color.b);
  }

  quad(grp: number, a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[], color: THREE.Color, want: number[]) {
    this.tri(grp, a, b, c, ua, ub, uc, color, want);
    this.tri(grp, a, c, d, ua, uc, ud, color, want);
  }

  build(): THREE.BufferGeometry | null {
    const total = this.pos.reduce((s, p) => s + p.length, 0);
    if (!total) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos.flat(), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv.flat(), 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col.flat(), 3));
    let start = 0;
    for (let i = 0; i < 3; i++) {
      const count = this.pos[i].length / 3;
      if (count) g.addGroup(start, count, i);
      start += count;
    }
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const tmpColor = new THREE.Color();

/** Signed area in (x, z); positive = counter-clockwise in the x/z plane. */
function areaXZ(r: number[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1];
  return a / 2;
}

export function buildBuildingsGeometry(buildings: Building[]): THREE.BufferGeometry | null {
  const B = new Builder();
  for (const b of buildings) addBuilding(B, b);
  return B.build();
}

function addBuilding(B: Builder, b: Building) {
  const baseLevel = b.top - b.h;
  const bottom = b.minH > 0 ? baseLevel + b.minH : b.ground - 0.6;
  if (b.top - bottom < 1) return;
  const group = colorGroup(b.kind);
  const palette = WALL_COLORS[group];
  const wallColor = new THREE.Color(palette[Math.floor(hash(b.id, 1) * palette.length)]);
  const windows = !NO_WINDOWS.has(b.kind);
  const bay = INDUSTRIAL.has(b.kind) ? 6 : 3.2;
  const floor = INDUSTRIAL.has(b.kind) ? 5 : 3;

  const outer = b.rings[0];
  const pitched = pitchedRoof(b);
  const eave = pitched ? pitched.eave : b.top;

  // --- Walls
  for (const ring of b.rings) {
    const ccw = areaXZ(ring) > 0;
    const isHole = ring !== outer;
    let dist = 0;
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const ax = ring[i], az = ring[i + 1], bx = ring[j], bz = ring[j + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      // Outward normal in x/z (inverted for holes, whose walls face inward).
      let nx = ccw ? (bz - az) : -(bz - az);
      let nz = ccw ? -(bx - ax) : (bx - ax);
      // For a CCW polygon in standard (x right, z up) orientation, (dz, -dx) points outward.
      if (isHole) { nx = -nx; nz = -nz; }
      const want = [nx, 0, nz];
      const u0 = windows ? dist / bay : 0.05, u1 = windows ? (dist + len) / bay : 0.05;
      const v0 = windows ? (bottom - baseLevel) / floor : 0.05, v1 = windows ? (eave - baseLevel) / floor : 0.05;
      B.quad(0, [ax, bottom, az], [bx, bottom, bz], [bx, eave, bz], [ax, eave, az],
        [u0, v0], [u1, v0], [u1, v1], [u0, v1], wallColor, want);
      dist += len;
    }
  }

  if (pitched) {
    addPitchedRoof(B, pitched, wallColor, new THREE.Color(PITCHED_ROOF_COLORS[Math.floor(hash(b.id, 2) * PITCHED_ROOF_COLORS.length)]), baseLevel, floor, windows);
    return;
  }

  // --- Flat roof
  const contour = toVec2(outer);
  const holes = b.rings.slice(1).map(toVec2);
  const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
  const all = contour.concat(...holes);
  tmpColor.setHex(FLAT_ROOF_COLORS[Math.floor(hash(b.id, 3) * FLAT_ROOF_COLORS.length)]);
  const up = [0, 1, 0];
  for (const [i, j, k] of tris) {
    const p = (v: THREE.Vector2) => [v.x, b.top, v.y];
    B.tri(2, p(all[i]), p(all[j]), p(all[k]), [0, 0], [0, 0], [0, 0], tmpColor, up);
  }
}

function toVec2(r: number[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < r.length; i += 2) out.push(new THREE.Vector2(r[i], r[i + 1]));
  return out;
}

interface Pitched {
  corners: number[][]; // 4 corners [x, z] in order
  long: number; // index of the first long edge (0 or 1)
  eave: number;
  ridge: number;
}

/** Gable roofs for small, nearly rectangular buildings. */
function pitchedRoof(b: Building): Pitched | null {
  if (b.rings.length !== 1 || b.rings[0].length !== 8) return null;
  if (b.roof === 'flat' || (!PITCHABLE.has(b.kind) && !b.roof)) return null;
  if (b.h > 14 || b.minH > 0) return null;
  const r = b.rings[0];
  const c = [0, 1, 2, 3].map((i) => [r[i * 2], r[i * 2 + 1]]);
  const e = (i: number) => Math.hypot(c[(i + 1) % 4][0] - c[i][0], c[(i + 1) % 4][1] - c[i][1]);
  const lens = [e(0), e(1), e(2), e(3)];
  // Rectangularity: area vs product of mean side lengths.
  const a = Math.abs(areaXZ(r));
  const w0 = (lens[0] + lens[2]) / 2, w1 = (lens[1] + lens[3]) / 2;
  if (a / (w0 * w1) < 0.88) return null;
  const short = Math.min(w0, w1);
  if (short > 16 || short < 3) return null;
  const roofH = Math.min(short * 0.5 * Math.tan((38 * Math.PI) / 180), 5.5);
  const eave = b.top - roofH;
  if (eave - (b.top - b.h) < 2.4) return null;
  return { corners: c, long: w0 >= w1 ? 0 : 1, eave, ridge: b.top };
}

function addPitchedRoof(B: Builder, p: Pitched, wallColor: THREE.Color, roofColor: THREE.Color, baseLevel: number, floor: number, windows: boolean) {
  const c = p.corners;
  // Long edges: (k, k+1) and (k+2, k+3); gable ends are the other two edges.
  const k = p.long;
  const A = c[k], Bc = c[(k + 1) % 4], C = c[(k + 2) % 4], D = c[(k + 3) % 4];
  // Ridge endpoints: midpoints of the gable edges (D-A and Bc-C).
  const r0 = [(D[0] + A[0]) / 2, (D[1] + A[1]) / 2];
  const r1 = [(Bc[0] + C[0]) / 2, (Bc[1] + C[1]) / 2];
  const P = (q: number[], y: number) => [q[0], y, q[1]];
  const ridgeLen = Math.hypot(r1[0] - r0[0], r1[1] - r0[1]);
  const slope = Math.hypot(Math.hypot(A[0] - r0[0], A[1] - r0[1]), p.ridge - p.eave);
  const cx = (A[0] + C[0]) / 2, cz = (A[1] + C[1]) / 2;

  // Two roof planes, normals pointing away from the centre and upward.
  const plane = (e0: number[], e1: number[], g1: number[], g0: number[]) => {
    const mx = (e0[0] + e1[0]) / 2 - cx, mz = (e0[1] + e1[1]) / 2 - cz;
    const want = [mx, Math.hypot(mx, mz), mz];
    B.quad(1, P(e0, p.eave), P(e1, p.eave), P(g1, p.ridge), P(g0, p.ridge),
      [0, 0], [ridgeLen / 4, 0], [ridgeLen / 4, slope / 4], [0, slope / 4], roofColor, want);
  };
  plane(A, Bc, r1, r0);
  plane(C, D, r0, r1);

  // Gable triangles (wall material).
  const gable = (e0: number[], e1: number[], top: number[]) => {
    const want = [top[0] - cx, 0, top[1] - cz];
    const w = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]);
    const v0 = windows ? (p.eave - baseLevel) / floor : 0.05, v1 = windows ? (p.ridge - baseLevel) / floor : 0.05;
    B.tri(0, P(e0, p.eave), P(e1, p.eave), P(top, p.ridge), [0.05, v0], [windows ? w / 3.2 : 0.05, v0], [windows ? w / 6.4 : 0.05, v1], wallColor, want);
  };
  gable(D, A, r0);
  gable(Bc, C, r1);
}
