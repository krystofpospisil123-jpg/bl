// Shared materials and procedurally generated textures (no external assets).
import * as THREE from 'three';
import { makeFacadeAtlas, applyFacadeAtlas } from './facades.ts';

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

/** Tileable value noise used to break up flat colours. */
export function makeNoiseCanvas(size = 128, seed = 1, grid = 16): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const cells = size / grid;
  const v: number[] = [];
  for (let i = 0; i < cells * cells; i++) v.push(rnd());
  const at = (x: number, y: number) => v[((y + cells) % cells) * cells + ((x + cells) % cells)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = x / grid, fy = y / grid;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const n = (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
      const val = Math.round(255 * (0.7 * n + 0.3 * rnd()));
      const k = (y * size + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = val;
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** Normal map for small water ripples, derived from a noise height field. */
function makeWaterNormals(): THREE.Texture {
  const size = 256;
  const h = makeNoiseCanvas(size, 11, 32).getContext('2d')!.getImageData(0, 0, size, size).data;
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
    detailTexture = new THREE.CanvasTexture(makeNoiseCanvas(256, 23, 8));
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
        diffuseColor.rgb *= 0.78 + 0.22 * dNear + 0.18 * (dFar - 0.5);`,
      );
  };
  mat.customProgramCacheKey = () => 'ground-detail';
}

export class Materials {
  readonly walls: THREE.MeshStandardMaterial;
  readonly roofs: THREE.MeshStandardMaterial;
  readonly flatRoofs = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  readonly trees = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  readonly water: THREE.MeshStandardMaterial;
  readonly bridge = new THREE.MeshStandardMaterial({ color: 0x9a958e, roughness: 0.85 });
  readonly bridgeDeck = new THREE.MeshStandardMaterial({ color: 0x4a4a4c, roughness: 0.75 });
  readonly overview = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  readonly props = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 });

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
  }

  /** Per-chunk ground material (it owns the chunk's painted ground texture). */
  makeGround(map: THREE.Texture): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 });
    applyGroundDetail(m);
    return m;
  }
}
