// Money lying on the ground (dropped by pedestrians): a small spinning stack of banknotes
// that is collected by walking (or driving) over it.
import * as THREE from 'three';

interface Cash {
  pos: THREE.Vector3;
  amount: number;
  mesh: THREE.Mesh;
  age: number;
}

const geo = new THREE.BoxGeometry(0.34, 0.1, 0.18);
const mat = new THREE.MeshStandardMaterial({ color: 0x4f9a52, emissive: 0x1d5a22, roughness: 0.6 });

export class Pickups {
  readonly group = new THREE.Group();
  private items: Cash[] = [];

  drop(pos: THREE.Vector3, amount: number) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.items.push({ pos: pos.clone(), amount, mesh, age: 0 });
  }

  /** Spins the stacks; returns money collected by someone at `at` within `reach`. */
  update(dt: number, at: THREE.Vector3, reach: number, ground: (x: number, z: number) => number): number {
    let got = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const c = this.items[i];
      c.age += dt;
      const y = ground(c.pos.x, c.pos.z);
      c.mesh.position.set(c.pos.x, y + 0.35 + Math.sin(c.age * 3) * 0.08, c.pos.z);
      c.mesh.rotation.y = c.age * 2;
      const gone = c.age > 120 || c.pos.distanceTo(at) > 400;
      const taken = c.age > 0.6 && Math.hypot(c.pos.x - at.x, c.pos.z - at.z) < reach && Math.abs(y - at.y) < 3;
      if (taken) got += c.amount;
      if (taken || gone) {
        this.group.remove(c.mesh);
        this.items.splice(i, 1);
      }
    }
    return got;
  }
}
