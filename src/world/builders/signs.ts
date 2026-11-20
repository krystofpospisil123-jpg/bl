// Name signs on shops, amenities and landmarks. Each sign is a small box on the wall
// that faces the nearest street, with the name rendered to a canvas texture. Names are
// plain text without logos; real names can be swapped for generic ones (see config).
import * as THREE from 'three';
import type { ChunkData, Building } from '../format.ts';
import { SIGN_USES, genericName } from '../landmarks.ts';
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
  if (!b.label || !b.use || !SIGN_USES.test(b.use)) return null;
  const commercial = /^(shop:|amenity:(cafe|restaurant|pub|bar|fast_food|pharmacy|bank|fuel|biergarten))/.test(b.use);
  if (commercial && !settings.realNames) return genericName(b.use) || null;
  return b.label;
}

/** Wall edge facing the nearest road: returns its endpoints and outward normal. */
function wallTowardRoad(b: Building, data: ChunkData) {
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
    const score = -dRoad + Math.min(len, 20) * 0.3;
    if (score > bestScore) { bestScore = score; best = { ax, az, bx, bz, nx, nz, len }; }
  }
  return best;
}

const boardMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 });

export function buildSigns(data: ChunkData): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  for (const b of data.buildings) {
    const text = signText(b);
    if (!text) continue;
    const st = resolveStyle(b);
    const wall = wallTowardRoad(b, data);
    if (!wall) continue;
    const theme = themeFor(b.use!);
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
