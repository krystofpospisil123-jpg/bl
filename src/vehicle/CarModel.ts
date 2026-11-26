// Procedural low-poly car (generic hatchback, no real-world brand). Local +Z = forward.
import * as THREE from 'three';
import { CAR_SPEC } from './CarPhysics.ts';
import { assets, useCarAttributes, type CarAsset, type CarType } from '../assets/models.ts';

/** Body colours, weighted like a typical Czech street: lots of white, silver, grey and black. */
export const CAR_COLORS = [
  0xe8e8e4, 0xe8e8e4, 0xf2f2ef, 0xa9adb2, 0xa9adb2, 0x8a8f96, 0x5d6267, 0x5d6267, 0x1e2023, 0x1e2023,
  0x2b2d30, 0x23395e, 0x2f5fa8, 0xa52a26, 0xb8352f, 0x3d6b3a, 0x6b4c36, 0xc8bca0, 0x7a2f3a, 0x4f7f9a,
];

const glass = new THREE.MeshStandardMaterial({ color: 0x1d2630, roughness: 0.05, metalness: 0.2 });
const trim = new THREE.MeshStandardMaterial({ color: 0x1b1b1c });
const tyre = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.9 });
const rim = new THREE.MeshStandardMaterial({ color: 0xa7abb0, roughness: 0.3, metalness: 0.8 });
const headlight = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0x7a7560 });
const taillight = new THREE.MeshStandardMaterial({ color: 0xb01010, emissive: 0x400000 });

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
  /** Wheel centres of the Blender model (x, z used for the visual wheels), if loaded. */
  wheelAnchors?: THREE.Vector3[];
  private brakeLights: THREE.Mesh[] = [];
  private tail?: THREE.Mesh;
  /** Deformable copies of the body and tail-light geometry (dents from crashes). */
  private dentable: THREE.BufferGeometry[] = [];
  private bodyParts: THREE.Object3D[] = [];
  private rims: THREE.InstancedMesh[] = [];
  private type: CarType = 'liftback';
  private spoiler?: THREE.Object3D;
  private neon?: THREE.Object3D;

  /** Tuning: rim colour. */
  setRimColor(hex: number) {
    for (const r of this.rims) {
      r.setColorAt(0, new THREE.Color(hex));
      r.instanceColor!.needsUpdate = true;
    }
  }

  /** Tuning: lowered suspension (the body sits 6 cm lower over the wheels). */
  setLowered(on: boolean) {
    for (const p of this.bodyParts) p.position.y = on ? -0.06 : 0;
    if (this.spoiler) this.spoiler.position.y = on ? -0.06 : 0;
  }

  /** Tuning: rear wing on the boot lid or at the end of the roof, in the given colour. */
  setSpoiler(color: number | null) {
    if (this.spoiler) this.root.remove(this.spoiler);
    this.spoiler = undefined;
    if (color === null) return;
    const top: Record<CarType, number> = { liftback: 1.07, superb: 1.08, hatch: 1.47, estate: 1.49, suv: 1.69, city: 1.49 };
    const saloon = this.type === 'liftback' || this.type === 'superb';
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3 });
    const y = -0.71 + top[this.type];
    const z = -this.halfLength + (saloon ? 0.18 : 0.3);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.04, 0.32).translate(0, y + (saloon ? 0.16 : 0.05), z), mat);
    wing.castShadow = true;
    g.add(wing);
    if (saloon) for (const x of [-0.5, 0.5]) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.12).translate(x, y + 0.08, z), mat));
    this.spoiler = g;
    this.root.add(g);
  }

  /** Tuning: neon tubes under the sills and a soft coloured glow on the road below the car. */
  setNeon(color: number | null) {
    if (this.neon) {
      this.root.remove(this.neon);
      this.neon.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
      });
    }
    this.neon = undefined;
    if (color === null) return;
    const g = new THREE.Group();
    const w = this.halfWidth, l = this.halfLength;
    // Glow: a texture that fades out softly around the car's footprint (no hard edges).
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 2 + 2.4, l * 2 + 2.4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, map: neonGlowTexture(), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    glow.position.y = -0.7;
    glow.renderOrder = 2;
    // Tubes: thin bright strips along both sills and across the front and back.
    const tube = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), toneMapped: false });
    const side = new THREE.BoxGeometry(0.035, 0.035, l * 1.25);
    const end = new THREE.BoxGeometry(w * 1.3, 0.035, 0.035);
    for (const x of [-1, 1]) {
      const m = new THREE.Mesh(side, tube);
      m.position.set(x * (w - 0.12), -0.5, 0);
      g.add(m);
    }
    for (const z of [-1, 1]) {
      const m = new THREE.Mesh(end, tube);
      m.position.set(0, -0.5, z * (l - 0.45));
      g.add(m);
    }
    g.add(glow);
    this.neon = g;
    this.root.add(g);
  }

  /** Accumulated damage 0..1 (smoke from the bonnet when high). */
  damage = 0;
  readonly halfLength: number = 2.2;
  readonly halfWidth: number = 0.9;

  constructor(color = CAR_COLORS[0], type: CarType = 'liftback') {
    const asset = assets.cars?.[type];
    if (asset) {
      this.fromAsset(asset, color, type);
      return;
    }
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.35 });
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

  /** Builds the car from the Blender model: body tinted per car, separate tail lights and wheels. */
  private fromAsset(a: CarAsset, color: number, type: CarType) {
    const bodyGeo = a.body.clone(), tailGeo = a.tail.clone();
    this.dentable = [bodyGeo, tailGeo];
    (this as { halfLength: number }).halfLength = a.halfLength;
    (this as { halfWidth: number }).halfWidth = a.halfWidth;
    const body = new THREE.InstancedMesh(bodyGeo, carMaterial(), 1);
    body.setMatrixAt(0, new THREE.Matrix4());
    body.setColorAt(0, new THREE.Color(color));
    body.computeBoundingSphere();
    body.castShadow = body.receiveShadow = true;
    this.tail = new THREE.Mesh(tailGeo, tailOff);
    this.root.add(body, this.tail);
    this.wheelAnchors = a.wheelPos;
    this.bodyParts = [body, this.tail];
    this.type = type;
    a.wheelPos.forEach((p) => {
      const w = new THREE.Group();
      // Instanced (count 1) so the rim colour can be tuned through the instance colour.
      const m = new THREE.InstancedMesh(a.wheel, carMaterial(), 1);
      m.setMatrixAt(0, new THREE.Matrix4());
      m.setColorAt(0, new THREE.Color(RIM_STOCK));
      m.computeBoundingSphere();
      this.rims.push(m);
      if (p.x < 0) m.rotation.y = Math.PI; // rim faces outwards on the right side too
      m.castShadow = true;
      w.add(m);
      this.wheels.push(w);
      this.root.add(w);
    });
  }

  /**
   * Dents the body: vertices within `radius` of `point` (car frame) are pushed along `dir`
   * (into the car) by up to `depth` metres, with a smooth falloff and a little crumple noise.
   */
  dent(point: THREE.Vector3, dir: THREE.Vector3, depth: number, radius: number) {
    if (!this.dentable.length) return;
    this.damage = Math.min(1, this.damage + depth * 0.9);
    const v = new THREE.Vector3();
    for (const g of this.dentable) {
      const pos = g.attributes.position as THREE.BufferAttribute;
      const nor = g.attributes.normal as THREE.BufferAttribute;
      const moved = new Uint8Array(pos.count);
      let any = false;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const d = v.distanceTo(point);
        if (d > radius) continue;
        const f = (1 - d / radius) ** 2;
        const crumple = 0.75 + 0.5 * Math.abs(Math.sin(v.x * 37.1 + v.y * 19.7 + v.z * 23.3));
        v.addScaledVector(dir, depth * f * crumple);
        // Crumpled metal also bulges a little upwards and sideways.
        v.y += depth * f * 0.15 * Math.sin(v.z * 13.1);
        pos.setXYZ(i, v.x, v.y, v.z);
        moved[i] = 1;
        any = true;
      }
      if (!any) continue;
      // Dented triangles get flat normals (crumpled look); the rest stays smooth.
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let i = 0; i + 2 < pos.count; i += 3) {
        if (!moved[i] && !moved[i + 1] && !moved[i + 2]) continue;
        a.fromBufferAttribute(pos, i);
        b.fromBufferAttribute(pos, i + 1);
        c.fromBufferAttribute(pos, i + 2);
        const n = b.sub(a).cross(c.sub(a)).normalize();
        for (let k = 0; k < 3; k++) nor.setXYZ(i + k, n.x, n.y, n.z);
      }
      pos.needsUpdate = true;
      nor.needsUpdate = true;
    }
  }

  setBraking(on: boolean) {
    if (this.tail) this.tail.material = on ? tailOn : tailOff;
    for (const l of this.brakeLights) (l.material as THREE.MeshStandardMaterial) = on ? brakeOn : taillight;
  }
}

const brakeOn = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xcc0000 });
const tailOff = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: 0x300000 });
const tailOn = new THREE.MeshStandardMaterial({ color: 0xff3030, roughness: 0.3, emissive: 0xdd0000 });
let sharedCarMat: THREE.MeshStandardMaterial | null = null;
export const RIM_STOCK = 0xa9adb2;

let neonTex: THREE.CanvasTexture | undefined;
/** White glow mask for neon: strong right under the car, fading smoothly ~1 m around it. */
function neonGlowTexture(): THREE.CanvasTexture {
  if (neonTex) return neonTex;
  const W = 64, H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  // The plane is 2.4 m larger than the car: the footprint is the inner box, the rest is falloff.
  const fx = 0.36, fz = 0.42; // footprint half-size as a fraction of the texture
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = Math.abs((x + 0.5) / W - 0.5) , v = Math.abs((y + 0.5) / H - 0.5);
      const dx = Math.max(0, u - fx + 0.08) / (0.5 - fx + 0.08), dz = Math.max(0, v - fz + 0.04) / (0.5 - fz + 0.04);
      const d = Math.min(1, Math.hypot(dx, dz));
      const a = Math.pow(1 - d, 2.2) * 255;
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  neonTex = new THREE.CanvasTexture(c);
  return neonTex;
}
function carMaterial() {
  sharedCarMat ??= useCarAttributes(new THREE.MeshStandardMaterial({ metalness: 0.3 }));
  return sharedCarMat;
}

/**
 * Bakes the car model into two geometries for instanced traffic:
 * `paint` (white, tinted per instance) and `detail` (glass, trim, lights, wheels; vertex colours).
 */
export function bakeCarGeometries(): { paint: THREE.BufferGeometry; detail: THREE.BufferGeometry } {
  const model = new CarModel(0xffffff);
  model.wheels.forEach((w, i) => w.position.set((i % 2 ? -0.8 : 0.8) * 1.06, CAR_SPEC.wheelY - CAR_SPEC.suspensionRest * 0.75, i < 2 ? CAR_SPEC.wheelZFront : CAR_SPEC.wheelZRear));
  model.root.updateMatrixWorld(true);
  const paint: THREE.BufferGeometry[] = [];
  const detail: THREE.BufferGeometry[] = [];
  model.root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = o.material as THREE.MeshStandardMaterial;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    g.deleteAttribute('uv');
    const c = mat.color.clone().add(mat.emissive ?? new THREE.Color(0));
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (mat.color.getHex() === 0xffffff ? paint : detail).push(g);
  });
  const merge = (list: THREE.BufferGeometry[]) => {
    const pos: number[] = [], nor: number[] = [], col: number[] = [];
    for (const g of list) {
      if (!g.attributes.normal) g.computeVertexNormals();
      pos.push(...(g.attributes.position.array as Float32Array));
      nor.push(...(g.attributes.normal.array as Float32Array));
      col.push(...(g.attributes.color.array as Float32Array));
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  };
  return { paint: merge(paint), detail: merge(detail) };
}
