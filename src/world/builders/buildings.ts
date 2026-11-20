// Extruded buildings for one chunk, merged into one geometry with three groups:
// 0 = walls (facade atlas), 1 = pitched roofs (tile texture), 2 = flat roofs.
// Roof shapes come from OSM roof:shape where the footprint allows it.
import * as THREE from 'three';
import type { Building } from '../format.ts';
import { FACADE } from '../../render/facades.ts';
import { LANDMARKS, styleForUse, type LandmarkStyle, type Tower } from '../landmarks.ts';

const WALL_COLORS: Record<string, number[]> = {
  residential: [0xe8dcc0, 0xf0e2b6, 0xe6c9b0, 0xd9d7cf, 0xe3e6d5, 0xf2ead8, 0xd8c7a8, 0xe9d3c2, 0xcfd8d6],
  panel: [0xe6e2d8, 0xd8dcd6, 0xe9dcc6, 0xd5dbe0, 0xefe6cf],
  oldtown: [0xf1dfb0, 0xe9c9a8, 0xf3ead6, 0xdfe2cf, 0xf0d2b8, 0xe6d8b4],
  industrial: [0xb9bec2, 0xc7c1b4, 0xaab4ba, 0xc9c6bd],
  commercial: [0xe4e2dc, 0xd5d8d8, 0xeee6d4, 0xc9cfd2],
  garage: [0xb8b2a6, 0xc4bfb3, 0xa9a49a],
};
const PITCHED_ROOF_COLORS = [0x9c4a32, 0x8a3f2c, 0xa85a3a, 0x6b4a3a, 0x5a5652, 0x7a3a2c, 0x4f4b48];
const FLAT_ROOF_COLORS = [0x6d6d6b, 0x7c7b77, 0x5f6062, 0x8a8782];

const NO_WINDOWS = new Set(['garage', 'garages', 'carport', 'shed', 'hut', 'roof', 'transformer_tower', 'service', 'kiosk', 'greenhouse']);
const INDUSTRIAL = new Set(['industrial', 'warehouse', 'manufacture', 'hangar', 'barn', 'farm_auxiliary', 'stable', 'cowshed']);
const COMMERCIAL = new Set(['commercial', 'retail', 'office', 'supermarket', 'civic', 'public', 'school', 'hospital', 'government', 'train_station', 'transportation']);
const HOUSE = new Set(['house', 'detached', 'semidetached_house', 'bungalow', 'farm', 'terrace']);
const PITCHABLE = new Set([...HOUSE, 'residential', 'yes', 'apartments', 'chapel', 'church', 'civic', 'barn', 'school', 'public']);

/** Centre of the historic town (náměstí, zámek) – older facades are used around it. */
const OLD_TOWN = { x: -40, z: 120, r: 480 };

function hash(id: number, salt: number): number {
  let h = Math.imul(id ^ (id / 4294967296), 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

const pick = <T,>(arr: T[], id: number, salt: number): T => arr[Math.floor(hash(id, salt) * arr.length)];

function cssColor(s: string | undefined): THREE.Color | null {
  if (!s) return null;
  try {
    const c = new THREE.Color();
    c.setStyle(s.trim().toLowerCase(), THREE.SRGBColorSpace);
    return c;
  } catch {
    return null;
  }
}

class Builder {
  pos: number[][] = [[], [], []];
  uv: number[][] = [[], [], []];
  col: number[][] = [[], [], []];
  fac: number[][] = [[], [], []];
  facade: [number, number] = [0, 0];

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
    for (let i = 0; i < 3; i++) {
      this.col[grp].push(color.r, color.g, color.b);
      this.fac[grp].push(this.facade[0], this.facade[1]);
    }
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
    g.setAttribute('facade', new THREE.Float32BufferAttribute(this.fac.flat(), 2));
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

/** Signed area in (x, z); positive = counter-clockwise in the x/z plane. */
function areaXZ(r: number[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j] * r[i + 1] - r[i] * r[j + 1];
  return a / 2;
}

function isConvex(r: number[]): boolean {
  const n = r.length / 2;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2, c = ((i + 2) % n) * 2;
    const cross = (r[b] - r[a]) * (r[c + 1] - r[b + 1]) - (r[b + 1] - r[a + 1]) * (r[c] - r[b]);
    if (Math.abs(cross) < 1e-6) continue;
    const s = Math.sign(cross);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

export interface BuildingStyle {
  h: number;
  top: number;
  wall: THREE.Color;
  roof: THREE.Color;
  roofShape: string;
  facade: number;
  ground: number;
  tower?: Tower;
  sign: boolean;
}

/** Resolves the look of a building from OSM data, its purpose and landmark overrides. */
export function resolveStyle(b: Building): BuildingStyle {
  const lm: LandmarkStyle = { ...(styleForUse(b) ?? {}), ...(LANDMARKS[b.id] ?? {}) };
  const h = lm.h ?? b.h;
  const top = b.top - b.h + h;
  const area = Math.abs(areaXZ(b.rings[0]));
  const cx = b.rings[0][0], cz = b.rings[0][1];
  const oldTown = Math.hypot(cx - OLD_TOWN.x, cz - OLD_TOWN.z) < OLD_TOWN.r;
  const levels = b.levels ?? h / 3;

  let facade: number = FACADE.plaster, group = 'residential';
  if (NO_WINDOWS.has(b.kind)) { facade = FACADE.blank; group = 'garage'; }
  else if (INDUSTRIAL.has(b.kind)) { facade = FACADE.industrial; group = 'industrial'; }
  else if (COMMERCIAL.has(b.kind)) { facade = area > 2500 ? FACADE.supermarket : oldTown ? FACADE.oldtown : FACADE.glass; group = 'commercial'; }
  else if (['church', 'chapel', 'cathedral'].includes(b.kind)) { facade = FACADE.ornate; group = 'oldtown'; }
  else if (levels >= 5 && !HOUSE.has(b.kind)) { facade = FACADE.panel; group = 'panel'; }
  else if (oldTown && !HOUSE.has(b.kind)) { facade = FACADE.oldtown; group = 'oldtown'; }
  let ground = facade;
  if (b.use && /^(shop:|amenity:(cafe|restaurant|pub|bar|fast_food|pharmacy|bank))/.test(b.use) && facade !== FACADE.supermarket) ground = FACADE.glass;
  if (facade === FACADE.glass && group === 'commercial' && !b.use) ground = FACADE.glass;
  facade = lm.facade ?? facade;
  ground = lm.groundFacade ?? ground;

  const wall = cssColor(lm.colour) ?? cssColor(b.colour) ?? new THREE.Color(pick(WALL_COLORS[group], b.id, 1));
  const shape = (lm.roof ?? b.roof ?? '').toLowerCase();
  const pitched = shape && shape !== 'flat';
  const roof = cssColor(lm.roofColour) ?? cssColor(b.roofColour)
    ?? new THREE.Color(pitched || HOUSE.has(b.kind) ? pick(PITCHED_ROOF_COLORS, b.id, 2) : pick(FLAT_ROOF_COLORS, b.id, 3));
  return { h, top, wall, roof, roofShape: shape, facade, ground, tower: lm.tower, sign: !!lm.sign };
}

export function buildBuildingsGeometry(buildings: Building[]): THREE.BufferGeometry | null {
  const B = new Builder();
  for (const b of buildings) addBuilding(B, b, resolveStyle(b));
  return B.build();
}

function addBuilding(B: Builder, b: Building, st: BuildingStyle) {
  const baseLevel = st.top - st.h;
  const bottom = b.minH > 0 ? baseLevel + b.minH : b.ground - 0.6;
  if (st.top - bottom < 1) return;
  B.facade = [st.facade, st.ground];
  const outer = b.rings[0];

  // Choose the roof form the footprint supports.
  const area = Math.abs(areaXZ(outer));
  let roofH = 0;
  let roof: 'gable' | 'hip' | 'pyramid' | 'inset' | 'flat' = 'flat';
  const rect = rectangle(b);
  const wantPitched = st.roofShape && st.roofShape !== 'flat';
  const implicit = !st.roofShape && (HOUSE.has(b.kind) || (PITCHABLE.has(b.kind) && st.h <= 12 && area < 400));
  if ((wantPitched || implicit) && b.minH <= 0 && st.h > 3.5) {
    if (rect && rect.short >= 3 && rect.short <= 26) {
      roofH = Math.min(rect.short * 0.5 * Math.tan(THREE.MathUtils.degToRad(st.roofShape === 'hipped' ? 30 : 36)), 7);
      roof = st.roofShape === 'hipped' || st.roofShape === 'half-hipped' ? 'hip' : st.roofShape === 'pyramidal' ? 'pyramid' : 'gable';
    } else if (b.rings.length === 1 && outer.length <= 24 && isConvex(outer)) {
      roofH = Math.min(Math.sqrt(area) * 0.32, 6);
      roof = 'pyramid';
    } else if (wantPitched && area > 80) {
      roofH = Math.min(3.5, st.h * 0.3);
      roof = 'inset';
    }
    if (st.top - roofH - baseLevel < 2.4) { roof = 'flat'; roofH = 0; }
  }
  const eave = st.top - roofH;

  addWalls(B, b, bottom, eave, baseLevel, st.wall);
  switch (roof) {
    case 'gable':
    case 'hip':
      addRectRoof(B, rect!, eave, st.top, roof === 'hip', st.wall, st.roof, baseLevel);
      break;
    case 'pyramid':
      addPyramidRoof(B, outer, eave, st.top, st.roof);
      break;
    case 'inset':
      addInsetRoof(B, b.rings, eave, st.top, st.roof);
      break;
    default:
      addFlatRoof(B, b.rings, st.top, st.roof);
  }
  if (st.tower) addTower(B, b, st, baseLevel);
}

function addWalls(B: Builder, b: Building, bottom: number, eave: number, baseLevel: number, color: THREE.Color) {
  const outer = b.rings[0];
  for (const ring of b.rings) {
    const ccw = areaXZ(ring) > 0;
    const isHole = ring !== outer;
    let dist = 0;
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const ax = ring[i], az = ring[i + 1], bx = ring[j], bz = ring[j + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      // For a CCW polygon (x right, z up), (dz, -dx) points outward; holes face inward.
      let nx = ccw ? bz - az : -(bz - az);
      let nz = ccw ? -(bx - ax) : bx - ax;
      if (isHole) { nx = -nx; nz = -nz; }
      // Whole bays only, so windows are not cut at corners.
      const bays = Math.max(1, Math.round(len / 3.2));
      const u0 = dist, u1 = dist + bays;
      const v0 = (bottom - baseLevel) / 3, v1 = (eave - baseLevel) / 3;
      B.quad(0, [ax, bottom, az], [bx, bottom, bz], [bx, eave, bz], [ax, eave, az], [u0, v0], [u1, v0], [u1, v1], [u0, v1], color, [nx, 0, nz]);
      dist += bays;
    }
  }
}

function toVec2(r: number[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < r.length; i += 2) out.push(new THREE.Vector2(r[i], r[i + 1]));
  return out;
}

function addFlatRoof(B: Builder, rings: number[][], y: number, color: THREE.Color) {
  const contour = toVec2(rings[0]);
  const holes = rings.slice(1).map(toVec2);
  const all = contour.concat(...holes);
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
    const p = (v: THREE.Vector2) => [v.x, y, v.y];
    B.tri(2, p(all[i]), p(all[j]), p(all[k]), [all[i].x / 4, all[i].y / 4], [all[j].x / 4, all[j].y / 4], [all[k].x / 4, all[k].y / 4], color, [0, 1, 0]);
  }
}

interface Rect {
  c: number[][]; // 4 corners [x, z]
  long: number; // index of a long edge
  short: number;
  length: number;
}

/** Recognises nearly rectangular single-ring footprints. */
function rectangle(b: Building): Rect | null {
  if (b.rings.length !== 1 || b.rings[0].length !== 8) return null;
  const r = b.rings[0];
  const c = [0, 1, 2, 3].map((i) => [r[i * 2], r[i * 2 + 1]]);
  const e = (i: number) => Math.hypot(c[(i + 1) % 4][0] - c[i][0], c[(i + 1) % 4][1] - c[i][1]);
  const w0 = (e(0) + e(2)) / 2, w1 = (e(1) + e(3)) / 2;
  if (Math.abs(areaXZ(r)) / (w0 * w1) < 0.88) return null;
  return { c, long: w0 >= w1 ? 0 : 1, short: Math.min(w0, w1), length: Math.max(w0, w1) };
}

function addRectRoof(B: Builder, p: Rect, eave: number, ridge: number, hip: boolean, wallColor: THREE.Color, roofColor: THREE.Color, baseLevel: number) {
  const c = p.c, k = p.long;
  const A = c[k], Bc = c[(k + 1) % 4], C = c[(k + 2) % 4], D = c[(k + 3) % 4];
  let r0 = [(D[0] + A[0]) / 2, (D[1] + A[1]) / 2];
  let r1 = [(Bc[0] + C[0]) / 2, (Bc[1] + C[1]) / 2];
  if (hip) {
    // Pull the ridge in by half the width at both ends.
    const ax = r1[0] - r0[0], az = r1[1] - r0[1], len = Math.hypot(ax, az) || 1;
    const inset = Math.min(p.short / 2, len / 2 - 0.01);
    r0 = [r0[0] + (ax / len) * inset, r0[1] + (az / len) * inset];
    r1 = [r1[0] - (ax / len) * inset, r1[1] - (az / len) * inset];
  }
  const P = (q: number[], y: number) => [q[0], y, q[1]];
  const cx = (A[0] + C[0]) / 2, cz = (A[1] + C[1]) / 2;
  const slope = Math.hypot(p.short / 2, ridge - eave);
  const uvLen = p.length / 4;
  const plane = (e0: number[], e1: number[], g1: number[], g0: number[]) => {
    const mx = (e0[0] + e1[0]) / 2 - cx, mz = (e0[1] + e1[1]) / 2 - cz;
    const want = [mx, Math.hypot(mx, mz), mz];
    B.quad(1, P(e0, eave), P(e1, eave), P(g1, ridge), P(g0, ridge), [0, 0], [uvLen, 0], [uvLen, slope / 4], [0, slope / 4], roofColor, want);
  };
  plane(A, Bc, r1, r0);
  plane(C, D, r0, r1);
  if (hip) {
    const end = (e0: number[], e1: number[], top: number[]) => {
      const want = [top[0] - cx, Math.hypot(top[0] - cx, top[1] - cz), top[1] - cz];
      const w = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]) / 4;
      B.tri(1, P(e0, eave), P(e1, eave), P(top, ridge), [0, 0], [w, 0], [w / 2, slope / 4], roofColor, want);
    };
    end(D, A, r0);
    end(Bc, C, r1);
  } else {
    const gable = (e0: number[], e1: number[], top: number[]) => {
      const want = [top[0] - cx, 0, top[1] - cz];
      const w = Math.max(1, Math.round(Math.hypot(e1[0] - e0[0], e1[1] - e0[1]) / 3.2));
      const v0 = (eave - baseLevel) / 3, v1 = (ridge - baseLevel) / 3;
      B.tri(0, P(e0, eave), P(e1, eave), P(top, ridge), [0, v0], [w, v0], [w / 2, v1], wallColor, want);
    };
    gable(D, A, r0);
    gable(Bc, C, r1);
  }
}

function addPyramidRoof(B: Builder, r: number[], eave: number, apex: number, color: THREE.Color) {
  let cx = 0, cz = 0;
  const n = r.length / 2;
  for (let i = 0; i < r.length; i += 2) { cx += r[i]; cz += r[i + 1]; }
  cx /= n; cz /= n;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    const mx = (r[i] + r[j]) / 2 - cx, mz = (r[i + 1] + r[j + 1]) / 2 - cz;
    const w = Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]) / 4;
    const s = Math.hypot(Math.hypot(mx, mz), apex - eave) / 4;
    B.tri(1, [r[i], eave, r[i + 1]], [r[j], eave, r[j + 1]], [cx, apex, cz], [0, 0], [w, 0], [w / 2, s], color, [mx, Math.hypot(mx, mz), mz]);
  }
}

/**
 * Approximates hipped/mansard roofs on complex footprints: every ring is offset inwards
 * (holes outwards), sloped faces join the eave to the offset ring and a flat cap closes it.
 */
function addInsetRoof(B: Builder, rings: number[][], eave: number, top: number, color: THREE.Color) {
  const d = Math.min(3.5, (top - eave) * 1.2);
  const insetRings: number[][] = [];
  rings.forEach((ring, ri) => {
    const ccw = areaXZ(ring) > 0;
    const sign = (ri === 0 ? 1 : -1) * (ccw ? 1 : -1); // + = towards the inside of the roof
    const n = ring.length / 2;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = (k: number) => [ring[((k + n) % n) * 2], ring[((k + n) % n) * 2 + 1]];
      const a = p(i - 1), b = p(i), c = p(i + 1);
      // Inward normals of the two edges meeting at b (left normal for CCW = inside).
      const n1 = norm([-(b[1] - a[1]), b[0] - a[0]]), n2 = norm([-(c[1] - b[1]), c[0] - b[0]]);
      let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const cos = Math.max(0.35, mx * n1[0] + mz * n1[1]); // limit spikes at sharp corners
      out.push(b[0] + (mx * d * sign) / cos, b[1] + (mz * d * sign) / cos);
    }
    insetRings.push(out);
  });
  // Sloped faces
  const up = (ax: number, az: number, bx: number, bz: number) => [bz - az, 0, -(bx - ax)];
  rings.forEach((ring, ri) => {
    const inner = insetRings[ri];
    const ccw = areaXZ(ring) > 0;
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      let w = up(ax, az, bx, bz);
      if (!ccw) w = [-w[0], 0, -w[2]];
      if (ri > 0) w = [-w[0], 0, -w[2]];
      const want = [w[0], Math.hypot(w[0], w[2]), w[2]];
      const len = Math.hypot(bx - ax, bz - az) / 4;
      B.quad(1, [ax, eave, az], [bx, eave, bz], [inner[j * 2], top, inner[j * 2 + 1]], [inner[i * 2], top, inner[i * 2 + 1]],
        [0, 0], [len, 0], [len, 1], [0, 1], color, want);
    }
  });
  addFlatRoof(B, insetRings, top, color.clone().multiplyScalar(0.92));
}

function norm(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/** Square tower with a pyramid spire at one end of the building's long axis. */
function addTower(B: Builder, b: Building, st: BuildingStyle, baseLevel: number) {
  const t = st.tower!;
  const r = b.rings[0];
  // Long axis from the oriented extent of the outer ring.
  let best = 0, ai = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    const l = Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]);
    if (l > best) { best = l; ai = i; }
  }
  const j = (ai + 2) % r.length;
  const ux = (r[j] - r[ai]) / best, uz = (r[j + 1] - r[ai + 1]) / best;
  let cx = 0, cz = 0, minP = Infinity, maxP = -Infinity;
  const n = r.length / 2;
  for (let i = 0; i < r.length; i += 2) { cx += r[i] / n; cz += r[i + 1] / n; }
  for (let i = 0; i < r.length; i += 2) {
    const p = (r[i] - cx) * ux + (r[i + 1] - cz) * uz;
    minP = Math.min(minP, p); maxP = Math.max(maxP, p);
  }
  const along = t.end === 0 ? minP + t.size / 2 : maxP - t.size / 2;
  const tx = cx + ux * along, tz = cz + uz * along;
  const hs = t.size / 2;
  const vx = -uz, vz = ux;
  const corner = (a: number, c: number) => [tx + ux * a * hs + vx * c * hs, tz + uz * a * hs + vz * c * hs];
  const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].flat();
  const tb: Building = { ...b, rings: [ring], minH: 0 };
  const eave = baseLevel + t.height;
  B.facade = [FACADE.ornate, FACADE.ornate];
  addWalls(B, tb, b.ground - 0.6, eave, baseLevel, st.wall);
  addPyramidRoof(B, ring, eave, eave + t.roofHeight, st.roof);
}
