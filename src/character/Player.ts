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
  /** While aiming the player faces this way (the camera direction) instead of where they walk. */
  aimYaw: number | null = null;
  private active = true;
  private prevFeet = new THREE.Vector3();
  private snapNext = true;

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
    this.snapNext = true;
    if (yaw !== undefined) this.yaw = yaw;
    this.sync(0);
  }

  control(input: MoveInput, dt: number) {
    const f = this.physics.feet;
    this.prevFeet.set(f.x, f.y, f.z);
    this.snapNext = false;
    if (this.active) this.physics.update(input, dt);
  }

  /** Copies physics to the model and animates; call once per frame after stepping. */
  sync(dt: number, alpha = 1) {
    const f = this.physics.feet;
    this.position.set(f.x, f.y, f.z);
    if (this.snapNext) this.prevFeet.copy(this.position);
    else if (alpha < 1) this.position.lerpVectors(this.prevFeet, this.position, alpha);
    const v = this.physics.velocity;
    const sp = Math.hypot(v.x, v.z);
    if (this.aimYaw !== null) {
      let d = this.aimYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 20));
    } else if (sp > 0.3) {
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
