// Shared materials and procedurally generated textures (no external assets).
import * as THREE from 'three';
import { makeFacadeAtlas, applyFacadeAtlas } from './facades.ts';
import { makeNoiseCanvas } from './noise.ts';
export { makeNoiseCanvas } from './noise.ts';

/** Roof tile texture (u along the ridge, v down the slope; 1 unit = 4 m). */
function makeRoofTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) {
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(0, y, 128, 2);
    for (let x = (y / 8) % 2 ? 0 : 6; x < 128; x += 12) {
      g.fillStyle = 'rgba(0,0,0,0.1)';
      g.fillRect(x, y, 1, 8);
      g.fillStyle = `rgba(255,255,255,${(Math.random() * 0.08).toFixed(3)})`;
      g.fillRect(x + 1, y + 2, 10, 5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Normal map for small water ripples, derived from a noise height field. */
function makeWaterNormals(): THREE.Texture {
  const size = 256;
  const h = (makeNoiseCanvas(size, 11, 32).getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, size, size).data;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const H = (x: number, y: number) => h[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * 2.5, dy = (H(x, y + 1) - H(x, y - 1)) * 2.5;
      const l = Math.hypot(dx, dy, 1);
      const k = (y * size + x) * 4;
      img.data[k] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[k + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      img.data[k + 2] = (1 / l) * 255;
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Shared time uniform for animated materials (wind, water). */
export const timeUniform = { value: 0 };

let detailTexture: THREE.Texture | null = null;

/**
 * Adds world-space detail noise to a ground material so the terrain does not look blurry
 * up close (two scales, ~3 m and ~17 m).
 */
export function applyGroundDetail(mat: THREE.MeshStandardMaterial) {
  if (!detailTexture) {
    detailTexture = new THREE.CanvasTexture(makeNoiseCanvas(256, 23, 8) as HTMLCanvasElement);
    detailTexture.wrapS = detailTexture.wrapT = THREE.RepeatWrapping;
    detailTexture.anisotropy = 8;
  }
  const tex = detailTexture;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: tex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec2 vWorldXZ;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float dNear = texture2D(detailMap, vWorldXZ / 3.0).r;
        float dFar = texture2D(detailMap, vWorldXZ / 17.0).g;
        diffuseColor.rgb *= 0.78 + 0.22 * dNear + 0.18 * (dFar - 0.5);
        // Paving blocks on light grey surfaces (sidewalks, squares, parking): offset-bond
        // pattern with grout lines, faded out where it would alias.
        vec3 base = diffuseColor.rgb;
        float lum = dot(base, vec3(0.299, 0.587, 0.114));
        float sat = max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b));
        float paved = smoothstep(0.12, 0.2, lum) * (1.0 - smoothstep(0.05, 0.1, sat));
        vec2 pv = vWorldXZ / vec2(0.3, 0.15);
        pv.x += 0.5 * mod(floor(pv.y), 2.0);
        vec2 pf = fract(pv);
        vec2 pw = fwidth(pv);
        float fade = clamp(1.0 - max(pw.x, pw.y) * 1.5, 0.0, 1.0);
        float joint = 1.0 - smoothstep(0.0, 0.08 + pw.x, min(pf.x, 1.0 - pf.x)) * smoothstep(0.0, 0.12 + pw.y, min(pf.y, 1.0 - pf.y));
        float tint = fract(sin(dot(floor(pv), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
        diffuseColor.rgb *= 1.0 - paved * fade * (0.3 * joint - 0.08 * tint);
        // Worn asphalt: darker repair patches and thin cracks on dark grey surfaces.
        float asphalt = (1.0 - smoothstep(0.05, 0.1, lum)) * (1.0 - smoothstep(0.015, 0.03, sat))
          * step(base.g, base.b + 0.006); // asphalt is neutral to slightly blue; grass is greener
        float patchN = texture2D(detailMap, vWorldXZ / 41.0 + 0.37).b;
        float patches = smoothstep(0.62, 0.66, patchN);
        float crackN = texture2D(detailMap, vWorldXZ / 9.0 + 0.11).r;
        float cracks = (1.0 - smoothstep(0.0, 0.012 + fwidth(crackN), abs(crackN - 0.5))) * fade;
        diffuseColor.rgb *= 1.0 - asphalt * (0.18 * patches + 0.35 * cracks);`,
      );
  };
  mat.customProgramCacheKey = () => 'ground-detail-v4';
}

export class Materials {
  readonly walls: THREE.MeshStandardMaterial;
  readonly roofs: THREE.MeshStandardMaterial;
  readonly flatRoofs = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  readonly trees = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  readonly water: THREE.MeshStandardMaterial;
  readonly bridge = new THREE.MeshStandardMaterial({ color: 0x9a958e, roughness: 0.85 });
  readonly bridgeDeck = new THREE.MeshStandardMaterial({ color: 0x4a4a4c, roughness: 0.75 });
  readonly bridgeRail = new THREE.MeshStandardMaterial({ color: 0x3f78c4, roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide });
  readonly overview = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  readonly props = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
  readonly parkedCars = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.3 });
  /** Floor-fountain jets: translucent water columns that pulse up and down. */
  readonly jets = new THREE.MeshStandardMaterial({ color: 0xe6f2ff, transparent: true, opacity: 0.55, roughness: 0.05, depthWrite: false });

  constructor() {
    const atlas = makeFacadeAtlas();
    this.walls = new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas.map, roughnessMap: atlas.roughness, roughness: 1, metalness: 0.05 });
    applyFacadeAtlas(this.walls);
    this.roofs = new THREE.MeshStandardMaterial({ vertexColors: true, map: makeRoofTexture(), roughness: 0.8 });

    const normals = makeWaterNormals();
    normals.repeat.set(1 / 12, 1 / 12);
    this.water = new THREE.MeshStandardMaterial({
      color: 0x2f5560, roughness: 0.06, metalness: 0.1, normalMap: normals, normalScale: new THREE.Vector2(0.35, 0.35),
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    // Water uses world-space UVs and scrolls the ripples over time.
    this.water.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvNormalMapUv = (modelMatrix * vec4(position, 1.0)).xz / 9.0 + vec2(uTime * 0.02, uTime * 0.013);');
    };
    this.water.customProgramCacheKey = () => 'water';

    // Wind: sway tree crowns, more at the top, phase from the instance position.
    this.trees.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            float sway = smoothstep(0.35, 1.0, position.y);
            float ph = uTime * 1.3 + iPos.x * 0.05 + iPos.z * 0.07;
            transformed.x += sin(ph) * 0.025 * sway + sin(ph * 2.7) * 0.01 * sway;
            transformed.z += cos(ph * 0.8) * 0.02 * sway;
          #endif`,
        );
    };
    this.trees.customProgramCacheKey = () => 'trees-wind';

    this.jets.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3][0] * 2.1 + instanceMatrix[3][2] * 1.3;
            transformed.y *= 0.35 + 0.65 * abs(sin(uTime * 0.9 + ph));
          #endif`,
        );
    };
    this.jets.customProgramCacheKey = () => 'jets';
  }

  /** Per-chunk ground material (it owns the chunk's painted ground texture). */
  makeGround(map: THREE.Texture): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
    applyGroundDetail(m);
    return m;
  }
}
