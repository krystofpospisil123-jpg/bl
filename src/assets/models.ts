// Vehicle and pedestrian models made in Blender (scripts/blender/, built in a hosted Blender
// scene and exported to public/data/models/vehicles.glb). Original designs loosely inspired by
// common Czech cars (hatchback, liftback, estate, large saloon, SUV, city car) without any
// brand names or logos.
//
// Every car is baked into one geometry with per-vertex colour, a paint mask (where the
// per-instance body colour applies) and roughness, so a whole fleet of one type is a single
// instanced draw call. The player's car keeps the original materials (brake lights).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const CAR_TYPES = ['hatch', 'liftback', 'estate', 'superb', 'suv', 'city', 'rosso', 'gt'] as const;
export type CarType = (typeof CAR_TYPES)[number];
/** Relative frequency of each type in traffic and car parks. */
const TYPE_WEIGHTS: Record<CarType, number> = { hatch: 0.235, liftback: 0.235, estate: 0.175, superb: 0.08, suv: 0.14, city: 0.12, rosso: 0.007, gt: 0.008 };
/** Sports cars (scripts/blender/sportscars.py): rare in traffic. */
export const SPORTS_TYPES: CarType[] = ['rosso', 'gt'];

/** Road surface in the car frame (the chassis origin used by physics, traffic and car parks). */
export const CAR_GROUND = -0.71;

export interface CarAsset {
  /** Detailed and simplified geometry (body and wheels), ground at CAR_GROUND. */
  hi: THREE.BufferGeometry;
  lo: THREE.BufferGeometry;
  /** For the player's car: body without wheels and tail lights, the tail lights, one wheel. */
  body: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  /** Wheel centres in the car frame: front left, front right, rear left, rear right. */
  wheelPos: THREE.Vector3[];
  halfLength: number;
  halfWidth: number;
}

export interface PersonAsset {
  torso: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  /** Limbs hang from their joint at the origin (shoulder, hip). */
  arm: THREE.BufferGeometry;
  hand: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
}

/** Police car (estate with livery): like a CarAsset plus the two flashing light-bar halves. */
export interface PoliceAsset extends CarAsset {
  beaconL: THREE.BufferGeometry;
  beaconR: THREE.BufferGeometry;
}

export const assets: { cars?: Record<CarType, CarAsset>; police?: PoliceAsset; person?: PersonAsset } = {};

const ROUGHNESS: Record<string, number> = {
  livery_blue: 0.4, livery_yellow: 0.4, livery_text: 0.4,
  glass: 0.04, chrome: 0.18, rim: 0.28, tyre: 0.92, trim: 0.6, headlight: 0.15, taillight: 0.3,
  plate: 0.5, plateblue: 0.5, indicator: 0.3, shoe: 0.7, hair: 0.9, eye: 0.3,
};

/** Picks a car type for a seed in [0, 1). */
export function carTypeFor(r: number): CarType {
  let acc = 0;
  for (const t of CAR_TYPES) {
    acc += TYPE_WEIGHTS[t];
    if (r < acc) return t;
  }
  return 'hatch';
}

/**
 * Merges all meshes under `node` (in the node's own frame) into one geometry with `color`,
 * `paintMask` and `rough` attributes. Paint and tint materials become white (instance colour).
 */
function bake(node: THREE.Object3D, skip?: (mat: string, centre: THREE.Vector3) => boolean, tint = (mat: string) => mat.startsWith('paint')): THREE.BufferGeometry {
  node.updateMatrixWorld(true);
  const inv = node.matrixWorld.clone().invert();
  const parts: THREE.BufferGeometry[] = [];
  const c = new THREE.Color();
  const centre = new THREE.Vector3();
  node.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mat = o.material as THREE.MeshStandardMaterial;
    const name = mat.name ?? '';
    const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    src.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', src.attributes.position);
    g.setAttribute('normal', src.attributes.normal);
    if (skip) {
      // Drop whole triangles the caller does not want (e.g. wheels for the player's body).
      const p = src.attributes.position, n = src.attributes.normal;
      const keepP: number[] = [], keepN: number[] = [];
      for (let i = 0; i < p.count; i += 3) {
        centre.set(0, 0, 0);
        for (let k = 0; k < 3; k++) centre.add(new THREE.Vector3().fromBufferAttribute(p, i + k));
        centre.multiplyScalar(1 / 3);
        if (skip(name, centre)) continue;
        for (let k = 0; k < 3; k++) {
          keepP.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
          keepN.push(n.getX(i + k), n.getY(i + k), n.getZ(i + k));
        }
      }
      if (!keepP.length) return;
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(keepP, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(keepN, 3));
    }
    const tinted = tint(name) || name === 'tint';
    if (tinted) c.setRGB(1, 1, 1);
    else {
      c.copy(mat.color);
      if (mat.emissive && mat.emissiveIntensity > 0) c.add(mat.emissive.clone().multiplyScalar(0.5));
    }
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3), mask = new Float32Array(n), rough = new Float32Array(n);
    const r = ROUGHNESS[name] ?? (name.startsWith('paint') ? 0.3 : 0.75);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      mask[i] = tint(name) ? 1 : 0;
      rough[i] = r;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('paintMask', new THREE.BufferAttribute(mask, 1));
    g.setAttribute('rough', new THREE.BufferAttribute(rough, 1));
    parts.push(g);
  });
  const out = mergeGeometries(parts)!;
  out.computeBoundingSphere();
  return out;
}

/**
 * Makes a material use the baked car attributes: the per-instance colour only tints the paint,
 * and roughness comes from the vertices (glossy glass and paint, matt tyres).
 */
export function useCarAttributes(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  mat.vertexColors = true;
  mat.roughness = 1;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float paintMask;\nattribute float rough;\nvarying float vRough;\n' + shader.vertexShader
      .replace('vColor.rgb *= instanceColor.rgb;', 'vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, paintMask);')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvRough = rough;');
    shader.fragmentShader = 'varying float vRough;\n' + shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vRough;');
  };
  mat.customProgramCacheKey = () => 'car-attributes-v1';
  mat.needsUpdate = true;
  return mat;
}

export async function loadModels(buffer: ArrayBuffer, sports: ArrayBuffer | null = null): Promise<void> {
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const root = gltf.scene;
  if (sports) {
    try {
      root.add((await new GLTFLoader().parseAsync(sports, '')).scene);
    } catch (err) {
      console.warn('Sportovní auta se nenačetla', err);
    }
  }
  root.updateMatrixWorld(true);
  const find = (name: string) => root.getObjectByName(name);
  const loadCar = (t: string, extraSkip = (_m: string) => false): CarAsset => {
    const carRoot = find(`car_${t}`), hiNode = find(`car_${t}_hi`), loNode = find(`car_${t}_lo`), wheelNode = find(`car_${t}_wheel`);
    if (!carRoot || !hiNode || !loNode || !wheelNode) throw new Error(`Model auta ${t} chybí`);
    const inv = carRoot.matrixWorld.clone().invert();
    const wheelPos = ['FL', 'FR', 'RL', 'RR'].map((k) => {
      const e = find(`car_${t}_w${k}`)!;
      return new THREE.Vector3().setFromMatrixPosition(e.matrixWorld).applyMatrix4(inv).add(new THREE.Vector3(0, CAR_GROUND, 0));
    });
    const hi = bake(hiNode).translate(0, CAR_GROUND, 0);
    const lo = bake(loNode).translate(0, CAR_GROUND, 0);
    hi.computeBoundingBox();
    const bb = hi.boundingBox!;
    // Player body: the scene node without tyres, rims and hub caps (its wheels turn separately).
    const radius = wheelPos[0].y - CAR_GROUND;
    const wheelsAt = wheelPos.map((p) => p.clone().sub(new THREE.Vector3(0, CAR_GROUND, 0)));
    const isWheel = (mat: string, ctr: THREE.Vector3) => mat === 'tyre' || mat === 'rim' || (mat === 'trim' && wheelsAt.some((w) => w.distanceTo(ctr) < radius * 0.5));
    const body = bake(hiNode, (mat, ctr) => mat === 'taillight' || extraSkip(mat) || isWheel(mat, ctr)).translate(0, CAR_GROUND, 0);
    const tail = bake(hiNode, (mat) => mat !== 'taillight').translate(0, CAR_GROUND, 0);
    // Rims are tintable (tuning: rim colour via the instance colour).
    const wheel = bake(wheelNode, undefined, (m) => m === 'rim');
    return { hi, lo, body, tail, wheel, wheelPos, halfLength: Math.max(-bb.min.z, bb.max.z), halfWidth: (bb.max.x - bb.min.x) / 2 - 0.1 };
  };
  const cars = {} as Record<CarType, CarAsset>;
  for (const t of CAR_TYPES) {
    try {
      cars[t] = loadCar(t);
    } catch (err) {
      // Missing sports car file: use the liftback instead.
      if (!SPORTS_TYPES.includes(t)) throw err;
      cars[t] = cars.liftback;
    }
  }
  const policeNode = find('car_police_hi');
  if (policeNode) {
    const beacon = (m: string) => m === 'beaconL' || m === 'beaconR';
    const p = loadCar('police', beacon);
    assets.police = {
      ...p,
      beaconL: bake(policeNode, (m) => m !== 'beaconL').translate(0, CAR_GROUND, 0),
      beaconR: bake(policeNode, (m) => m !== 'beaconR').translate(0, CAR_GROUND, 0),
    };
  }
  const part = (name: string) => {
    const n = find(name);
    if (!n) throw new Error(`Model postavy ${name} chybí`);
    return bake(n);
  };
  assets.cars = cars;
  assets.person = { torso: part('npc_torso'), head: part('npc_head'), arm: part('npc_arm'), hand: part('npc_hand'), leg: part('npc_leg') };
}
