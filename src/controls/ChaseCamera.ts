// Third-person camera that follows a target (car or character) from behind,
// with mouse orbit that recentres after a moment and collision against the world.
import * as THREE from 'three';
import type { MouseLook } from './Input.ts';

export interface ChaseTarget {
  position: THREE.Vector3;
  /** Heading around +Y; 0 = facing +Z. */
  yaw: number;
  /** Signed forward speed in m/s (used to look ahead and swing behind). */
  speed: number;
}

export class ChaseCamera {
  distance = 6.8;
  height = 2.3;
  private orbitYaw = 0;
  private orbitPitch = 0.12;
  private smoothYaw = 0;
  private pos = new THREE.Vector3();
  private initialised = false;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private mouse: MouseLook,
    private ground: (x: number, z: number) => number,
    /** Returns the free distance along a ray (camera collision). */
    private rayFree: (origin: THREE.Vector3, dir: THREE.Vector3, max: number) => number,
  ) {}

  snap() {
    this.initialised = false;
  }

  update(t: ChaseTarget, dt: number) {
    const { dx, dy } = this.mouse.take();
    this.orbitYaw -= dx * 0.004;
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 0.003, -0.25, 1.1);
    // Recentre behind the target once the mouse has been idle for a while.
    if (performance.now() - this.mouse.lastMove > 1500) {
      this.orbitYaw *= Math.exp(-dt * 2.5);
      this.orbitPitch += (0.12 - this.orbitPitch) * (1 - Math.exp(-dt * 2));
    }
    // Follow the heading with some lag; when reversing quickly, still stay behind the car.
    if (!this.initialised) this.smoothYaw = t.yaw;
    let d = t.yaw - this.smoothYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.smoothYaw += d * (1 - Math.exp(-dt * 5));

    const yaw = this.smoothYaw + this.orbitYaw;
    const pitch = this.orbitPitch;
    const speedK = THREE.MathUtils.clamp(Math.abs(t.speed) / 30, 0, 1);
    const dist = this.distance + speedK * 1.5;
    const pivot = t.position.clone().add(new THREE.Vector3(0, 1.3, 0));
    const back = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const want = pivot.clone().addScaledVector(back, dist).add(new THREE.Vector3(0, this.height - 1.3, 0));

    // Pull the camera in front of walls between the pivot and the desired position.
    const toWant = want.clone().sub(pivot);
    const len = toWant.length();
    toWant.divideScalar(len);
    const free = this.rayFree(pivot, toWant, len);
    if (free < len) want.copy(pivot).addScaledVector(toWant, Math.max(0.8, free - 0.35));
    const minY = this.ground(want.x, want.z) + 0.5;
    if (want.y < minY) want.y = minY;

    if (!this.initialised) {
      this.pos.copy(want);
      this.initialised = true;
    } else {
      // Snap in quickly when the view is blocked, otherwise follow smoothly.
      const k = free < len ? 18 : 9;
      this.pos.lerp(want, 1 - Math.exp(-dt * k));
    }
    this.camera.position.copy(this.pos);
    const look = t.position.clone().add(new THREE.Vector3(Math.sin(t.yaw) * speedK * 3, 1.1, Math.cos(t.yaw) * speedK * 3));
    this.camera.lookAt(look);
    // Slight FOV kick with speed.
    const fov = 60 + speedK * 12;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
    }
  }
}
