// A drivable car: Rapier physics + procedural model, kept in sync every frame.
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { CarPhysics, CAR_SPEC, type CarInput } from './CarPhysics.ts';
import { CarModel } from './CarModel.ts';

export class Car {
  readonly physics: CarPhysics;
  readonly model: CarModel;
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  yaw = 0;
  private wheelSpin = [0, 0, 0, 0];

  constructor(phys: PhysicsWorld, pos: THREE.Vector3, yaw: number, color?: number) {
    this.physics = new CarPhysics(phys.R, phys.world, pos, yaw);
    this.model = new CarModel(color);
    this.sync();
  }

  get speed(): number {
    return this.physics.speed;
  }

  get body() {
    return this.physics.body;
  }

  /** True when the car is lying on its side or roof. */
  get flipped(): boolean {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
    return up.y < 0.3;
  }

  control(input: CarInput, dt: number) {
    this.physics.update(input, dt);
    this.model.setBraking(input.brake > 0 && this.speed > 0.5 || input.handbrake);
  }

  /** Copies the physics state to the model (call after the physics step). */
  sync(dt = 0) {
    const t = this.physics.body.translation();
    const r = this.physics.body.rotation();
    this.position.set(t.x, t.y, t.z);
    this.quaternion.set(r.x, r.y, r.z, r.w);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
    this.yaw = Math.atan2(fwd.x, fwd.z);
    this.model.root.position.copy(this.position);
    this.model.root.quaternion.copy(this.quaternion);

    const v = this.physics.vehicle;
    for (let i = 0; i < 4; i++) {
      const w = this.model.wheels[i];
      const conn = v.wheelChassisConnectionPointCs(i)!;
      const susp = v.wheelSuspensionLength(i) ?? CAR_SPEC.suspensionRest;
      // Visual wheels sit slightly outboard so the tyres are flush with the body.
      w.position.set(conn.x * 1.06, conn.y - susp, conn.z);
      // Spin from forward speed (wheelRotation is not always updated without contact).
      this.wheelSpin[i] += (this.speed / CAR_SPEC.wheelRadius) * dt;
      w.rotation.set(this.wheelSpin[i], v.wheelSteering(i) ?? 0, 0, 'YXZ');
    }
  }

  reset(pos?: THREE.Vector3, yaw?: number) {
    this.physics.reset(pos, yaw);
    this.sync();
  }
}
