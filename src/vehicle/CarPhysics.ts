// Arcade car on top of Rapier's ray-cast vehicle controller.
// Local frame: +Z = forward, +Y = up, +X = left.
import type RAPIER_NS from '@dimforge/rapier3d-compat';

type Rapier = typeof RAPIER_NS;

export interface CarInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (brakes when moving forward, reverses when nearly stopped)
  steer: number; // -1 (right) .. 1 (left)
  handbrake: boolean;
}

export const CAR_SPEC = {
  halfExtents: { x: 0.9, y: 0.42, z: 2.3 }, // liftback model: 4.69 x 1.83 m
  mass: 1250,
  wheelRadius: 0.34,
  wheelX: 0.8,
  wheelZFront: 1.4,
  wheelZRear: -1.29,
  wheelY: -0.12,
  suspensionRest: 0.32,
  maxEngineForce: 7200, // N total, rear-wheel drive
  maxBrakeForce: 120, // per wheel (Rapier impulse-based brake units)
  maxSteer: 0.55, // rad at walking speed
  minSteer: 0.06, // rad at top speed
  topSpeed: 42, // m/s (~150 km/h)
  reverseSpeed: 9,
};

export class CarPhysics {
  readonly body: RAPIER_NS.RigidBody;
  readonly vehicle: RAPIER_NS.DynamicRayCastVehicleController;
  private steerSmooth = 0;
  /** Engine tuning: multiplies engine force and top speed (1 = stock). */
  power = 1;

  constructor(private R: Rapier, private world: RAPIER_NS.World, pos: { x: number; y: number; z: number }, yaw: number) {
    const s = CAR_SPEC;
    const q = yawQuat(yaw);
    // Mass comes from the additional mass properties so the centre of mass can sit low.
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation(q)
      .setLinearDamping(0.05)
      .setAngularDamping(0.8)
      .setCcdEnabled(true)
      .setAdditionalMassProperties(
        s.mass,
        { x: 0, y: -0.35, z: 0.05 },
        { x: s.mass * 0.6, y: s.mass * 1.6, z: s.mass * 0.35 },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    this.body = world.createRigidBody(bodyDesc);
    world.createCollider(
      R.ColliderDesc.roundCuboid(s.halfExtents.x - 0.05, s.halfExtents.y - 0.05, s.halfExtents.z - 0.05, 0.05)
        .setDensity(0)
        .setFriction(0.3)
        .setRestitution(0.1)
        .setTranslation(0, 0.1, 0),
      this.body,
    );

    this.vehicle = world.createVehicleController(this.body);
    this.vehicle.indexUpAxis = 1;
    this.vehicle.setIndexForwardAxis = 2;
    const wheels: [number, number][] = [
      [s.wheelX, s.wheelZFront], [-s.wheelX, s.wheelZFront],
      [s.wheelX, s.wheelZRear], [-s.wheelX, s.wheelZRear],
    ];
    wheels.forEach(([x, z], i) => {
      this.vehicle.addWheel({ x, y: s.wheelY, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, s.suspensionRest, s.wheelRadius);
      this.vehicle.setWheelSuspensionStiffness(i, 32);
      this.vehicle.setWheelSuspensionCompression(i, 4.2);
      this.vehicle.setWheelSuspensionRelaxation(i, 5.0);
      this.vehicle.setWheelMaxSuspensionTravel(i, 0.25);
      this.vehicle.setWheelMaxSuspensionForce(i, 60000);
      this.vehicle.setWheelFrictionSlip(i, i < 2 ? 1.9 : 2.0);
      this.vehicle.setWheelSideFrictionStiffness(i, 1.0);
    });
  }

  /** Forward speed in m/s (negative when reversing). */
  get speed(): number {
    return this.vehicle.currentVehicleSpeed();
  }

  /** Applies controls and updates the controller; call once per physics step, before world.step(). */
  update(input: CarInput, dt: number) {
    const s = CAR_SPEC;
    const v = this.speed;
    const speedK = Math.min(1, Math.abs(v) / s.topSpeed);
    const steerMax = s.maxSteer + (s.minSteer - s.maxSteer) * Math.sqrt(speedK);
    // Smooth steering so keyboard input does not snap the wheels.
    const target = input.steer * steerMax;
    this.steerSmooth += (target - this.steerSmooth) * Math.min(1, dt * 8);

    let engine = 0, brake = 0;
    if (input.throttle > 0) {
      if (v < -0.5) brake = s.maxBrakeForce * input.throttle; // moving backwards: brake first
      else engine = s.maxEngineForce * this.power * input.throttle * (1 - Math.pow(Math.max(0, v) / (s.topSpeed * Math.sqrt(this.power)), 2));
    }
    if (input.brake > 0) {
      if (v > 0.8) brake = s.maxBrakeForce * input.brake;
      else if (v > -s.reverseSpeed) engine = -s.maxEngineForce * 0.5 * input.brake;
    }
    // Light rolling resistance when coasting.
    if (!input.throttle && !input.brake) brake = 4;

    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      this.vehicle.setWheelSteering(i, front ? this.steerSmooth : 0);
      this.vehicle.setWheelEngineForce(i, front ? 0 : engine / 2);
      let b = brake;
      if (input.handbrake && !front) b = s.maxBrakeForce * 1.5;
      if (!input.handbrake || front) b *= front ? 1 : 0.6; // front-biased brakes stay stable
      this.vehicle.setWheelBrake(i, b);
      // Handbrake loosens rear grip for slides.
      this.vehicle.setWheelFrictionSlip(i, input.handbrake && !front ? 0.8 : front ? 1.9 : 2.0);
    }

    // Arcade helpers: downforce grows with speed and keeps the car planted.
    // (Rapier forces persist across steps, so reset before adding this step's force.)
    const down = 2.5 * v * v;
    this.body.resetForces(false);
    this.body.addForce({ x: 0, y: -down, z: 0 }, true);
    this.vehicle.updateVehicle(dt);
  }

  /** Puts the car back on its wheels at the current position (or a given one). */
  reset(pos?: { x: number; y: number; z: number }, yaw?: number) {
    const t = this.body.translation();
    const r = this.body.rotation();
    const currentYaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
    const p = pos ?? { x: t.x, y: t.y + 2, z: t.z };
    this.body.setTranslation(p, true);
    this.body.setRotation(yawQuat(yaw ?? currentYaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  dispose() {
    this.world.removeVehicleController(this.vehicle);
    this.world.removeRigidBody(this.body);
    void this.R;
  }
}

/** Quaternion for a rotation about +Y; yaw 0 = facing +Z. */
export function yawQuat(yaw: number) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
