// Free-flying camera for exploring the city.
// WASD = move, Space/E = up, Q/C = down, Shift = fast, mouse = look, wheel = base speed.
import * as THREE from 'three';
import type { Input, MouseLook } from './Input.ts';

export class FlyCamera {
  yaw = 0;
  pitch = -0.3;
  speed = 30; // m/s
  enabled = true;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private input: Input,
    private mouse: MouseLook,
    dom: HTMLElement,
    private ground: (x: number, z: number) => number,
  ) {
    dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.speed = THREE.MathUtils.clamp(this.speed * Math.exp(-e.deltaY * 0.001), 3, 400);
    }, { passive: false });
  }

  lookAt(target: THREE.Vector3) {
    const d = target.clone().sub(this.camera.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  /** Takes over from wherever the camera currently is. */
  syncFromCamera() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.lookAt(this.camera.position.clone().add(dir));
  }

  update(dt: number) {
    const { dx, dy } = this.mouse.take();
    this.yaw -= dx * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.55, 1.55);
    const k = this.input;
    const fast = k.down('ShiftLeft', 'ShiftRight') ? 4 : 1;
    const v = this.speed * fast * dt;
    const forward = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const p = this.camera.position;
    if (k.down('KeyW', 'ArrowUp')) p.addScaledVector(forward, v);
    if (k.down('KeyS', 'ArrowDown')) p.addScaledVector(forward, -v);
    if (k.down('KeyD', 'ArrowRight')) p.addScaledVector(right, v);
    if (k.down('KeyA', 'ArrowLeft')) p.addScaledVector(right, -v);
    if (k.down('Space', 'KeyE')) p.y += v;
    if (k.down('KeyQ', 'KeyC')) p.y -= v;
    const minY = this.ground(p.x, p.z) + 1.7;
    if (p.y < minY) p.y = minY;
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (Math.abs(this.camera.fov - 60) > 0.01) {
      this.camera.fov = 60;
      this.camera.updateProjectionMatrix();
    }
  }
}
