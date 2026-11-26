// A drivable car: Rapier physics + procedural model, kept in sync every frame.
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { CarPhysics, CAR_SPEC, type CarInput } from './CarPhysics.ts';
import { CarModel, CAR_COLORS } from './CarModel.ts';
import type { CarType } from '../assets/models.ts';
import { ENGINE, TYPE_POWER, stockTuning, type Tuning } from './Tuning.ts';

export class Car {
  readonly physics: CarPhysics;
  model: CarModel;
  /** Called on a crash with its strength (change of velocity, m/s). */
  onCrash?: (strength: number) => void;
  private prevVel = new THREE.Vector3();
  private crashCooldown = 0;
  /** Tuning parts fitted to this car (reset when you take another car). */
  tuning: Tuning = stockTuning();
  /** Current body colour and model (for leaving the old car behind after a theft). */
  look: { color: number; type: CarType } = { color: CAR_COLORS[0], type: 'liftback' };
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  yaw = 0;
  private wheelSpin = [0, 0, 0, 0];
  /** Body pose before the latest physics step, for blending the rendered pose. */
  private prevPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private snapNext = true;

  constructor(phys: PhysicsWorld, pos: THREE.Vector3, yaw: number, color?: number) {
    this.physics = new CarPhysics(phys.R, phys.world, pos, yaw);
    this.model = new CarModel(color);
    if (color !== undefined) this.look.color = color;
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
    // Remember the pose before this step (called once per fixed step).
    const t = this.physics.body.translation(), r = this.physics.body.rotation();
    this.prevPos.set(t.x, t.y, t.z);
    this.prevQuat.set(r.x, r.y, r.z, r.w);
    this.snapNext = false;
    this.physics.update(input, dt);
    this.model.setBraking((input.brake > 0 || input.handbrake) && this.speed > 0.5);
  }

  /**
   * Copies the physics state to the model (call after the physics step). `alpha` blends between
   * the pose before and after the latest step, so the car moves smoothly at any frame rate.
   */
  sync(dt = 0, alpha = 1) {
    const t = this.physics.body.translation();
    const r = this.physics.body.rotation();
    this.position.set(t.x, t.y, t.z);
    this.quaternion.set(r.x, r.y, r.z, r.w);
    if (this.snapNext) {
      this.prevPos.copy(this.position);
      this.prevQuat.copy(this.quaternion);
    } else if (alpha < 1) {
      this.position.lerpVectors(this.prevPos, this.position, alpha);
      this.quaternion.slerpQuaternions(this.prevQuat, this.quaternion, alpha);
    }
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
    this.yaw = Math.atan2(fwd.x, fwd.z);
    this.detectCrash(dt);
    this.model.root.position.copy(this.position);
    this.model.root.quaternion.copy(this.quaternion);

    const v = this.physics.vehicle;
    for (let i = 0; i < 4; i++) {
      const w = this.model.wheels[i];
      const conn = v.wheelChassisConnectionPointCs(i)!;
      const susp = v.wheelSuspensionLength(i) ?? CAR_SPEC.suspensionRest;
      // Visual wheels sit slightly outboard so the tyres are flush with the body.
      const anchor = this.model.wheelAnchors?.[i];
      if (anchor) w.position.set(anchor.x, conn.y - susp, anchor.z);
      else w.position.set(conn.x * 1.06, conn.y - susp, conn.z);
      // Spin from forward speed (wheelRotation is not always updated without contact).
      this.wheelSpin[i] += (this.speed / CAR_SPEC.wheelRadius) * dt;
      w.rotation.set(this.wheelSpin[i], v.wheelSteering(i) ?? 0, 0, 'YXZ');
    }
  }

  /**
   * A sudden change of velocity is a crash: dent the body on the side that hit something.
   * The change points from the car towards the obstacle (the velocity it lost).
   */
  private detectCrash(dt: number) {
    const lv = this.physics.body.linvel();
    const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
    const dv = this.prevVel.clone().sub(vel);
    dv.y *= 0.3; // landings dent less than walls
    this.crashCooldown = Math.max(0, this.crashCooldown - dt);
    const strength = dv.length();
    if (dt > 0 && strength > 3.5 && this.crashCooldown === 0) {
      this.crashCooldown = 0.25;
      const local = dv.clone().applyQuaternion(this.quaternion.clone().invert());
      local.y = 0;
      if (local.lengthSq() > 1e-4) {
        local.normalize();
        const hl = this.model.halfLength, hw = this.model.halfWidth;
        const t = Math.min(hl / Math.max(1e-3, Math.abs(local.z)), hw / Math.max(1e-3, Math.abs(local.x)));
        const point = local.clone().multiplyScalar(t);
        point.y = -0.15 + Math.random() * 0.3;
        const depth = Math.min(0.3, 0.04 + (strength - 3.5) * 0.03);
        this.model.dent(point, local.clone().negate(), depth, 0.7 + depth * 1.6);
      }
      this.onCrash?.(strength);
    }
    this.prevVel.copy(vel);
  }

  /** Rebuilds the look with the fitted tuning parts and sets the engine power. */
  applyTuning() {
    const t = this.tuning, m = this.model;
    m.setRimColor(t.rims);
    m.setSpoiler(t.spoiler ? this.look.color : null);
    m.setLowered(t.lowered);
    m.setNeon(t.neon);
    this.physics.power = ENGINE[t.engine].power * (TYPE_POWER[this.look.type] ?? 1);
  }

  /** Swaps the look (after stealing another car); physics stay the same. */
  setLook(color: number, type: CarType) {
    const parent = this.model.root.parent;
    parent?.remove(this.model.root);
    this.model = new CarModel(color, type);
    this.look = { color, type };
    parent?.add(this.model.root);
    this.sync();
  }

  reset(pos?: THREE.Vector3, yaw?: number) {
    this.prevVel.set(0, 0, 0);
    this.crashCooldown = 0.5;
    this.physics.reset(pos, yaw);
    this.snapNext = true;
    this.sync();
  }
}
