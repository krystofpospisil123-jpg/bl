// Procedural human: a rig of 11 body parts (hips, chest, head, hair, upper arms, forearms with
// hands, thighs, shins with shoes) with elbows and knees, a face (eyes, brows, nose, mouth, ears)
// and several hairstyles. One shared material colours each vertex by its "slot" (skin, top,
// legs, hair, shoes, sleeve, shin) from per-instance colours, so a whole crowd with different
// clothes is drawn with one instanced mesh per body part (a few draw calls for everyone).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type HairStyle = 'short' | 'long' | 'bun' | 'cap' | 'bald' | 'ponytail';

export interface Outfit {
  skin: number;
  hair: number;
  top: number;
  legs: number;
  shoes: number;
  /** T-shirt (bare forearms) and shorts / skirt (bare shins). */
  shortSleeves?: boolean;
  shorts?: boolean;
  hairStyle?: HairStyle;
  /** Female body shape (bust, narrower waist, rounder hips). */
  female?: boolean;
  /** Lingerie / swimwear: only `top` (bra) and `legs` (briefs) are covered, the rest is skin. */
  bare?: boolean;
  /** 0 broad shoulders .. 1 slim with wider hips. */
  build?: number;
  /** Overall height scale (1 = 1.78 m). */
  height?: number;
}

export const DEFAULT_OUTFIT: Outfit = { skin: 0xe0b394, hair: 0x3a2a1e, top: 0x2f6d8f, legs: 0x2e3442, shoes: 0x1f1f1f, hairStyle: 'short' };

/** Colour slots baked into the vertices. */
const SKIN = 0, TOP = 1, LEGS = 2, HAIR = 3, SHOES = 4, SLEEVE = 5, SHIN = 6, FIXED = 7, BODY = 8, THIGH = 9;

const HAIR_STYLES: HairStyle[] = ['short', 'long', 'bun', 'cap', 'ponytail'];

/** Joint angles of one pose (radians); see `restPose`. */
export interface Pose {
  /** Hips: height offset, forward lean, sideways sway, turn. */
  y: number; lean: number; sway: number; twist: number;
  /** Chest relative to the hips. */
  chestTwist: number; chestX: number; chestZ: number;
  headX: number; headY: number; headZ: number;
  /** Shoulders: x forward/back (negative = forward), y twist, z out to the side; elbow bend (negative). */
  lSh: [number, number, number]; lEl: number;
  rSh: [number, number, number]; rEl: number;
  /** Hips: x forward/back (negative = forward), z out; knee bend (positive). */
  lHip: [number, number]; lKnee: number;
  rHip: [number, number]; rKnee: number;
}

export function restPose(): Pose {
  return {
    y: 0, lean: 0, sway: 0, twist: 0, chestTwist: 0, chestX: 0, chestZ: 0, headX: 0, headY: 0, headZ: 0,
    lSh: [0, 0, 0.07], lEl: -0.12, rSh: [0, 0, -0.07], rEl: -0.12, lHip: [0, 0.02], lKnee: 0.03, rHip: [0, -0.02], rKnee: 0.03,
  };
}

// ---------------------------------------------------------------- geometry

function tag(g: THREE.BufferGeometry, slot: number, fixed = 0x000000): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  const n = ng.attributes.position.count;
  ng.setAttribute('slot', new THREE.BufferAttribute(new Float32Array(n).fill(slot), 1));
  const c = new THREE.Color(fixed);
  const f = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) f.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('fixedColor', new THREE.BufferAttribute(f, 3));
  return ng;
}

/** Tapered limb hanging down from the joint at the origin, with a ball at the joint. */
function limb(rTop: number, rBot: number, len: number, slot: number, from = 0): THREE.BufferGeometry[] {
  const cyl = new THREE.CylinderGeometry(rTop, rBot, len - from, 10, 1, true).translate(0, -from - (len - from) / 2, 0);
  const out = [tag(cyl, slot)];
  if (from === 0) out.push(tag(new THREE.SphereGeometry(rTop, 10, 8), slot));
  out.push(tag(new THREE.SphereGeometry(rBot, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, -len, 0), slot));
  return out;
}

function lathe(profile: [number, number][], zScale: number, slot: number, segs = 16): THREE.BufferGeometry {
  return tag(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs).scale(1, 1, zScale), slot);
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, slot: number, fixed?: number) =>
  tag(new THREE.BoxGeometry(w, h, d).translate(x, y, z), slot, fixed);
const ball = (r: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, slot: number, fixed?: number, seg = 10) =>
  tag(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)).scale(sx, sy, sz).translate(x, y, z), slot, fixed);

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

export type PartName = 'hips' | 'chest' | 'hipsF' | 'chestF' | 'head' | 'armL' | 'armR' | 'foreL' | 'foreR' | 'thighL' | 'thighR' | 'shinL' | 'shinR';

let geos: (Record<PartName, THREE.BufferGeometry> & { hair: Record<string, THREE.BufferGeometry> }) | null = null;

function buildGeometries() {
  if (geos) return geos;
  // Chest: waist (pivot, y = 0.98 m) up to the shoulders; flattened front to back.
  const chest = merge([
    lathe([[0.0, -0.01], [0.145, 0], [0.15, 0.08], [0.165, 0.2], [0.185, 0.32], [0.195, 0.41], [0.17, 0.465], [0.09, 0.5], [0.0, 0.505]], 0.64, BODY),
    ball(0.068, 0.19, 0.425, 0, 1, 1, 1, BODY),
    ball(0.068, -0.19, 0.425, 0, 1, 1, 1, BODY),
    tag(new THREE.CylinderGeometry(0.052, 0.056, 0.12, 10).translate(0, 0.54, 0.0), SKIN),
    // Collar and a short V of skin at the neckline.
    tag(new THREE.TorusGeometry(0.068, 0.014, 6, 14).rotateX(Math.PI / 2).scale(1, 1, 0.85).translate(0, 0.495, 0), BODY),
    tag(new THREE.ConeGeometry(0.035, 0.07, 3).rotateX(Math.PI).scale(1, 1, 0.3).translate(0, 0.455, 0.105), SKIN),
  ]);
  // Female chest: narrower waist, bust (the "top" slot = bra or blouse) with a band and straps.
  const chestF = merge([
    lathe([[0.0, -0.01], [0.125, 0], [0.122, 0.09], [0.14, 0.2], [0.158, 0.31], [0.165, 0.41], [0.148, 0.462], [0.08, 0.5], [0.0, 0.505]], 0.62, BODY),
    ball(0.058, 0.165, 0.425, 0, 1, 1, 1, BODY),
    ball(0.058, -0.165, 0.425, 0, 1, 1, 1, BODY),
    tag(new THREE.CylinderGeometry(0.05, 0.053, 0.12, 10).translate(0, 0.54, 0), SKIN),
    ball(0.074, 0.062, 0.315, 0.062, 1, 0.92, 0.9, TOP, undefined, 14),
    ball(0.074, -0.062, 0.315, 0.062, 1, 0.92, 0.9, TOP, undefined, 14),
    tag(new THREE.CylinderGeometry(0.152, 0.148, 0.04, 18, 1, true).scale(1, 1, 0.66).translate(0, 0.262, 0), TOP),
    tag(new THREE.BoxGeometry(0.014, 0.17, 0.014).rotateX(0.35).translate(0.075, 0.42, 0.045), TOP),
    tag(new THREE.BoxGeometry(0.014, 0.17, 0.014).rotateX(0.35).translate(-0.075, 0.42, 0.045), TOP),
  ]);
  // Female hips: wider and rounder, briefs / trousers in the "legs" slot.
  const hipsF = merge([
    lathe([[0.0, -0.15], [0.12, -0.15], [0.172, -0.095], [0.18, -0.035], [0.135, 0.02], [0.0, 0.02]], 0.74, LEGS),
    ball(0.085, 0.066, -0.075, -0.05, 1, 1.05, 0.85, LEGS, undefined, 12),
    ball(0.085, -0.066, -0.075, -0.05, 1, 1.05, 0.85, LEGS, undefined, 12),
    tag(new THREE.CylinderGeometry(0.128, 0.13, 0.05, 16, 1, true).scale(1, 1, 0.7).translate(0, 0.0, 0), BODY),
  ]);
  // Hips with a belt.
  const hips = merge([
    lathe([[0.0, -0.15], [0.12, -0.15], [0.16, -0.1], [0.165, -0.03], [0.15, 0.02], [0.0, 0.02]], 0.7, LEGS),
    tag(new THREE.CylinderGeometry(0.153, 0.153, 0.035, 16, 1, true).scale(1, 1, 0.69).translate(0, 0.0, 0), FIXED, 0x2a2420),
    box(0.04, 0.03, 0.01, 0, 0, 0.108, FIXED, 0xb8a070),
  ]);
  // Head (pivot at the base of the neck): skull, jaw, ears, eyes, brows, nose, mouth.
  const head = merge([
    ball(0.1, 0, 0.175, 0.0, 1, 1.15, 1.08, SKIN, undefined, 16),
    ball(0.08, 0, 0.115, 0.022, 1, 0.85, 1.05, SKIN, undefined, 12),
    ball(0.022, 0.101, 0.165, -0.005, 0.6, 1.3, 1, SKIN),
    ball(0.022, -0.101, 0.165, -0.005, 0.6, 1.3, 1, SKIN),
    ball(0.019, 0.038, 0.18, 0.088, 1, 0.8, 0.6, FIXED, 0xf4f2ee),
    ball(0.019, -0.038, 0.18, 0.088, 1, 0.8, 0.6, FIXED, 0xf4f2ee),
    ball(0.0095, 0.038, 0.18, 0.1, 1, 1, 0.6, FIXED, 0x3b2a1e),
    ball(0.0095, -0.038, 0.18, 0.1, 1, 1, 0.6, FIXED, 0x3b2a1e),
    box(0.04, 0.009, 0.012, 0.039, 0.207, 0.098, HAIR),
    box(0.04, 0.009, 0.012, -0.039, 0.207, 0.098, HAIR),
    tag(new THREE.ConeGeometry(0.018, 0.05, 4).rotateX(-Math.PI / 2 + 0.35).translate(0, 0.152, 0.112), SKIN),
    box(0.042, 0.008, 0.008, 0, 0.113, 0.099, FIXED, 0x9c4f4a),
  ]);
  // Hair styles (same pivot as the head).
  const cap = (theta: number) => tag(new THREE.SphereGeometry(0.106, 16, 8, 0, Math.PI * 2, 0, theta).scale(1, 1.12, 1.12).rotateX(-0.32).translate(0, 0.19, -0.008), HAIR);
  const hair: Record<string, THREE.BufferGeometry> = {
    short: merge([cap(Math.PI * 0.5)]),
    long: merge([cap(Math.PI * 0.55), box(0.2, 0.25, 0.05, 0, 0.09, -0.085, HAIR), box(0.035, 0.2, 0.08, 0.09, 0.1, -0.02, HAIR), box(0.035, 0.2, 0.08, -0.09, 0.1, -0.02, HAIR)]),
    bun: merge([cap(Math.PI * 0.55), ball(0.05, 0, 0.25, -0.1, 1, 1, 1, HAIR)]),
    ponytail: merge([cap(Math.PI * 0.55), ball(0.03, 0, 0.21, -0.115, 1, 1, 1, HAIR), tag(new THREE.CylinderGeometry(0.028, 0.012, 0.2, 8).rotateX(0.35).translate(0, 0.12, -0.15), HAIR)]),
    // Baseball cap in the colour of the top (police: dark blue).
    cap: merge([
      tag(new THREE.SphereGeometry(0.108, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.95, 1.1).translate(0, 0.2, 0), TOP),
      box(0.17, 0.012, 0.1, 0, 0.205, 0.115, TOP),
      box(0.18, 0.04, 0.02, 0, 0.17, -0.1, HAIR),
    ]),
  };
  // Arms: upper arm (sleeve end covers the shoulder), forearm with hand, built per side
  // (thumb on the inner side).
  const upper = () => merge([...limb(0.054, 0.046, 0.28, SLEEVE), tag(new THREE.CylinderGeometry(0.062, 0.058, 0.13, 10).translate(0, -0.05, 0), BODY)]);
  const fore = (side: number) => merge([
    ...limb(0.046, 0.036, 0.25, SLEEVE),
    box(0.075, 0.085, 0.034, 0, -0.29, 0, SKIN),
    box(0.07, 0.065, 0.03, 0, -0.355, 0.004, SKIN),
    tag(new THREE.BoxGeometry(0.022, 0.055, 0.024).rotateZ(side * 0.5).translate(-side * 0.043, -0.285, 0.012), SKIN),
  ]);
  const thigh = () => merge([...limb(0.088, 0.066, 0.44, THIGH)]);
  const shin = () => merge([
    ...limb(0.064, 0.047, 0.42, SHIN),
    // Shoe with a light sole.
    ball(0.055, 0, -0.44, 0.045, 0.95, 0.75, 2.2, SHOES),
    box(0.1, 0.022, 0.25, 0, -0.475, 0.045, FIXED, 0xd8d6d0),
  ]);
  geos = { chest, hips, chestF, hipsF, head, armL: upper(), armR: upper(), foreL: fore(1), foreR: fore(-1), thighL: thigh(), thighR: thigh(), shinL: shin(), shinR: shin(), hair };
  return geos;
}

// ---------------------------------------------------------------- material

let material: THREE.MeshStandardMaterial | null = null;

export function humanMaterial(): THREE.MeshStandardMaterial {
  if (material) return material;
  material = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0 });
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float slot; attribute vec3 fixedColor;
        attribute vec3 iSkin; attribute vec3 iTop; attribute vec3 iLegs; attribute vec3 iHair; attribute vec3 iShoes; attribute vec3 iFlags;
        varying vec3 vTint;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 sleeve = mix(iTop, iSkin, iFlags.x), shin = mix(iLegs, iSkin, iFlags.y);
        vec3 bodyC = mix(iTop, iSkin, iFlags.z), thighC = mix(iLegs, iSkin, iFlags.z);
        vTint = slot < 0.5 ? iSkin : slot < 1.5 ? iTop : slot < 2.5 ? iLegs : slot < 3.5 ? iHair : slot < 4.5 ? iShoes : slot < 5.5 ? sleeve : slot < 6.5 ? shin : slot < 7.5 ? fixedColor : slot < 8.5 ? bodyC : thighC;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTint;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * vTint, opacity );');
  };
  material.customProgramCacheKey = () => 'human-rig-v2';
  return material;
}

// ---------------------------------------------------------------- crowd

const PARTS: PartName[] = ['hips', 'chest', 'hipsF', 'chestF', 'head', 'armL', 'armR', 'foreL', 'foreR', 'thighL', 'thighR', 'shinL', 'shinR'];
const COLOR_ATTRS = ['iSkin', 'iTop', 'iLegs', 'iHair', 'iShoes'] as const;

/** A set of people drawn with one instanced mesh per body part. */
export class HumanCrowd {
  readonly group = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private outfits: Outfit[] = [];
  private styles: (HairStyle | undefined)[] = [];
  /** World (or group-local) matrices of the last pose, per person: forearm ends for guns. */
  readonly foreR: THREE.Matrix4[] = [];
  readonly headM: THREE.Matrix4[] = [];

  constructor(readonly max: number, castShadow = true) {
    const g = buildGeometries();
    const mat = humanMaterial();
    const add = (key: string, geo: THREE.BufferGeometry) => {
      // Own geometry object per mesh (shared vertex buffers) so it can carry its own instance colours.
      const own = new THREE.BufferGeometry();
      for (const [k, v] of Object.entries(geo.attributes)) own.setAttribute(k, v);
      own.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      for (const a of COLOR_ATTRS) own.setAttribute(a, new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3));
      own.setAttribute('iFlags', new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3));
      const mesh = new THREE.InstancedMesh(own, mat, max);
      mesh.castShadow = castShadow;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.meshes.set(key, mesh);
      this.group.add(mesh);
    };
    for (const p of PARTS) add(p, g[p]);
    for (const s of HAIR_STYLES) add(`hair:${s}`, g.hair[s]);
    for (let i = 0; i < max; i++) {
      this.foreR.push(new THREE.Matrix4());
      this.headM.push(new THREE.Matrix4());
    }
  }

  set count(n: number) {
    for (const mesh of this.meshes.values()) mesh.count = n;
  }

  /** Sets the clothes of person `i`. */
  setOutfit(i: number, o: Outfit) {
    this.outfits[i] = o;
    this.styles[i] = o.hairStyle ?? 'short';
    const cols = [o.skin, o.top, o.legs, o.hair, o.shoes].map((h) => new THREE.Color(h));
    for (const mesh of this.meshes.values()) {
      const geo = mesh.geometry;
      COLOR_ATTRS.forEach((a, k) => {
        const attr = geo.attributes[a] as THREE.InstancedBufferAttribute;
        attr.setXYZ(i, cols[k].r, cols[k].g, cols[k].b);
        attr.needsUpdate = true;
      });
      const f = geo.attributes.iFlags as THREE.InstancedBufferAttribute;
      f.setXYZ(i, o.shortSleeves || o.bare ? 1 : 0, o.shorts || o.bare ? 1 : 0, o.bare ? 1 : 0);
      f.needsUpdate = true;
    }
  }

  /** Places person `i` with the root matrix (feet, facing +Z) in the given pose. */
  setPose(i: number, root: THREE.Matrix4, p: Pose) {
    const o = this.outfits[i] ?? DEFAULT_OUTFIT;
    const build = o.build ?? 0;
    const e = new THREE.Euler();
    const rot = (x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ') => {
      e.set(x, y, z, order);
      return new THREE.Matrix4().makeRotationFromEuler(e);
    };
    const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
    const put = (key: string, mat: THREE.Matrix4) => this.meshes.get(key)!.setMatrixAt(i, mat);
    const h = o.height ?? 1;
    const base = root.clone().multiply(new THREE.Matrix4().makeScale(h, h, h));
    const pelvis = base.clone().multiply(at(0, 0.98 + p.y, 0)).multiply(rot(p.lean, p.twist, p.sway, 'YXZ'));
    // Slim build: narrower shoulders, wider hips.
    const hide0 = new THREE.Matrix4().makeScale(0, 0, 0);
    const fem = !!o.female;
    put(fem ? 'hipsF' : 'hips', pelvis.clone().multiply(new THREE.Matrix4().makeScale(1 + (fem ? 0 : build * 0.1), 1, 1)));
    put(fem ? 'hips' : 'hipsF', hide0);
    const chest = pelvis.clone().multiply(rot(p.chestX, p.chestTwist, p.chestZ, 'YXZ'));
    const shoulderW = 1 - build * 0.12;
    put(fem ? 'chestF' : 'chest', fem ? chest : chest.clone().multiply(new THREE.Matrix4().makeScale(shoulderW, 1, 1 - build * 0.05)));
    put(fem ? 'chest' : 'chestF', hide0);
    const head = chest.clone().multiply(at(0, 0.5, 0)).multiply(rot(p.headX, p.headY, p.headZ, 'YXZ'));
    put('head', head);
    this.headM[i].copy(head);
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const st of HAIR_STYLES) put(`hair:${st}`, this.styles[i] === st ? head : hide);
    for (const [side, sh, el, arm, fore] of [[1, p.lSh, p.lEl, 'armL', 'foreL'], [-1, p.rSh, p.rEl, 'armR', 'foreR']] as const) {
      const upper = chest.clone().multiply(at(side * 0.195 * shoulderW, 0.435, 0)).multiply(rot(sh[0], sh[1], sh[2]));
      put(arm, upper);
      const lower = upper.clone().multiply(at(0, -0.28, 0)).multiply(rot(el, 0, 0));
      put(fore, lower);
      if (side < 0) this.foreR[i].copy(lower);
    }
    for (const [side, hip, knee, thigh, shin] of [[1, p.lHip, p.lKnee, 'thighL', 'shinL'], [-1, p.rHip, p.rKnee, 'thighR', 'shinR']] as const) {
      const t = pelvis.clone().multiply(at(side * (0.092 + build * 0.01), -0.06, 0)).multiply(rot(hip[0], 0, hip[1]));
      put(thigh, t);
      put(shin, t.clone().multiply(at(0, -0.44, 0)).multiply(rot(knee, 0, 0)));
    }
  }

  /** Call after setting poses for this frame. */
  commit() {
    for (const mesh of this.meshes.values()) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
  }
}

// ---------------------------------------------------------------- poses

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Walk / run cycle. `phase` advances with distance; `speed` in m/s; `t` seconds (idle motion). */
export function walkPose(out: Pose, phase: number, speed: number, t: number): Pose {
  const r = restPose();
  Object.assign(out, r);
  const run = clamp01((speed - 3.2) / 2.5);
  const A = Math.min(1, speed / 1.6) * (0.42 + run * 0.32);
  const s = Math.sin(phase), c = Math.cos(phase);
  if (speed < 0.15) return idlePose(out, t);
  out.lHip = [-s * A, 0.02];
  out.rHip = [s * A, -0.02];
  // Knee bends while the leg swings forward, more when running.
  out.lKnee = 0.08 + Math.max(0, c) * A * (1.3 + run * 1.2) + Math.max(0, s) * 0.12 * A;
  out.rKnee = 0.08 + Math.max(0, -c) * A * (1.3 + run * 1.2) + Math.max(0, -s) * 0.12 * A;
  // Arms swing against the legs; elbows bend more when running.
  const armA = A * (0.75 + run * 0.4);
  out.lSh = [s * armA, 0, 0.08 + run * 0.08];
  out.rSh = [-s * armA, 0, -0.08 - run * 0.08];
  out.lEl = -(0.2 + run * 1.1 + Math.max(0, -s) * 0.35 * A);
  out.rEl = -(0.2 + run * 1.1 + Math.max(0, s) * 0.35 * A);
  // Body: bob (highest when the legs pass), hip turn, counter-turned chest, lean when running.
  out.y = (Math.cos(2 * phase) * 0.5 - 0.5) * (0.025 + run * 0.04) * Math.min(1, speed);
  out.twist = s * 0.1 * A;
  out.chestTwist = -s * 0.18 * A;
  out.sway = s * 0.025;
  out.lean = 0.03 + run * 0.17;
  out.headX = -out.lean * 0.6;
  out.headY = -out.twist - out.chestTwist * 0.6;
  return out;
}

/** Standing: breathing, small weight shifts and a look around now and then. */
export function idlePose(out: Pose, t: number): Pose {
  Object.assign(out, restPose());
  const br = Math.sin(t * 1.7);
  out.chestX = -br * 0.012;
  out.lSh = [br * 0.015, 0, 0.07 + br * 0.01];
  out.rSh = [-br * 0.015, 0, -0.07 - br * 0.01];
  const shift = Math.sin(t * 0.45);
  out.sway = shift * 0.025;
  out.lHip = [0, 0.02 - shift * 0.025];
  out.rHip = [0, -0.02 - shift * 0.025];
  out.lKnee = 0.05 + Math.max(0, shift) * 0.08;
  out.rKnee = 0.05 + Math.max(0, -shift) * 0.08;
  const look = Math.sin(t * 0.31) * Math.sin(t * 0.17);
  out.headY = look * 0.55;
  out.headX = Math.sin(t * 0.23) * 0.06;
  return out;
}

/** In the air: knees up, arms out. */
export function airPose(out: Pose): Pose {
  Object.assign(out, restPose());
  out.lHip = [-0.6, 0.05]; out.rHip = [0.15, -0.05];
  out.lKnee = 1.0; out.rKnee = 0.5;
  out.lSh = [-0.5, 0, 0.45]; out.rSh = [-0.5, 0, -0.45];
  out.lEl = -0.5; out.rEl = -0.5;
  out.lean = 0.08;
  return out;
}

/** Aiming a pistol with both hands along the view. */
export function aimArms(out: Pose) {
  out.rSh = [-Math.PI / 2 + 0.06, 0, 0.05];
  out.rEl = -0.02;
  out.lSh = [-Math.PI / 2 + 0.25, 0, -0.55];
  out.lEl = -0.45;
  out.chestTwist = 0.18;
  out.headY = -0.15;
}

/** Lying knocked down: limbs loose. */
export function limpPose(out: Pose): Pose {
  Object.assign(out, restPose());
  out.lSh = [-0.3, 0, 0.9]; out.rSh = [0.2, 0, -1.0];
  out.lEl = -0.6; out.rEl = -0.3;
  out.lHip = [-0.1, 0.18]; out.rHip = [-0.35, -0.12];
  out.lKnee = 0.2; out.rKnee = 0.7;
  out.headY = 0.5;
  return out;
}

/** Dancing (club): hip sways and arm moves; `style` picks one of several routines. */
export function dancePose(out: Pose, t: number, style: number): Pose {
  Object.assign(out, restPose());
  const b = t * Math.PI * 2 * 0.95; // ~114 bpm feel
  const s = Math.sin(b), c = Math.cos(b), s2 = Math.sin(b * 0.5);
  out.sway = s * 0.12;
  out.chestZ = -s * 0.1;
  out.y = -Math.abs(c) * 0.035;
  out.lHip = [-0.05, 0.05 + Math.max(0, s) * 0.08];
  out.rHip = [-0.05, -0.05 - Math.max(0, -s) * 0.08];
  out.lKnee = 0.12 + Math.max(0, -s) * 0.25;
  out.rKnee = 0.12 + Math.max(0, s) * 0.25;
  out.headZ = s * 0.12;
  out.headY = s2 * 0.3;
  switch (style % 4) {
    case 0: // arms up, waving
      out.lSh = [-0.2, 0, 2.4 + s * 0.25]; out.rSh = [-0.2, 0, -2.4 + s * 0.25];
      out.lEl = -0.5 - c * 0.3; out.rEl = -0.5 + c * 0.3;
      break;
    case 1: // hands on hips, body rolls
      out.lSh = [0.2, 0, 0.55]; out.rSh = [0.2, 0, -0.55];
      out.lEl = -1.9; out.rEl = -1.9;
      out.chestX = s * 0.12; out.twist = s2 * 0.35;
      break;
    case 2: // one arm up, one swinging
      out.lSh = [-0.3, 0, 2.6]; out.lEl = -0.3;
      out.rSh = [-0.6 - s * 0.6, 0, -0.35]; out.rEl = -0.9;
      out.twist = s * 0.25;
      break;
    default: // around the pole: one hand up holding it, leaning out
      out.rSh = [-0.4, 0, -2.5]; out.rEl = -0.2;
      out.lSh = [0.3 + s * 0.3, 0, 0.8]; out.lEl = -0.4;
      out.sway = 0.18 + s * 0.06; out.chestZ = -0.15;
      out.lKnee = 0.5 + Math.max(0, s) * 0.6; out.lHip = [-0.5 - Math.max(0, s) * 0.4, 0.1];
      break;
  }
  return out;
}

/** Sitting on a chair (seat 0.45 m): thighs forward, shins down. */
export function sitPose(out: Pose, t: number): Pose {
  idlePose(out, t);
  out.y = -0.5;
  out.lHip = [-1.5, 0.08]; out.rHip = [-1.5, -0.08];
  out.lKnee = 1.5; out.rKnee = 1.5;
  out.lSh = [-0.3, 0, 0.12]; out.rSh = [-0.4, 0, -0.12];
  out.lEl = -0.9; out.rEl = -1.0;
  out.sway = 0;
  return out;
}
