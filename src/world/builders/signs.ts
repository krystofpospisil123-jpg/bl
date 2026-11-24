// Name signs on shops, amenities and landmarks. Each sign is a small box on the wall
// that faces the nearest street, with the name rendered to a canvas texture. Names are
// plain text without logos; real names can be swapped for generic ones (see config).
import * as THREE from 'three';
import type { ChunkData, Building, Pylon } from '../format.ts';
import { LANDMARKS, SIGN_USES, genericName } from '../landmarks.ts';
import { resolveStyle } from './buildings.ts';
import { settings } from '../../config.ts';

interface SignTheme {
  bg: string;
  fg: string;
  accent?: string;
  big?: boolean;
}

function themeFor(use: string): SignTheme {
  if (use === 'shop:supermarket' || use === 'shop:department_store') return { bg: '#f4f4f2', fg: '#1e2a36', accent: '#3a5f8a', big: true };
  if (use === 'amenity:pharmacy') return { bg: '#f7f7f5', fg: '#1d6b3a', accent: '#2c9a52' };
  if (use === 'amenity:bank') return { bg: '#22313f', fg: '#f2f2f2' };
  if (use === 'amenity:fuel') return { bg: '#f2f2f2', fg: '#333', accent: '#c8742a', big: true };
  if (/^amenity:(cafe|restaurant|pub|bar|fast_food|biergarten)/.test(use)) return { bg: '#3b2a20', fg: '#f3e2c4' };
  if (/^(historic|railway|man_made)|amenity:(townhall|courthouse|cinema)/.test(use)) return { bg: '#e9e1cf', fg: '#3a2f22' };
  if (use === 'amenity:police') return { bg: '#f2f2f2', fg: '#23406e' };
  return { bg: '#2c2f33', fg: '#f0f0f0' };
}

function signTexture(text: string, theme: SignTheme, aspect: number): THREE.CanvasTexture {
  const h = 96, w = Math.min(1024, Math.max(192, Math.round(h * aspect)));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = theme.bg;
  g.fillRect(0, 0, w, h);
  if (theme.accent) {
    g.fillStyle = theme.accent;
    g.fillRect(0, h - 10, w, 10);
  }
  g.fillStyle = theme.fg;
  let size = 60;
  g.font = `600 ${size}px "Inter", "Segoe UI", system-ui, sans-serif`;
  while (g.measureText(text).width > w - 30 && size > 18) {
    size -= 2;
    g.font = `600 ${size}px "Inter", "Segoe UI", system-ui, sans-serif`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 - (theme.accent ? 4 : 0));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function signText(b: Building): string | null {
  const lm = LANDMARKS[b.id];
  const label = lm?.label ?? b.label, use = lm?.use ?? b.use;
  if (!label || !use || !SIGN_USES.test(use)) return null;
  const commercial = /^(shop:|amenity:(cafe|restaurant|pub|bar|fast_food|pharmacy|bank|fuel|biergarten))/.test(use);
  if (commercial && !settings.realNames) return genericName(use) || null;
  return label;
}

/** Wall edge facing the nearest road: returns its endpoints and outward normal. */
function wallTowardRoad(b: Building, data: ChunkData, facing?: number) {
  const r = b.rings[0];
  let ccwArea = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) ccwArea += r[j] * r[i + 1] - r[i] * r[j + 1];
  const ccw = ccwArea > 0;
  let best: { ax: number; az: number; bx: number; bz: number; nx: number; nz: number; len: number } | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    const ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 3) continue;
    let nx = (bz - az) / len, nz = -(bx - ax) / len;
    if (!ccw) { nx = -nx; nz = -nz; }
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    // Distance from the wall midpoint to the nearest road point in front of it.
    let dRoad = 60;
    for (const road of data.roads) {
      if (road.w < 3.5 || road.tunnel) continue;
      const p = road.pts;
      for (let k = 0; k < p.length; k += 2) {
        const vx = p[k] - mx, vz = p[k + 1] - mz;
        if (vx * nx + vz * nz < 0) continue;
        dRoad = Math.min(dRoad, Math.hypot(vx, vz));
      }
    }
    // A landmark may name the facade (direction it faces): pick the longest wall facing that way.
    const score = facing !== undefined
      ? (nx * Math.sin(facing) + nz * Math.cos(facing) > 0.9 ? len : -Infinity)
      : -dRoad + Math.min(len, 20) * 0.3;
    if (score > bestScore) { bestScore = score; best = { ax, az, bx, bz, nx, nz, len }; }
  }
  return best;
}

const boardMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 });
const PYLON_THEME: SignTheme = { bg: '#f6f6f4', fg: '#22262a' };

/** Free-standing pylon: two posts in a frame, the main board on top, tenant panels below. */
function buildPylon(p: Pylon, ground: number, disposables: { dispose(): void }[]): THREE.Group {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.frame ?? '#8d9296'), roughness: 0.5, metalness: 0.3 });
  const w = p.board, depth = 0.5;
  const tenants = p.tenants ?? [];
  const panelH = 0.9;
  const frameGeo = new THREE.BoxGeometry(w + 0.4, p.height, depth);
  // Hollow-looking frame: a slim column per side and a cap, the boards fill the top part.
  const post = new THREE.BoxGeometry(0.35, p.height, depth);
  for (const sd of [-1, 1]) {
    const m = new THREE.Mesh(post, frameMat);
    m.position.set(sd * (w / 2 + 0.02), p.height / 2, 0);
    m.castShadow = true;
    g.add(m);
  }
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, 0.3, depth + 0.1), frameMat);
  cap.position.y = p.height + 0.15;
  g.add(cap);
  disposables.push(frameMat, frameGeo, post, cap.geometry);
  frameGeo.dispose();
  const real = settings.realNames;
  const boards: { text: string; h: number; y: number; main: boolean }[] = [{ text: real ? p.text : p.generic, h: w, y: p.height - w / 2 - 0.15, main: true }];
  let y = p.height - w - 0.3;
  for (const [t, gen] of tenants) {
    boards.push({ text: real ? t : gen, h: panelH, y: y - panelH / 2, main: false });
    y -= panelH + 0.12;
  }
  for (const b of boards) {
    const tex = signTexture(b.text, PYLON_THEME, b.main ? 1 : w / b.h);
    const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 });
    const geo = new THREE.BoxGeometry(w, b.h, depth - 0.05);
    const box = new THREE.Mesh(geo, boardMat);
    box.position.y = b.y;
    const faceGeo = new THREE.PlaneGeometry(w - 0.05, b.h - 0.05);
    for (const sd of [1, -1]) {
      const f = new THREE.Mesh(faceGeo, face);
      f.position.z = sd * (depth / 2 + 0.005);
      f.rotation.y = sd > 0 ? 0 : Math.PI;
      box.add(f);
    }
    box.castShadow = true;
    g.add(box);
    disposables.push(tex, face, geo, faceGeo);
  }
  g.position.set(p.x, ground - 0.2, p.z);
  g.rotation.y = p.yaw;
  return g;
}

/** A shop the player can walk into: a door point in front of its main facade. */
export interface StoreEntrance {
  id: number;
  name: string;
  /** Door position on the pavement and the outward direction of the facade. */
  x: number;
  z: number;
  nx: number;
  nz: number;
}

const STORE_USES = /^shop:(supermarket|department_store|doityourself|furniture|mall)$/;
/** Buildings tagged as stores that are not walk-in shops in the game. */
const NOT_STORES = new Set([253796332]);

/** Walk-in stores of a chunk (big shops: supermarkets, department and DIY stores). */
export function storeEntrances(data: ChunkData): StoreEntrance[] {
  const out: StoreEntrance[] = [];
  for (const b of data.buildings) {
    const use = LANDMARKS[b.id]?.use ?? b.use ?? '';
    if (!STORE_USES.test(use) || NOT_STORES.has(b.id)) continue;
    const name = LANDMARKS[b.id]?.label ?? b.label ?? genericName(use);
    const st = resolveStyle(b);
    const wall = wallTowardRoad(b, data, st.signFacing);
    if (!wall) continue;
    const mx = (wall.ax + wall.bx) / 2, mz = (wall.az + wall.bz) / 2;
    out.push({ id: b.id, name, x: mx + wall.nx * 0.9, z: mz + wall.nz * 0.9, nx: wall.nx, nz: wall.nz });
  }
  return out;
}

export function buildSigns(data: ChunkData, groundAt?: (x: number, z: number) => number): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  if (groundAt) for (const p of data.pylons ?? []) group.add(buildPylon(p, groundAt(p.x, p.z), disposables));
  for (const b of data.buildings) {
    const text = signText(b);
    if (!text) continue;
    const st = resolveStyle(b);
    const wall = wallTowardRoad(b, data, st.signFacing);
    if (!wall) continue;
    const theme = themeFor(LANDMARKS[b.id]?.use ?? b.use!);
    const height = theme.big ? 1.6 : 0.85;
    const width = Math.min(wall.len * 0.8, Math.max(2.4, text.length * height * 0.55), theme.big ? 16 : 8);
    const tex = signTexture(text, theme, width / height);
    const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 });
    // Board (one draw call) with the printed face as a plane just in front of it.
    const geo = new THREE.BoxGeometry(width + 0.08, height + 0.08, 0.12);
    const mesh = new THREE.Mesh(geo, boardMat);
    const faceGeo = new THREE.PlaneGeometry(width, height);
    const faceMesh = new THREE.Mesh(faceGeo, face);
    faceMesh.position.z = 0.065;
    mesh.add(faceMesh);
    disposables.push(faceGeo);
    const baseLevel = st.top - st.h;
    // Shop signs above the ground floor; big stores near the top of the facade.
    const y = theme.big ? Math.max(baseLevel + 3.8, st.top - height / 2 - 0.6) : Math.min(baseLevel + 3.4, st.top - height);
    const mx = (wall.ax + wall.bx) / 2 + wall.nx * 0.08, mz = (wall.az + wall.bz) / 2 + wall.nz * 0.08;
    mesh.position.set(mx, y, mz);
    mesh.rotation.y = Math.atan2(wall.nx, wall.nz);
    mesh.castShadow = true;
    group.add(mesh);
    disposables.push(geo, tex, face);
  }
  return { group, dispose: () => disposables.forEach((d) => d.dispose()) };
}
