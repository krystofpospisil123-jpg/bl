import type { Overview } from '../world/WorldData.ts';
// Atmospheric sky with clouds, image-based lighting from that sky, fog, and a sun with a
// camera-following shadow map. Also builds the coarse distant terrain.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { Manifest } from '../world/format.ts';

export class Environment {
  readonly sun = new THREE.DirectionalLight(0xfff0dc, 3.4);
  readonly hemi = new THREE.HemisphereLight(0xc4d8ee, 0x5b5a43, 0.3);
  readonly sky = new Sky();
  /** The Preetham sky is much brighter than the lit scene; this scales it to match. */
  static readonly SKY_GAIN = 0.32;
  readonly sunDir = new THREE.Vector3();
  private shadowRange = 160;
  private pmrem: THREE.PMREMGenerator;
  private envTarget?: THREE.WebGLRenderTarget;

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    const horizon = new THREE.Color(0xa7b7c4);
    scene.fog = new THREE.Fog(horizon, 450, 2400);
    scene.background = horizon;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = c.bottom = -this.shadowRange;
    c.right = c.top = this.shadowRange;
    c.near = 1;
    c.far = 1200;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.5;
    scene.add(this.sun, this.sun.target, this.hemi);

    this.sky.scale.setScalar(4500);
    scaleSky(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3.5;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.cloudCoverage.value = 0.35;
    u.cloudDensity.value = 0.45;
    this.sky.material.fog = false;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.setSun(38, 215);
  }

  /** Sun elevation and azimuth in degrees (azimuth 180 = south). Rebuilds the sky lighting. */
  setSun(elevationDeg: number, azimuthDeg: number) {
    const elev = THREE.MathUtils.degToRad(elevationDeg), azim = THREE.MathUtils.degToRad(azimuthDeg);
    this.sunDir.set(Math.sin(azim) * Math.cos(elev), Math.sin(elev), -Math.cos(azim) * Math.cos(elev)).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.updateEnvironment();
  }

  /** Renders the sky into a prefiltered environment map used for reflections and ambient light. */
  updateEnvironment() {
    const envScene = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(4500);
    skyCopy.material.uniforms = THREE.UniformsUtils.clone(this.sky.material.uniforms);
    skyCopy.material.uniforms.showSunDisc.value = 0;
    scaleSky(skyCopy);
    envScene.add(skyCopy);
    // A dark ground hemisphere so reflections below the horizon are not sky-bright.
    const ground = new THREE.Mesh(new THREE.SphereGeometry(3000, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4a4f44, side: THREE.BackSide }));
    envScene.add(ground);
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(envScene, 0, 1, 5000);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.45;
    skyCopy.geometry.dispose();
    skyCopy.material.dispose();
    ground.geometry.dispose();
  }

  /** Keeps the sky on the camera, adapts haze to altitude and moves the shadow frustum. */
  update(camera: THREE.Camera, heightAboveGround: number, time: number) {
    this.sky.position.copy(camera.position);
    this.sky.material.uniforms.time.value = time;
    const fog = this.scene.fog as THREE.Fog;
    const k = THREE.MathUtils.clamp(heightAboveGround / 400, 0, 1);
    fog.near = 500 + 900 * k;
    fog.far = 2400 + 2200 * k;

    const focus = new THREE.Vector3();
    camera.getWorldDirection(focus);
    focus.y = 0;
    focus.normalize().multiplyScalar(this.shadowRange * 0.55).add(camera.position);
    const texel = (2 * this.shadowRange) / this.sun.shadow.mapSize.x;
    focus.x = Math.round(focus.x / texel) * texel;
    focus.z = Math.round(focus.z / texel) * texel;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 500);
  }

  setShadowQuality(size: number, range: number) {
    this.shadowRange = range;
    const c = this.sun.shadow.camera;
    c.left = c.bottom = -range;
    c.right = c.top = range;
    c.updateProjectionMatrix();
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }
}

function scaleSky(sky: Sky) {
  sky.material.fragmentShader = sky.material.fragmentShader.replace(
    'gl_FragColor = vec4( texColor, 1.0 );',
    `gl_FragColor = vec4( texColor * ${Environment.SKY_GAIN.toFixed(3)}, 1.0 );`,
  );
  sky.material.needsUpdate = true;
}

/**
 * Coarse terrain for the whole area (20 m grid) plus an apron beyond the edges, drawn
 * slightly below the detailed chunks so it only shows where chunks are not loaded.
 */
export function buildOverviewMesh(m: Manifest, o: Overview, material: THREE.Material): THREE.Mesh {
  const W = o.width, Hn = o.height;
  const apron = 4000;
  const rw = W + 2, rh = Hn + 2;
  const pos = new Float32Array(rw * rh * 3);
  const col = new Float32Array(rw * rh * 3);
  const c = new THREE.Color();
  const { min, max } = m.elevation;
  const at = (i: number, j: number) => o.heights[Math.min(Hn - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
  const maxX = o.minX + (W - 1) * o.step, maxZ = o.minZ + (Hn - 1) * o.step;
  for (let j = 0; j < rh; j++)
    for (let i = 0; i < rw; i++) {
      const gi = i - 1, gj = j - 1;
      const edgeX = gi < 0 ? -1 : gi >= W ? 1 : 0;
      const edgeZ = gj < 0 ? -1 : gj >= Hn ? 1 : 0;
      const x = edgeX < 0 ? o.minX - apron : edgeX > 0 ? maxX + apron : o.minX + gi * o.step;
      const z = edgeZ < 0 ? o.minZ - apron : edgeZ > 0 ? maxZ + apron : o.minZ + gj * o.step;
      const h = at(gi, gj);
      const k = (j * rw + i) * 3;
      pos[k] = x;
      pos[k + 1] = (edgeX || edgeZ ? h + 25 : h) - 1.5;
      pos[k + 2] = z;
      const t = (h - min) / (max - min);
      c.setRGB(0.22 + 0.06 * t, 0.3 - 0.04 * t, 0.15);
      col.set([c.r, c.g, c.b], k);
    }
  const idx: number[] = [];
  for (let j = 0; j < rh - 1; j++)
    for (let i = 0; i < rw - 1; i++) {
      const a = j * rw + i, b = a + 1, cc = a + rw, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  return mesh;
}
