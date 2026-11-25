// Inside of a walk-in store: one shared hall (built once, high above the town, with its own
// colliders) that every store's door leads to. Shelves with goods, fridges, tills by the door
// and a gun counter at the back. The store's name hangs over the counter.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { brandFor } from '../world/builders/brands.ts';

/** Where the hall stands (far above any terrain). */
const ORIGIN = new THREE.Vector3(0, 1500, 0);
const W = 22, D = 28, H = 4.6;

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number | ((i: number) => number)): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    c.setHex(typeof color === 'number' ? color : color(Math.floor(i / 6)));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function textTexture(text: string, bg: string, fg: string, w = 512, h = 96): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  let size = 60;
  g.font = `bold ${size}px system-ui, sans-serif`;
  while (g.measureText(text).width > w - 30 && size > 20) g.font = `bold ${(size -= 4)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Interior {
  readonly group = new THREE.Group();
  /** Where you appear after entering (facing into the store) and the trigger spots. */
  readonly spawn = ORIGIN.clone().add(new THREE.Vector3(0, 0.1, D / 2 - 3.2));
  readonly spawnYaw = Math.PI; // facing -z, into the hall
  readonly exit = ORIGIN.clone().add(new THREE.Vector3(0, 0, D / 2 - 1.3));
  readonly counter = ORIGIN.clone().add(new THREE.Vector3(6, 0, -D / 2 + 3.6));
  private nameMat: THREE.MeshStandardMaterial;

  constructor(phys: PhysicsWorld) {
    const parts: THREE.BufferGeometry[] = [];
    const colliders: [number, number, number, number, number, number][] = []; // centre, half extents
    const solid = (w: number, h: number, d: number, x: number, y: number, z: number, color: number | ((i: number) => number)) => {
      parts.push(box(w, h, d, x, y, z, color));
      colliders.push([x, y, z, w / 2, h / 2, d / 2]);
    };
    // Shell: floor, walls, ceiling.
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    solid(W, 0.2, D, 0, -0.1, 0, 0xd9d6cf);
    solid(W, 0.2, D, 0, H + 0.1, 0, 0xe8e8e6);
    solid(0.3, H, D, -W / 2, H / 2, 0, 0xe4e1da);
    solid(0.3, H, D, W / 2, H / 2, 0, 0xe4e1da);
    solid(W, H, 0.3, 0, H / 2, -D / 2, 0xe4e1da);
    solid(W / 2 - 1.5, H, 0.3, -(W / 4 + 0.75), H / 2, D / 2, 0xe4e1da);
    solid(W / 2 - 1.5, H, 0.3, W / 4 + 0.75, H / 2, D / 2, 0xe4e1da);
    solid(3, H - 2.6, 0.3, 0, 2.6 + (H - 2.6) / 2, D / 2, 0xe4e1da);
    // Floor tiles: darker stripes for the aisles.
    for (let z = -D / 2 + 1; z < D / 2; z += 2) parts.push(box(W - 0.4, 0.01, 0.04, 0, 0.005, z, 0xbdb9b0));
    // Shelves with goods: rows of coloured packets on four levels.
    const goods = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0xe67e22, 0x8e44ad, 0xecf0f1, 0x16a085, 0xd35400];
    for (const x of [-7.5, -4, 4, 7.5]) {
      solid(1.0, 1.9, 12, x, 0.95, -1, 0x8d9299);
      for (let lvl = 0; lvl < 4; lvl++) {
        for (let z = -6.6; z < 4.6; z += 0.45) {
          const c = goods[Math.floor(rnd() * goods.length)];
          const h = 0.2 + rnd() * 0.18;
          for (const side of [-1, 1]) parts.push(box(0.3, h, 0.38, x + side * 0.38, 0.25 + lvl * 0.45 + h / 2, z, c));
        }
      }
    }
    // Fridges along the left wall: white cabinets with glass fronts.
    solid(1.2, 2.1, 16, -W / 2 + 0.8, 1.05, -2, 0xf4f4f2);
    for (let z = -9.5; z < 6; z += 1.6) parts.push(box(0.04, 1.6, 1.4, -W / 2 + 1.42, 1.15, z, 0x9fc6e0));
    // Tills by the door.
    for (const x of [-7, -3.5]) {
      solid(0.9, 0.9, 2.4, x, 0.45, D / 2 - 5, 0x4a4f55);
      parts.push(box(0.6, 0.02, 2.2, x - 0.1, 0.91, D / 2 - 5, 0x1a1a1a));
      parts.push(box(0.3, 0.35, 0.3, x + 0.25, 1.1, D / 2 - 4.2, 0x2b2d30));
    }
    // Gun counter at the back right: dark counter, glass top, rack of guns on the wall.
    const cx = 6, cz = -D / 2 + 2.2;
    solid(5, 1.0, 1.0, cx, 0.5, cz, 0x2c2f33);
    parts.push(box(4.8, 0.04, 0.9, cx, 1.02, cz, 0x9fc6e0));
    parts.push(box(6, 2.2, 0.1, cx, 2.1, -D / 2 + 0.2, 0x5a4634));
    for (let i = 0; i < 6; i++) {
      parts.push(box(0.9, 0.12, 0.08, cx - 2.2 + i * 0.88, 1.6, -D / 2 + 0.3, 0x1a1b1d));
      parts.push(box(1.2, 0.14, 0.08, cx - 2.3 + i * 0.92, 2.4, -D / 2 + 0.3, 0x1a1b1d));
    }
    // Ceiling light panels (glowing, no collider).
    const lightsGeo: THREE.BufferGeometry[] = [];
    for (let x = -7.5; x <= 7.5; x += 3.75) for (let z = -10; z <= 10; z += 5) lightsGeo.push(box(1.4, 0.05, 0.5, x, H - 0.03, z, 0xffffff));

    const hall = new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    const panels = new THREE.Mesh(mergeGeometries(lightsGeo)!, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2 }));
    this.nameMat = new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 0.4 });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), this.nameMat);
    banner.position.set(cx, 3.75, -D / 2 + 0.2);
    const gunTex = textTexture('ZBRANĚ A NÁBOJE', '#20252b', '#f1c232');
    const gunSign = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.7), new THREE.MeshStandardMaterial({ map: gunTex, emissive: 0xffffff, emissiveMap: gunTex, emissiveIntensity: 0.5 }));
    gunSign.position.set(cx, 3.0, -D / 2 + 0.22);
    const exitTex = textTexture('VÝCHOD', '#1e7a3a', '#ffffff', 256, 96);
    const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.5), new THREE.MeshStandardMaterial({ map: exitTex, emissive: 0xffffff, emissiveMap: exitTex, emissiveIntensity: 0.6 }));
    exitSign.position.set(0, 2.95, D / 2 - 0.17);
    exitSign.rotation.y = Math.PI;
    // The glass doors, glowing with daylight from outside.
    const doors = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.6), new THREE.MeshBasicMaterial({ color: 0xdff0ff }));
    doors.position.set(0, 1.3, D / 2 - 0.16);
    doors.rotation.y = Math.PI;
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.6, depthWrite: false });
    const ring = (p: THREE.Vector3, color?: number) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.1, 32).rotateX(-Math.PI / 2), color ? new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false }) : ringMat);
      m.position.copy(p).sub(ORIGIN).add(new THREE.Vector3(0, 0.02, 0));
      return m;
    };
    this.group.add(hall, panels, banner, gunSign, exitSign, doors, ring(this.counter), ring(this.exit, 0x7fd4ff));
    this.group.position.copy(ORIGIN);
    // No extra lights (they would cost every pixel in town): the hall is lit by the sun without
    // shadows, the sky light and its glowing ceiling panels.
    colliders.push([0, 1.3, D / 2, 1.5, 1.3, 0.15]); // closed glass doors
    this.setName('Obchod');
    for (const [x, y, z, hx, hy, hz] of colliders) {
      phys.world.createCollider(phys.R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(ORIGIN.x + x, ORIGIN.y + y, ORIGIN.z + z));
    }
  }

  /** Shows the store's name over the counter. */
  setName(name: string) {
    this.nameMat.map?.dispose();
    const brand = brandFor(name);
    let t: THREE.CanvasTexture;
    if (brand) {
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 188;
      brand.draw(c.getContext('2d')!, c.width, c.height);
      t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
    } else t = textTexture(name, '#ffffff', '#1d2a36');
    this.nameMat.map = t;
    this.nameMat.emissiveMap = t;
    this.nameMat.needsUpdate = true;
  }

  near(p: THREE.Vector3, spot: THREE.Vector3, r: number): boolean {
    return Math.hypot(p.x - spot.x, p.z - spot.z) < r && Math.abs(p.y - spot.y) < 3;
  }
}
