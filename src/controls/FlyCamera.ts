// Free-flying camera for exploring the city (phase 2).
// WASD = move, Space/E = up, Q/C = down, Shift = fast, mouse = look (click to lock),
// mouse wheel = base speed.
import * as THREE from 'three';

export class FlyCamera {
  yaw = 0;
  pitch = -0.3;
  speed = 30; // m/s
  private keys = new Set<string>();
  private dragging = false;
  private locked = false;
  onLockChange?: (locked: boolean) => void;

  constructor(readonly camera: THREE.PerspectiveCamera, dom: HTMLElement, private ground: (x: number, z: number) => number) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    dom.addEventListener('click', () => {
      if (this.locked) return;
      try {
        const r = dom.requestPointerLock() as unknown as Promise<void> | undefined;
        r?.catch?.(() => {});
      } catch {
        /* pointer lock is optional; drag-to-look still works */
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      this.onLockChange?.(this.locked);
    });
    dom.addEventListener('pointerdown', () => (this.dragging = true));
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.locked && !this.dragging) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.55, 1.55);
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.speed = THREE.MathUtils.clamp(this.speed * Math.exp(-e.deltaY * 0.001), 3, 400);
    }, { passive: false });
  }

  lookAt(target: THREE.Vector3) {
    const d = target.clone().sub(this.camera.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }

  update(dt: number) {
    const k = this.keys;
    const fast = k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1;
    const v = this.speed * fast * dt;
    const forward = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const p = this.camera.position;
    if (k.has('KeyW') || k.has('ArrowUp')) p.addScaledVector(forward, v);
    if (k.has('KeyS') || k.has('ArrowDown')) p.addScaledVector(forward, -v);
    if (k.has('KeyD') || k.has('ArrowRight')) p.addScaledVector(right, v);
    if (k.has('KeyA') || k.has('ArrowLeft')) p.addScaledVector(right, -v);
    if (k.has('Space') || k.has('KeyE')) p.y += v;
    if (k.has('KeyQ') || k.has('KeyC')) p.y -= v;
    const minY = this.ground(p.x, p.z) + 1.7;
    if (p.y < minY) p.y = minY;
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
