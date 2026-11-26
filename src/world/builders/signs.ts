// Name signs on shops, amenities and landmarks. Each sign is a small box on the wall
// that faces the nearest street, with the name rendered to a canvas texture. Names are
// plain text without logos; real names can be swapped for generic ones (see config).
import * as THREE from 'three';
import type { ChunkData, Building, Pylon } from '../format.ts';
import { LANDMARKS, SIGN_USES, genericName } from '../landmarks.ts';
import { resolveStyle } from './buildings.ts';
import { settings } from '../../config.ts';
import { brandFor } from './brands.ts';

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
  const brand = brandFor(text);
  // Logos get a bigger canvas so they stay crisp (square boards stay square).
  const h = brand ? 256 : 96, w = Math.min(1024, Math.max(brand ? 256 : 192, Math.round(h * aspect)));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  if (brand) {
    brand.draw(g, w, h);
    const bt = new THREE.CanvasTexture(c);
    bt.colorSpace = THREE.SRGBColorSpace;
    bt.anisotropy = 8;
    return bt;
  }
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
  /** Walk-in store (gun counter), a tuning garage you drive into, or the night club. */
  kind: 'store' | 'garage' | 'club';
  /** Door position on the pavement and the outward direction of the facade. */
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/** The three walk-in stores with a gun counter: Kaufland, Lidl and Penny (OSM building ids). */
const GUN_STORES = new Set([253791835, 1280153528, 254004784]);
/** Car repair shops that work as tuning garages. */
const GARAGES: Record<number, string> = { 253879043: 'Tuning Blansko', 253791939: 'Tuning Poříčí' };

/** The night club (an unnamed building near the square, OSM id) and its name. */
export const CLUB_BUILDING = 253879015;
export const CLUB_NAME = 'Velvet Club';

/** Walk-in stores of a chunk. */
export function storeEntrances(data: ChunkData): StoreEntrance[] {
  const out: StoreEntrance[] = [];
  for (const b of data.buildings) {
    const garage = GARAGES[b.id];
    if (b.id === CLUB_BUILDING) {
      const wall = wallTowardRoad(b, data);
      if (!wall) continue;
      const mx = (wall.ax + wall.bx) / 2, mz = (wall.az + wall.bz) / 2;
      out.push({ id: b.id, name: CLUB_NAME, kind: 'club', x: mx + wall.nx * 0.9, z: mz + wall.nz * 0.9, nx: wall.nx, nz: wall.nz });
      continue;
    }
    if (!GUN_STORES.has(b.id) && !garage) continue;
    const use = LANDMARKS[b.id]?.use ?? b.use ?? '';
    const name = garage ?? LANDMARKS[b.id]?.label ?? b.label ?? genericName(use);
    const st = resolveStyle(b);
    const wall = wallTowardRoad(b, data, st.signFacing);
    if (!wall) continue;
    const mx = (wall.ax + wall.bx) / 2, mz = (wall.az + wall.bz) / 2;
    const off = garage ? 3.2 : 0.9; // a car needs room in front of the garage door
    out.push({ id: b.id, name, kind: garage ? 'garage' : 'store', x: mx + wall.nx * off, z: mz + wall.nz * off, nx: wall.nx, nz: wall.nz });
  }
  return out;
}

export function buildSigns(data: ChunkData, groundAt?: (x: number, z: number) => number): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  if (groundAt) for (const p of data.pylons ?? []) group.add(buildPylon(p, groundAt(p.x, p.z), disposables));
  for (const b of data.buildings) {
    if (b.id === CLUB_BUILDING) {
      const wall = wallTowardRoad(b, data);
      if (wall) group.add(buildClubFront(wall, resolveStyle(b), disposables));
      continue;
    }
    const text = signText(b);
    if (!text) continue;
    const st = resolveStyle(b);
    const wall = wallTowardRoad(b, data, st.signFacing);
    if (!wall) continue;
    const theme = themeFor(LANDMARKS[b.id]?.use ?? b.use!);
    const height = theme.big ? 1.6 : 0.85;
    const width = Math.min(wall.len * 0.8, Math.max(2.4, text.length * height * 0.55), theme.big ? 16 : 8);
    const tex = signTexture(text, theme, brandFor(text) ? Math.min(width / height, 5) : width / height);
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

/** Night club facade: glowing neon name, a black canopy with lights and a lit doorway. */
function buildClubFront(
  wall: { ax: number; az: number; bx: number; bz: number; nx: number; nz: number; len: number },
  st: { top: number; h: number },
  disposables: { dispose(): void }[],
): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 320;
  const x = c.getContext('2d')!;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const line = (text: string, y: number, size: number, color: string) => {
    x.font = `italic 800 ${size}px "Brush Script MT", "Segoe Script", cursive, system-ui`;
    x.shadowColor = color;
    for (const blur of [44, 24, 10]) {
      x.shadowBlur = blur;
      x.fillStyle = color;
      x.fillText(text, 512, y);
    }
    x.shadowBlur = 3;
    x.fillStyle = '#fff4fa';
    x.fillText(text, 512, y);
  };
  line('Velvet', 120, 190, '#ff2fa8');
  line('NIGHT CLUB', 255, 70, '#8a6bff');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const signMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false });
  const signGeo = new THREE.PlaneGeometry(4.2, 1.31);
  const base = st.top - st.h;
  const sign = new THREE.Mesh(signGeo, signMat);
  sign.position.set(0, Math.min(base + 4.4, st.top - 0.8), 0.12);
  // Canopy over the door with a row of small lights, glowing door, two little bushes.
  const black = new THREE.MeshStandardMaterial({ color: 0x0c0a0e, roughness: 0.4 });
  const canopyGeo = new THREE.BoxGeometry(3.2, 0.14, 1.5);
  const canopy = new THREE.Mesh(canopyGeo, black);
  canopy.position.set(0, base + 2.85, 0.75);
  canopy.castShadow = true;
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
  const bulbGeo = new THREE.SphereGeometry(0.035, 6, 4);
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Mesh(bulbGeo, bulbMat);
    b.position.set(-1.5 + i * 0.375, base + 2.77, 1.48);
    g.add(b);
  }
  const doorGeo = new THREE.PlaneGeometry(1.6, 2.4);
  const doorMat = new THREE.MeshBasicMaterial({ color: 0x5a1a4a, toneMapped: false });
  const door = new THREE.Mesh(doorGeo, doorMat);
  door.position.set(0, base + 1.2, 0.06);
  const frameGeo = new THREE.BoxGeometry(1.9, 2.6, 0.08);
  const frame = new THREE.Mesh(frameGeo, black);
  frame.position.set(0, base + 1.3, 0.03);
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xff2fa8, toneMapped: false });
  const stripeGeo = new THREE.BoxGeometry(0.04, 2.5, 0.04);
  for (const sx of [-0.92, 0.92]) {
    const s = new THREE.Mesh(stripeGeo, stripeMat);
    s.position.set(sx, base + 1.27, 0.09);
    g.add(s);
  }
  // Red carpet.
  const carpetGeo = new THREE.PlaneGeometry(1.4, 2.6).rotateX(-Math.PI / 2);
  const carpet = new THREE.Mesh(carpetGeo, new THREE.MeshStandardMaterial({ color: 0x7a0a1e, roughness: 0.9 }));
  carpet.position.set(0, base + 0.03, 1.4);
  g.add(sign, canopy, frame, door, carpet);
  disposables.push(tex, signMat, signGeo, canopyGeo, black, bulbMat, bulbGeo, doorGeo, doorMat, frameGeo, stripeMat, stripeGeo, carpetGeo);
  const mx = (wall.ax + wall.bx) / 2 + wall.nx * 0.08, mz = (wall.az + wall.bz) / 2 + wall.nz * 0.08;
  g.position.set(mx, 0, mz);
  g.rotation.y = Math.atan2(wall.nx, wall.nz);
  return g;
}
