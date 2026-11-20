// On-foot player physics: Rapier kinematic character controller with a capsule.
// The body origin is the capsule centre; feet are FOOT_OFFSET below it.
import type RAPIER_NS from '@dimforge/rapier3d-compat';

type Rapier = typeof RAPIER_NS;

export const CHAR_SPEC = {
  radius: 0.3,
  halfHeight: 0.55, // cylinder part; total height = 2 * (halfHeight + radius) = 1.7 m
  runSpeed: 4.6,
  sprintSpeed: 7.2,
  accel: 22, // m/s² on the ground
  airAccel: 4,
  jumpSpeed: 5.2,
  gravity: 20, // a bit stronger than real for snappy jumps
};
export const FOOT_OFFSET = CHAR_SPEC.halfHeight + CHAR_SPEC.radius;

export interface MoveInput {
  /** Desired horizontal direction in world space (length 0..1). */
  x: number;
  z: number;
  sprint: boolean;
  jump: boolean;
}

export class CharacterPhysics {
  readonly body: RAPIER_NS.RigidBody;
  readonly collider: RAPIER_NS.Collider;
  readonly controller: RAPIER_NS.KinematicCharacterController;
  readonly velocity = { x: 0, y: 0, z: 0 };
  grounded = false;

  constructor(R: Rapier, private world: RAPIER_NS.World, feet: { x: number; y: number; z: number }) {
    this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(feet.x, feet.y + FOOT_OFFSET, feet.z));
    this.collider = world.createCollider(R.ColliderDesc.capsule(CHAR_SPEC.halfHeight, CHAR_SPEC.radius).setFriction(0), this.body);
    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((40 * Math.PI) / 180);
    this.controller.enableAutostep(0.45, 0.2, false);
    this.controller.enableSnapToGround(0.4);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setCharacterMass(80);
  }

  get feet() {
    const t = this.body.translation();
    return { x: t.x, y: t.y - FOOT_OFFSET, z: t.z };
  }

  /** Horizontal speed in m/s. */
  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  setEnabled(on: boolean) {
    this.collider.setEnabled(on);
    this.body.setEnabled(on);
  }

  teleport(feet: { x: number; y: number; z: number }) {
    const p = { x: feet.x, y: feet.y + FOOT_OFFSET, z: feet.z };
    this.body.setTranslation(p, true);
    this.body.setNextKinematicTranslation(p);
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
  }

  /** Runs one fixed step; call before world.step(). */
  update(input: MoveInput, dt: number) {
    const s = CHAR_SPEC;
    const top = input.sprint ? s.sprintSpeed : s.runSpeed;
    const tx = input.x * top, tz = input.z * top;
    const a = (this.grounded ? s.accel : s.airAccel) * dt;
    const dx = tx - this.velocity.x, dz = tz - this.velocity.z;
    const dl = Math.hypot(dx, dz);
    const k = dl > a ? a / dl : 1;
    this.velocity.x += dx * k;
    this.velocity.z += dz * k;

    if (this.grounded) {
      this.velocity.y = input.jump ? s.jumpSpeed : -1; // small push keeps us snapped to slopes
    } else {
      this.velocity.y -= s.gravity * dt;
    }

    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const m = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    // Lose horizontal speed when blocked by walls; stop rising when hitting a ceiling.
    if (dt > 0) {
      this.velocity.x = m.x / dt;
      this.velocity.z = m.z / dt;
      if (this.velocity.y > 0 && m.y < desired.y * 0.5) this.velocity.y = 0;
    }
    if (this.grounded && !wasGrounded && this.velocity.y < 0) this.velocity.y = -1;
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
  }

  dispose() {
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
