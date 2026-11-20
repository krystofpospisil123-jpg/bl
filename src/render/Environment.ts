// Sky dome, fog, sun with a camera-following shadow map, and the distant terrain.
import * as THREE from 'three';
import type { Manifest } from '../world/format.ts';

export class Environment {
  readonly sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  readonly hemi = new THREE.HemisphereLight(0xbfd6ec, 0x5b5a43, 1.15);
  readonly sky: THREE.Mesh;
  private sunDir = new THREE.Vector3();
  private shadowRange = 160;

  constructor(private scene: THREE.Scene) {
    const horizon = new THREE.Color(0xc9d6df);
    scene.fog = new THREE.Fog(horizon, 400, 2200);
    scene.background = horizon;

    // Sun from the south-west, ~40° above the horizon.
    const elev = THREE.MathUtils.degToRad(40), azim = THREE.MathUtils.degToRad(215);
    this.sunDir.set(Math.sin(azim) * Math.cos(elev), Math.sin(elev), -Math.cos(azim) * Math.cos(elev)).normalize();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = c.bottom = -this.shadowRange;
    c.right = c.top = this.shadowRange;
    c.near = 1;
    c.far = 1200;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target, this.hemi);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(5000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(0x5d8fc4) },
          horizon: { value: horizon },
          sunDir: { value: this.sunDir },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir;
          varying vec3 vDir;
          void main() {
            float h = max(vDir.y, 0.0);
            vec3 col = mix(horizon, top, pow(h, 0.55));
            float s = max(dot(normalize(vDir), sunDir), 0.0);
            col += vec3(1.0, 0.9, 0.7) * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.18);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);
  }

  /** Keeps the sky centred on the camera and the shadow frustum around the viewer. */
  update(camera: THREE.Camera, heightAboveGround: number) {
    this.sky.position.copy(camera.position);
    // Thinner haze when looking down from high above.
    const fog = this.scene.fog as THREE.Fog;
    const k = THREE.MathUtils.clamp(heightAboveGround / 400, 0, 1);
    fog.near = 450 + 900 * k;
    fog.far = 2300 + 2200 * k;
    const focus = new THREE.Vector3();
    camera.getWorldDirection(focus);
    focus.y = 0;
    focus.normalize().multiplyScalar(this.shadowRange * 0.6).add(camera.position);
    // Snap to shadow texels to avoid shimmering while moving.
    const texel = (2 * this.shadowRange) / this.sun.shadow.mapSize.x;
    focus.x = Math.round(focus.x / texel) * texel;
    focus.z = Math.round(focus.z / texel) * texel;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 500);
  }
}

/**
 * Coarse terrain for the whole area (20 m grid) plus an apron beyond the edges, drawn
 * slightly below the detailed chunks so it only shows where chunks are not loaded.
 */
export function buildOverviewMesh(m: Manifest, o: { heights: Float32Array; size: number; step: number }, material: THREE.Material): THREE.Mesh {
  const n = o.size;
  const H = m.halfExtent;
  const apron = 4000;
  const ring = n + 2; // grid plus one apron vertex on each side
  const pos = new Float32Array(ring * ring * 3);
  const col = new Float32Array(ring * ring * 3);
  const c = new THREE.Color();
  const { min, max } = m.elevation;
  const at = (i: number, j: number) => o.heights[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  for (let j = 0; j < ring; j++)
    for (let i = 0; i < ring; i++) {
      const gi = i - 1, gj = j - 1;
      const edgeX = gi < 0 ? -apron : gi >= n ? apron : 0;
      const edgeZ = gj < 0 ? -apron : gj >= n ? apron : 0;
      const x = edgeX ? Math.sign(edgeX) * (H + apron) : -H + gi * o.step;
      const z = edgeZ ? Math.sign(edgeZ) * (H + apron) : -H + gj * o.step;
      const h = at(gi, gj);
      const k = (j * ring + i) * 3;
      pos[k] = x;
      pos[k + 1] = (edgeX || edgeZ ? h + 25 : h) - 1.5;
      pos[k + 2] = z;
      const t = (h - min) / (max - min);
      c.setRGB(0.3 + 0.08 * t, 0.4 - 0.06 * t, 0.22);
      col.set([c.r, c.g, c.b], k);
    }
  const idx: number[] = [];
  for (let j = 0; j < ring - 1; j++)
    for (let i = 0; i < ring - 1; i++) {
      const a = j * ring + i, b = a + 1, cc = a + ring, d = cc + 1;
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
