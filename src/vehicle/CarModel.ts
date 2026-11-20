// Procedural low-poly car (generic hatchback, no real-world brand). Local +Z = forward.
import * as THREE from 'three';
import { CAR_SPEC } from './CarPhysics.ts';

export const CAR_COLORS = [0xb8352f, 0x2f5fa8, 0xd8d8d2, 0x2b2d30, 0x6f7a3a, 0xc9a23a, 0x8a8f96, 0x3e8a86];

const glass = new THREE.MeshLambertMaterial({ color: 0x1d2630 });
const trim = new THREE.MeshLambertMaterial({ color: 0x1b1b1c });
const tyre = new THREE.MeshLambertMaterial({ color: 0x161616 });
const rim = new THREE.MeshLambertMaterial({ color: 0xa7abb0 });
const headlight = new THREE.MeshLambertMaterial({ color: 0xfff6d8, emissive: 0x7a7560 });
const taillight = new THREE.MeshLambertMaterial({ color: 0xb01010, emissive: 0x400000 });

function box(w: number, h: number, l: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Cabin with sloped windscreen and rear window, built from a custom 8-vertex hull. */
function cabinGeometry(wBottom: number, wTop: number, lBottom: number, lTop: number, h: number, topOffset: number): THREE.BufferGeometry {
  const b = lBottom / 2, t = lTop / 2, wb = wBottom / 2, wt = wTop / 2;
  const v = [
    [-wb, 0, -b], [wb, 0, -b], [wb, 0, b], [-wb, 0, b],
    [-wt, h, -t + topOffset], [wt, h, -t + topOffset], [wt, h, t + topOffset], [-wt, h, t + topOffset],
  ];
  const faces = [[0, 1, 2, 3], [7, 6, 5, 4], [3, 2, 6, 7], [1, 0, 4, 5], [0, 3, 7, 4], [2, 1, 5, 6]];
  const pos: number[] = [];
  for (const [a, bb, c, d] of faces) pos.push(...v[a], ...v[bb], ...v[c], ...v[a], ...v[c], ...v[d]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export class CarModel {
  readonly root = new THREE.Group();
  readonly wheels: THREE.Object3D[] = [];
  private brakeLights: THREE.Mesh[] = [];

  constructor(color = CAR_COLORS[0]) {
    const paint = new THREE.MeshLambertMaterial({ color });
    const s = CAR_SPEC;
    const W = s.halfExtents.x * 2, L = s.halfExtents.z * 2;
    // Lower body
    this.root.add(box(W, 0.5, L, paint, 0, -0.02, 0));
    // Dark sills between the wheels
    this.root.add(box(W * 0.96, 0.12, L * 0.62, trim, 0, -0.31, 0));
    // Bonnet slope hint and bumpers
    this.root.add(box(W * 0.98, 0.16, 0.25, trim, 0, -0.26, L / 2 - 0.05));
    this.root.add(box(W * 0.98, 0.16, 0.25, trim, 0, -0.26, -L / 2 + 0.05));
    // Cabin: tinted glasshouse with a painted roof panel on top.
    const cab = new THREE.Mesh(cabinGeometry(W * 0.92, W * 0.8, 2.45, 1.5, 0.56, -0.15), glass);
    cab.position.set(0, 0.22, -0.2);
    cab.castShadow = true;
    this.root.add(cab);
    const roof = box(W * 0.82, 0.07, 1.6, paint, 0, 0.79, -0.35);
    this.root.add(roof);
    // Door line and side mirrors for a bit of detail.
    for (const x of [-1, 1]) {
      this.root.add(box(0.02, 0.4, 0.02, trim, x * (W / 2 + 0.005), 0.0, 0.25));
      this.root.add(box(0.14, 0.08, 0.1, paint, x * (W / 2 + 0.06), 0.33, 0.75));
    }
    // Lights
    for (const x of [-0.6, 0.6]) {
      this.root.add(box(0.36, 0.13, 0.05, headlight, x, 0.06, L / 2 + 0.005));
      const tl = box(0.3, 0.13, 0.05, taillight, x, 0.08, -L / 2 - 0.005);
      this.brakeLights.push(tl);
      this.root.add(tl);
    }
    // Wheels
    const tyreGeo = new THREE.CylinderGeometry(s.wheelRadius, s.wheelRadius, 0.26, 16).rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(s.wheelRadius * 0.6, s.wheelRadius * 0.6, 0.27, 8).rotateZ(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Group();
      const t = new THREE.Mesh(tyreGeo, tyre);
      t.castShadow = true;
      w.add(t, new THREE.Mesh(rimGeo, rim));
      this.wheels.push(w);
      this.root.add(w);
    }
  }

  setBraking(on: boolean) {
    for (const l of this.brakeLights) (l.material as THREE.MeshLambertMaterial) = on ? brakeOn : taillight;
  }
}

const brakeOn = new THREE.MeshLambertMaterial({ color: 0xff2a2a, emissive: 0xcc0000 });
