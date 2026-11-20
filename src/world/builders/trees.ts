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
  const deciduous0 = mergeGeometries([
    trunk(0.035, 0.45, 5),
    colored(new THREE.IcosahedronGeometry(0.3, 1).scale(1, 0.85, 1).translate(0, 0.66, 0), 0x4e7a32),
  ])!;
  const deciduous1 = colored(new THREE.OctahedronGeometry(0.32).scale(1, 0.9, 1).translate(0, 0.62, 0), 0x4a7230);
  const conifer0 = mergeGeometries([
    trunk(0.03, 0.25, 5),
    colored(new THREE.ConeGeometry(0.2, 0.5, 7).translate(0, 0.45, 0), 0x2f5229),
    colored(new THREE.ConeGeometry(0.15, 0.42, 7).translate(0, 0.75, 0), 0x335a2c),
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
