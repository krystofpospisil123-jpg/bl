// The on-foot player: character physics + animated model, kept in sync.
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { CharacterPhysics, type MoveInput } from './CharacterPhysics.ts';
import { CharacterModel } from './CharacterModel.ts';

export class Player {
  readonly physics: CharacterPhysics;
  readonly model = new CharacterModel();
  readonly position = new THREE.Vector3(); // feet
  yaw = 0;
  private active = true;

  constructor(phys: PhysicsWorld, feet: THREE.Vector3, yaw = 0) {
    this.physics = new CharacterPhysics(phys.R, phys.world, feet);
    this.yaw = yaw;
    this.sync(0);
  }

  get body() {
    return this.physics.body;
  }

  get speed() {
    return this.physics.speed;
  }

  /** Hides the player and removes its collider (e.g. while sitting in a car). */
  setActive(on: boolean) {
    this.active = on;
    this.physics.setEnabled(on);
    this.model.root.visible = on;
  }

  get isActive() {
    return this.active;
  }

  teleport(feet: THREE.Vector3, yaw?: number) {
    this.physics.teleport(feet);
    if (yaw !== undefined) this.yaw = yaw;
    this.sync(0);
  }

  control(input: MoveInput, dt: number) {
    if (this.active) this.physics.update(input, dt);
  }

  /** Copies physics to the model and animates; call once per frame after stepping. */
  sync(dt: number) {
    const f = this.physics.feet;
    this.position.set(f.x, f.y, f.z);
    const v = this.physics.velocity;
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0.3) {
      // Turn smoothly toward the movement direction.
      const target = Math.atan2(v.x, v.z);
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 12));
    }
    this.model.root.position.copy(this.position);
    this.model.root.rotation.y = this.yaw;
    this.model.animate(sp, this.physics.grounded, dt);
  }
}
