// 3D details on buildings, shown only near the viewer (one merged mesh per chunk, vertex
// colours): a darker plinth at the ground, cornices or a parapet with coping at the top,
// string courses between floors on old houses, fascia boards and gutters along pitched eaves,
// downpipes at corners, balconies on panel and 1950s blocks (on exactly the bays the facade
// atlas paints as balconies), chimneys, roof windows and dormers on houses, equipment on flat
// roofs, and striped awnings over shop windows.
import * as THREE from 'three';
import type { Building, ChunkData } from '../format.ts';
import { resolveStyle, roofPlan, areaXZ, hash, type BuildingStyle, type RoofPlan } from './buildings.ts';
import { FACADE, isBalconyBay, PANEL_ACCENTS } from '../../render/facades.ts';

type V3 = [number, number, number];

class Mesher {
  static bad = 0;
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];

  private face(a: V3, b: V3, c: V3, d: V3, n: V3, color: THREE.Color) {
    for (const p of [a, b, c, a, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(color.r, color.g, color.b);
    }
  }

  /** Oriented box: centre `o`, half axes `ax`, `ay`, `az` (any orthogonal vectors). */
  box(o: V3, ax: V3, ay: V3, az: V3, color: THREE.Color, skipBottom = true) {
    if (![...o, ...ax, ...ay, ...az].every(Number.isFinite)) {
      Mesher.bad++;
      return;
    }
    // Faces below assume a right-handed set of axes; a box is symmetric, so flip one if needed.
    const cx = ax[1] * ay[2] - ax[2] * ay[1], cy = ax[2] * ay[0] - ax[0] * ay[2], cz = ax[0] * ay[1] - ax[1] * ay[0];
    if (cx * az[0] + cy * az[1] + cz * az[2] < 0) az = [-az[0], -az[1], -az[2]];
    const P = (sx: number, sy: number, sz: number): V3 => [
      o[0] + ax[0] * sx + ay[0] * sy + az[0] * sz, o[1] + ax[1] * sx + ay[1] * sy + az[1] * sz, o[2] + ax[2] * sx + ay[2] * sy + az[2] * sz,
    ];
    const nrm = (v: V3, s: number): V3 => {
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [(v[0] / l) * s, (v[1] / l) * s, (v[2] / l) * s];
    };
    // Each face listed counter-clockwise when seen from outside.
    this.face(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), nrm(ax, 1), color);
    this.face(P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), P(-1, -1, -1), nrm(ax, -1), color);
    this.face(P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), nrm(ay, 1), color);
    if (!skipBottom) this.face(P(-1, -1, 1), P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), nrm(ay, -1), color);
    this.face(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), nrm(az, 1), color);
    this.face(P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), nrm(az, -1), color);
  }

  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const col = (hex: number) => new THREE.Color(hex);
const scale = (c: THREE.Color, k: number) => c.clone().multiplyScalar(k);
const STONE = col(0x8d8a84), METAL = col(0x7d8186), DARK = col(0x3a3836), GLASS = col(0x26323e), WHITE = col(0xe8e6e0), BRICK = col(0x8a4a3a);
const AWNINGS: [number, number][] = [[0xb3262a, 0xf0ece2], [0x2f6b3a, 0xf0ece2], [0x1f4f8a, 0xf0ece2], [0xd9822b, 0xf4efe4], [0x6a1f3a, 0xe8e0d0], [0x3a3a3a, 0xd8d4c8]];

interface Edge { ax: number; az: number; bx: number; bz: number; len: number; tx: number; tz: number; nx: number; nz: number; cell0: number; bays: number; hidden?: boolean }

/** Outer wall edges with direction, outward normal and the first facade bay index. */
function edges(b: Building, bayW: number, eave: number): Edge[] {
  const out: Edge[] = [];
  const r = b.rings[0];
  const ccw = areaXZ(r) > 0;
  let dist = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    const ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    const nx = ccw ? tz : -tz, nz = ccw ? -tx : tx;
    const bays = Math.max(1, Math.round(len / bayW));
    // A wall with another building right in front of it is shared or hidden: no details there.
    const probe = (t: number) => covered(ax + (bx - ax) * t + nx * 0.4, az + (bz - az) * t + nz * 0.4, b.id);
    // Or the wall runs inside a building at least as tall (a part inside a bigger outline).
    const within = covered(ax + (bx - ax) * 0.5 - nx * 0.3, az + (bz - az) * 0.5 - nz * 0.3, b.id, eave - 0.3);
    const hidden = probe(0.5) || (probe(0.2) && probe(0.8)) || within;
    out.push({ ax, az, bx, bz, len, tx, tz, nx, nz, cell0: dist, bays, hidden });
    dist += bays;
  }
  return out;
}

function inside(r: number[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if ((r[i + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
  }
  return c;
}

/** Wall facing the nearest road (for awnings). */
function frontEdge(es: Edge[], data: ChunkData): Edge | null {
  let best: Edge | null = null, bs = -Infinity;
  for (const e of es) {
    if (e.len < 3 || e.hidden) continue;
    const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2;
    let d = 40;
    for (const road of data.roads) {
      if (road.w < 3.5 || road.tunnel) continue;
      const p = road.pts;
      for (let k = 0; k < p.length; k += 2) {
        const vx = p[k] - mx, vz = p[k + 1] - mz;
        if (vx * e.nx + vz * e.nz < 0) continue;
        d = Math.min(d, Math.hypot(vx, vz));
      }
    }
    const s = -d + Math.min(e.len, 20) * 0.3;
    if (s > bs) { bs = s; best = e; }
  }
  return best;
}

/** A strip box along a wall edge: from height y0 to y1, sticking out `out` (centre offset `off`). */
function strip(M: Mesher, e: Edge, y0: number, y1: number, off: number, depth: number, color: THREE.Color, extend = 0) {
  const mx = (e.ax + e.bx) / 2 + e.nx * off, mz = (e.az + e.bz) / 2 + e.nz * off;
  M.box([mx, (y0 + y1) / 2, mz], [e.tx * (e.len / 2 + extend), 0, e.tz * (e.len / 2 + extend)], [0, (y1 - y0) / 2, 0], [e.nx * depth / 2, 0, e.nz * depth / 2], color);
}

export function badDetailCount() {
  return Mesher.bad;
}

/** Footprints of the chunk's buildings, for "is this wall covered by a neighbour" tests. */
interface Cover { r: number[]; minX: number; maxX: number; minZ: number; maxZ: number; id: number; top: number }
let covers: Cover[] = [];

/** True if (x, z) lies inside another building's footprint (a shared or hidden wall). */
function covered(x: number, z: number, self: number, minTop = -Infinity): boolean {
  for (const c of covers) {
    if (c.id === self || c.top < minTop || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
    if (inside(c.r, x, z)) return true;
  }
  return false;
}

export function buildBuildingDetails(data: ChunkData): THREE.BufferGeometry | null {
  const M = new Mesher();
  covers = data.buildings.filter((b) => b.rings[0]?.length >= 6).map((b) => {
    const r = b.rings[0];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < r.length; i += 2) { minX = Math.min(minX, r[i]); maxX = Math.max(maxX, r[i]); minZ = Math.min(minZ, r[i + 1]); maxZ = Math.max(maxZ, r[i + 1]); }
    return { r, minX, maxX, minZ, maxZ, id: b.id, top: b.top };
  });
  for (const b of data.buildings) {
    if (!b.rings[0] || b.rings[0].length < 6) continue;
    const st = resolveStyle(b);
    const plan = roofPlan(b, st);
    if (st.top - plan.bottom < 2) continue;
    try {
      addDetails(M, b, st, plan, data);
    } catch {
      /* odd footprint: skip its details */
    }
  }
  return M.build();
}

function addDetails(M: Mesher, b: Building, st: BuildingStyle, plan: RoofPlan, data: ChunkData) {
  const { baseLevel, eave, roof, rect } = plan;
  const es = edges(b, st.bayW, eave);
  const wall = st.wall;
  const h = (s: number) => hash(b.id, s);
  const garage = st.facade === FACADE.blank;
  const old = st.facade === FACADE.oldtown || st.facade === FACADE.civic || st.facade === FACADE.castle || st.facade === FACADE.ornate;
  const tall = st.h >= 5;

  const shopfront = st.ground === FACADE.glass || st.ground === FACADE.supermarket;
  for (const e of es) {
    if (e.len < 1.2 || e.hidden) continue;
    // Plinth (sokl): a darker band at the bottom of the walls (low under shop windows).
    if (!garage && b.minH <= 0) strip(M, e, b.ground - 0.5, baseLevel + (shopfront ? 0.12 : old ? 0.8 : 0.4), 0.03, 0.08, old ? STONE : scale(wall, 0.62), 0.04);
    // String course between the ground floor and the first floor on old houses.
    if (old && b.minH <= 0 && st.h > st.floorH * 1.6) strip(M, e, baseLevel + st.floorH - 0.08, baseLevel + st.floorH + 0.1, 0.05, 0.12, scale(wall, 1.08), 0.06);
  }

  // Top of the walls: cornice, parapet with coping, or fascia and gutter under pitched eaves.
  if (roof === 'flat' && tall && !garage) {
    for (const e of es) {
      if (e.len < 1 || e.hidden) continue;
      strip(M, e, eave, eave + 0.5, -0.12, 0.24, scale(wall, 0.9), 0.0);
      strip(M, e, eave + 0.5, eave + 0.58, -0.08, 0.38, WHITE.clone().lerp(STONE, 0.4), 0.02);
      if (old || st.facade === FACADE.sorela) strip(M, e, eave - 0.35, eave - 0.05, 0.1, 0.22, scale(wall, 1.1), 0.1);
    }
  } else if ((roof === 'gable' || roof === 'hip') && rect) {
    const c = rect.c, k = rect.long;
    const longEdges = roof === 'hip' ? [0, 1, 2, 3] : [k, (k + 2) % 4];
    for (const i of longEdges) {
      const a = c[i], bb = c[(i + 1) % 4];
      const len = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
      const tx = (bb[0] - a[0]) / len, tz = (bb[1] - a[1]) / len;
      // Outward normal: away from the rectangle centre.
      const cx = (c[0][0] + c[2][0]) / 2, cz = (c[0][1] + c[2][1]) / 2;
      let nx = tz, nz = -tx;
      if (nx * ((a[0] + bb[0]) / 2 - cx) + nz * ((a[1] + bb[1]) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
      const ed: Edge = { ax: a[0], az: a[1], bx: bb[0], bz: bb[1], len, tx, tz, nx, nz, cell0: 0, bays: 1 };
      strip(M, ed, eave - 0.22, eave, 0.08, 0.16, old ? scale(wall, 1.05) : col(0x5a4636), 0.2);
      strip(M, ed, eave - 0.12, eave + 0.02, 0.26, 0.14, METAL, 0.15);
    }
  } else if (tall && !garage) {
    for (const e of es) if (e.len > 1 && !e.hidden) strip(M, e, eave - 0.25, eave, 0.08, 0.16, scale(wall, 1.06), 0.08);
  }

  // Downpipes at up to four convex corners.
  if (st.h >= 4 && !garage) {
    const r = b.rings[0];
    const ccw = areaXZ(r) > 0;
    const n = r.length / 2;
    let added = 0;
    for (let i = 0; i < n && added < 4; i++) {
      const p = (k: number) => [r[((k + n) % n) * 2], r[((k + n) % n) * 2 + 1]];
      const a = p(i - 1), q = p(i), c = p(i + 1);
      const cross = (q[0] - a[0]) * (c[1] - q[1]) - (q[1] - a[1]) * (c[0] - q[0]);
      if ((cross > 0) !== ccw || Math.hypot(q[0] - a[0], q[1] - a[1]) < 4 || covered(q[0], q[1], b.id)) continue;
      if (h(40 + i) > 0.55 && added > 0) continue;
      // Just outside the corner, along the bisector of the two outward normals.
      const e1 = [q[0] - a[0], q[1] - a[1]], e2 = [c[0] - q[0], c[1] - q[1]];
      const l1 = Math.hypot(e1[0], e1[1]), l2 = Math.hypot(e2[0], e2[1]);
      if (l1 < 0.05 || l2 < 0.05) continue;
      const s = ccw ? 1 : -1;
      const n1 = [(e1[1] / l1) * s, (-e1[0] / l1) * s], n2 = [(e2[1] / l2) * s, (-e2[0] / l2) * s];
      // Corner inside a taller building (this one is a part hidden in a bigger outline): no pipe.
      if (covered(q[0] - (n1[0] + n2[0]) * 0.3, q[1] - (n1[1] + n2[1]) * 0.3, b.id, eave - 0.3)) continue;
      const ox = q[0] + (n1[0] + n2[0]) * 0.09 - (e1[0] / l1) * 0.25, oz = q[1] + (n1[1] + n2[1]) * 0.09 - (e1[1] / l1) * 0.25;
      const top = roof === 'flat' ? eave + 0.4 : eave;
      M.box([ox, (b.ground + top) / 2, oz], [0.045, 0, 0], [0, (top - b.ground) / 2, 0], [0, 0, 0.045], old ? col(0x5a4a40) : METAL);
      added++;
    }
  }

  // Balconies on panel and 1950s blocks: exactly on the bays the facade shader paints as balconies.
  if ((st.facade === FACADE.panel || st.facade === FACADE.sorela) && st.h > st.floorH * 2) {
    const accent = col(PANEL_ACCENTS[Math.floor(st.seed * PANEL_ACCENTS.length) % PANEL_ACCENTS.length]);
    // Panel blocks: coloured or light panels; 1950s blocks: a plastered parapet like the walls.
    const rail = st.facade === FACADE.panel ? (st.seed > 0.22 ? accent : col(0xd9d6cf)) : scale(wall, 1.04);
    const floors = Math.floor((eave - baseLevel) / st.floorH);
    for (const e of es) {
      const bw = e.len / e.bays;
      if (bw < 2.2 || e.hidden) continue;
      for (let k = 0; k < e.bays; k++) {
        if (!isBalconyBay(e.cell0 + k, st.facade, st.seed)) continue;
        const t = (k + 0.5) * bw;
        const cx = e.ax + e.tx * t, cz = e.az + e.tz * t;
        const w = bw * (st.facade === FACADE.panel ? 0.42 : 0.34), depth = st.facade === FACADE.panel ? 1.1 : 0.7;
        for (let f = 1; f < floors; f++) {
          const y = baseLevel + f * st.floorH;
          if (y + 1.1 > eave) break;
          const ox = cx + e.nx * depth / 2, oz = cz + e.nz * depth / 2;
          // Slab, front parapet / railing and the two sides.
          M.box([ox, y + 0.06, oz], [e.tx * w, 0, e.tz * w], [0, 0.08, 0], [e.nx * depth / 2, 0, e.nz * depth / 2], col(0xbdb9b0), false);
          M.box([cx + e.nx * (depth - 0.03), y + 0.6, cz + e.nz * (depth - 0.03)], [e.tx * w, 0, e.tz * w], [0, 0.45, 0], [e.nx * 0.03, 0, e.nz * 0.03], rail, false);
          for (const s of [-1, 1]) {
            M.box([ox + e.tx * w * s, y + 0.6, oz + e.tz * w * s], [e.tx * 0.03, 0, e.tz * 0.03], [0, 0.45, 0], [e.nx * depth / 2, 0, e.nz * depth / 2], rail, false);
          }
        }
      }
    }
  }

  // Pitched roofs of houses: chimneys, roof windows, a dormer on bigger roofs.
  if ((roof === 'gable' || roof === 'hip') && rect && plan.roofH > 1.2) {
    const c = rect.c, k = rect.long;
    const A = c[k], B = c[(k + 1) % 4], D = c[(k + 3) % 4];
    const along = [B[0] - A[0], B[1] - A[1]], across = [D[0] - A[0], D[1] - A[1]];
    const L = Math.hypot(along[0], along[1]), W = Math.hypot(across[0], across[1]);
    const ux = along[0] / L, uz = along[1] / L, vx = across[0] / W, vz = across[1] / W;
    const at = (s: number, t: number) => [A[0] + ux * s + vx * t, A[1] + uz * s + vz * t];
    const slope = plan.roofH / (W / 2);
    const roofY = (t: number) => eave + Math.min(t, W - t) * slope;
    // Chimneys (1 on houses, more on long roofs).
    const nCh = st.house ? 1 : Math.min(3, Math.max(1, Math.round(L / 10)));
    for (let i = 0; i < nCh; i++) {
      const s = L * ((i + 0.5) / nCh) + (h(50 + i) - 0.5) * L * 0.2;
      const t = W / 2 + (h(51 + i) > 0.5 ? 1 : -1) * Math.min(1.1, W * 0.18);
      const [x, z] = at(s, t);
      const y0 = roofY(t) - 0.4, y1 = eave + plan.roofH + 0.7;
      M.box([x, (y0 + y1) / 2, z], [ux * 0.28, 0, uz * 0.28], [0, (y1 - y0) / 2, 0], [vx * 0.28, 0, vz * 0.28], h(52) > 0.5 ? BRICK : scale(wall, 0.85));
      M.box([x, y1 + 0.04, z], [ux * 0.34, 0, uz * 0.34], [0, 0.05, 0], [vx * 0.34, 0, vz * 0.34], DARK);
    }
    // Roof windows lying on the slopes.
    const nWin = Math.min(4, Math.floor(L / 4));
    for (let i = 0; i < nWin; i++) {
      if (h(60 + i) < 0.45) continue;
      const side = h(61 + i) > 0.5;
      const s = L * ((i + 0.5) / nWin);
      const t = side ? W * 0.3 : W * 0.7;
      const [x, z] = at(s, t);
      const y = roofY(t) + 0.03;
      // Axes: along the ridge, up the slope, roof normal.
      const dir = side ? 1 : -1;
      const sl = [vx * dir, slope, vz * dir], sll = Math.hypot(sl[0], sl[1], sl[2]);
      const up: V3 = [sl[0] / sll, sl[1] / sll, sl[2] / sll];
      const nrm: V3 = [-vx * dir * slope / sll, 1 / sll, -vz * dir * slope / sll];
      M.box([x, y, z], [ux * 0.4, 0, uz * 0.4], [up[0] * 0.55, up[1] * 0.55, up[2] * 0.55], [nrm[0] * 0.04, nrm[1] * 0.04, nrm[2] * 0.04], col(0x5a5c60));
      M.box([x + nrm[0] * 0.03, y + nrm[1] * 0.03, z + nrm[2] * 0.03], [ux * 0.33, 0, uz * 0.33], [up[0] * 0.47, up[1] * 0.47, up[2] * 0.47], [nrm[0] * 0.02, nrm[1] * 0.02, nrm[2] * 0.02], GLASS);
    }
    // Dormer on bigger house roofs (on the side facing away from A–B is fine either way).
    if (st.house && L >= 9 && plan.roofH >= 2.4 && h(70) > 0.35) {
      const s = L / 2, t0 = 1.0;
      const [fx, fz] = at(s, t0);
      const yb = roofY(t0), depth = 1.8, hgt = 1.3;
      const nx = -vx, nz = -vz; // facing out over the A–B eave
      const cx = fx - nx * depth / 2, cz = fz - nz * depth / 2;
      M.box([cx, yb + hgt / 2, cz], [ux * 0.9, 0, uz * 0.9], [0, hgt / 2, 0], [nx * depth / 2, 0, nz * depth / 2], wall);
      M.box([cx - nx * 0.05, yb + hgt + 0.06, cz - nz * 0.05], [ux * 1.05, 0, uz * 1.05], [0, 0.07, 0], [nx * (depth / 2 + 0.15), 0, nz * (depth / 2 + 0.15)], st.roof);
      M.box([fx + nx * 0.01, yb + hgt * 0.5, fz + nz * 0.01], [ux * 0.5, 0, uz * 0.5], [0, 0.42, 0], [nx * 0.02, 0, nz * 0.02], WHITE);
      M.box([fx + nx * 0.03, yb + hgt * 0.5, fz + nz * 0.03], [ux * 0.42, 0, uz * 0.42], [0, 0.35, 0], [nx * 0.015, 0, nz * 0.015], GLASS);
    }
  }

  // Flat roofs: air-conditioning boxes, vents; a lift machine room on tall blocks.
  if (roof === 'flat' && tall) {
    const r = b.rings[0];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, cx = 0, cz = 0;
    for (let i = 0; i < r.length; i += 2) {
      minX = Math.min(minX, r[i]); maxX = Math.max(maxX, r[i]); minZ = Math.min(minZ, r[i + 1]); maxZ = Math.max(maxZ, r[i + 1]);
      cx += r[i] / (r.length / 2); cz += r[i + 1] / (r.length / 2);
    }
    const area = Math.abs(areaXZ(r));
    const top = st.top;
    if (st.h >= 18 && inside(r, cx, cz)) {
      M.box([cx, top + 1.3, cz], [1.6, 0, 0], [0, 1.3, 0], [0, 0, 1.4], scale(wall, 0.92));
      M.box([cx, top + 2.65, cz], [1.75, 0, 0], [0, 0.06, 0], [0, 0, 1.55], col(0x9a9894));
    }
    const units = Math.min(6, Math.floor(area / 120));
    for (let i = 0; i < units; i++) {
      const x = minX + (maxX - minX) * (0.15 + h(80 + i) * 0.7), z = minZ + (maxZ - minZ) * (0.15 + h(90 + i) * 0.7);
      if (!inside(r, x, z) || !inside(r, x + 1.2, z) || !inside(r, x - 1.2, z) || !inside(r, x, z + 1.2) || !inside(r, x, z - 1.2)) continue;
      if (h(100 + i) > 0.5) M.box([x, top + 0.45, z], [0.55, 0, 0], [0, 0.45, 0], [0, 0, 0.45], col(0xbfc2c4));
      else M.box([x, top + 0.5, z], [0.12, 0, 0], [0, 0.5, 0], [0, 0, 0.12], METAL);
    }
  }

  // Shops: a striped awning over the ground floor on the street side.
  if (b.use && /^(shop:|amenity:(cafe|restaurant|pub|bar|fast_food|pharmacy|ice_cream))/.test(b.use) && b.minH <= 0) {
    const e = frontEdge(es, data);
    if (e && e.len >= 3) {
      const [c1, c2] = AWNINGS[Math.floor(h(110) * AWNINGS.length)].map(col);
      const width = Math.min(e.len * 0.8, 9), stripes = Math.max(4, Math.round(width / 0.45));
      const sw = width / stripes, depth = 1.3, yTop = baseLevel + Math.min(3.0, st.floorH * 0.95), drop = 0.45;
      const mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2;
      const sl = Math.hypot(depth, drop);
      const ay: V3 = [e.nx * depth / sl, -drop / sl, e.nz * depth / sl];
      const az: V3 = [e.nx * drop / sl, depth / sl, e.nz * drop / sl];
      for (let i = 0; i < stripes; i++) {
        const t = -width / 2 + (i + 0.5) * sw;
        const o: V3 = [mx + e.tx * t + e.nx * depth / 2, yTop - drop / 2, mz + e.tz * t + e.nz * depth / 2];
        M.box(o, [e.tx * sw / 2, 0, e.tz * sw / 2], [ay[0] * sl / 2, ay[1] * sl / 2, ay[2] * sl / 2], [az[0] * 0.02, az[1] * 0.02, az[2] * 0.02], i % 2 ? c2 : c1, false);
        // Valance (front flap).
        M.box([mx + e.tx * t + e.nx * depth, yTop - drop - 0.14, mz + e.tz * t + e.nz * depth], [e.tx * sw / 2, 0, e.tz * sw / 2], [0, 0.14, 0], [e.nx * 0.015, 0, e.nz * 0.015], i % 2 ? c2 : c1, false);
      }
    }
  }
}
