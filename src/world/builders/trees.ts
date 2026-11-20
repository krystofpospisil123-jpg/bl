// Instanced low-poly trees. Two species shapes x two detail levels, unit height 1.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HeightField } from '../HeightField.ts';

function colored(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function makeGeometries() {
  const trunk = (r: number, h: number, seg: number) => colored(new THREE.CylinderGeometry(r * 0.7, r, h, seg).translate(0, h / 2, 0), 0x5b4632);
  // Crown made of several leaf clumps, lighter on top for a sunlit look.
  const clump = (r: number, x: number, y: number, z: number, hex: number) =>
    colored(new THREE.IcosahedronGeometry(r, 1).scale(1, 0.85, 1).translate(x, y, z), hex);
  const deciduous0 = mergeGeometries([
    trunk(0.035, 0.5, 6),
    clump(0.24, 0, 0.6, 0, 0x45702c),
    clump(0.19, 0.13, 0.7, 0.06, 0x4f7c33),
    clump(0.18, -0.12, 0.68, -0.07, 0x4a7630),
    clump(0.16, 0.02, 0.84, -0.02, 0x5b8a3a),
    clump(0.15, -0.05, 0.62, 0.15, 0x41682a),
  ])!;
  const deciduous1 = colored(new THREE.OctahedronGeometry(0.32).scale(1, 0.9, 1).translate(0, 0.62, 0), 0x4a7230);
  const conifer0 = mergeGeometries([
    trunk(0.03, 0.25, 5),
    colored(new THREE.ConeGeometry(0.21, 0.42, 8).translate(0, 0.38, 0), 0x2b4c26),
    colored(new THREE.ConeGeometry(0.17, 0.38, 8).translate(0, 0.6, 0), 0x2f5229),
    colored(new THREE.ConeGeometry(0.12, 0.34, 8).translate(0, 0.82, 0), 0x36602e),
  ])!;
  const conifer1 = colored(new THREE.ConeGeometry(0.19, 0.85, 4).translate(0, 0.52, 0), 0x2f5229);
  for (const g of [deciduous0, deciduous1, conifer0, conifer1]) g.computeVertexNormals();
  return { deciduous: [deciduous0, deciduous1], conifer: [conifer0, conifer1] };
}

let shared: ReturnType<typeof makeGeometries> | null = null;

export class ChunkTrees {
  readonly group = new THREE.Group();
  private meshes: { mesh: THREE.InstancedMesh; type: 'deciduous' | 'conifer' }[] = [];

  constructor(trees: number[], heights: HeightField, material: THREE.Material, lod: number) {
    shared ??= makeGeometries();
    const byType: number[][] = [[], []];
    for (let i = 0; i < trees.length; i += 4) byType[trees[i + 3]].push(i);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    (['deciduous', 'conifer'] as const).forEach((type, t) => {
      const idx = byType[t];
      if (!idx.length) return;
      const mesh = new THREE.InstancedMesh(shared![type][Math.min(lod, 1)], material, idx.length);
      idx.forEach((i, k) => {
        const x = trees[i], z = trees[i + 1], h = trees[i + 2];
        const rnd = fract(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453);
        const wide = 0.85 + 0.35 * rnd;
        p.set(x, heights.sample(x, z) - 0.2, z);
        q.setFromAxisAngle(up, rnd * Math.PI * 2);
        s.set(h * wide, h, h * wide);
        mesh.setMatrixAt(k, m.compose(p, q, s));
        const v = 0.8 + 0.4 * rnd, warm = fract(rnd * 7.31);
        color.setRGB(v * (0.92 + 0.2 * warm), v, v * (0.9 - 0.1 * warm));
        mesh.setColorAt(k, color);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.meshes.push({ mesh, type });
      this.group.add(mesh);
    });
  }

  setLod(lod: number) {
    for (const { mesh, type } of this.meshes) mesh.geometry = shared![type][Math.min(lod, 1)];
  }

  dispose() {
    for (const { mesh } of this.meshes) mesh.dispose();
  }
}

function fract(v: number) {
  return v - Math.floor(v);
}
