// Particle effects: smoke from damaged and burning cars, flames, explosions. One point cloud
// per kind with a soft round sprite; particles live in a fixed pool (CPU updated).
import * as THREE from 'three';

const MAX = 600;

function softDot(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

class Cloud {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private next = 0;

  constructor(private colorAt: (t: number, out: THREE.Color) => void, size: number, additive: boolean, private rise: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({
      size, map: softDot(), vertexColors: true, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: additive ? 0.9 : 0.55,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.pos.fill(-1e5);
  }

  emit(p: THREE.Vector3, spread: number, speed: number, life: number) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos[i * 3] = p.x + (Math.random() - 0.5) * spread;
    this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * spread * 0.5;
    this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
    const a = Math.random() * Math.PI * 2, s = Math.random() * speed;
    this.vel[i * 3] = Math.cos(a) * s;
    this.vel[i * 3 + 1] = this.rise * (0.6 + Math.random() * 0.8) + Math.random() * speed * 0.6;
    this.vel[i * 3 + 2] = Math.sin(a) * s;
    this.life[i] = this.maxLife[i] = life * (0.7 + Math.random() * 0.6);
  }

  update(dt: number) {
    const c = new THREE.Color();
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -1e5;
        continue;
      }
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      this.vel[i * 3] *= 1 - dt * 0.8;
      this.vel[i * 3 + 2] *= 1 - dt * 0.8;
      this.colorAt(1 - this.life[i] / this.maxLife[i], c);
      this.col.set([c.r, c.g, c.b], i * 3);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

export class Effects {
  readonly group = new THREE.Group();
  private smoke = new Cloud((t, o) => o.setScalar(0.32 - t * 0.18), 2.6, false, 1.6);
  private fire = new Cloud((t, o) => o.setRGB(1, 0.75 - t * 0.6, 0.25 - t * 0.25).multiplyScalar(1 - t), 1.4, true, 2.2);
  /** Continuous emitters: smoke (amount 0..1) and fire, e.g. on wrecks and damaged cars. */
  private sources = new Set<{ pos: THREE.Vector3; smoke: number; fire: boolean; ttl: number }>();
  private acc = 0;
  private flash: THREE.PointLight;
  private flashTime = 0;

  constructor() {
    this.group.add(this.smoke.points, this.fire.points);
    // One shared light for explosion flashes (always present, so no shader recompiles).
    this.flash = new THREE.PointLight(0xffa040, 0, 40, 1.5);
    this.group.add(this.flash);
  }

  /** Adds a continuous smoke/fire source; returns it so the caller can move or remove it. */
  addSource(pos: THREE.Vector3, smoke: number, fire: boolean, ttl = Infinity) {
    const s = { pos, smoke, fire, ttl };
    this.sources.add(s);
    return s;
  }

  removeSource(s: { pos: THREE.Vector3 }) {
    for (const x of this.sources) if (x === s) this.sources.delete(x);
  }

  explosion(p: THREE.Vector3) {
    for (let i = 0; i < 60; i++) this.fire.emit(p, 1.5, 7, 0.9);
    for (let i = 0; i < 40; i++) this.smoke.emit(p, 2, 3, 3.5);
    this.flash.position.copy(p).add(new THREE.Vector3(0, 1.5, 0));
    this.flashTime = 0.35;
  }

  update(dt: number) {
    this.acc += dt;
    while (this.acc > 0.05) {
      this.acc -= 0.05;
      for (const s of this.sources) {
        s.ttl -= 0.05;
        if (s.ttl <= 0) {
          this.sources.delete(s);
          continue;
        }
        if (s.ttl < 15) s.fire = false; // flames die down, smoke goes on
        if (Math.random() < s.smoke) this.smoke.emit(s.pos, 0.6, 0.4, 3);
        if (s.fire) {
          this.fire.emit(s.pos, 1.0, 0.6, 0.6);
          this.fire.emit(s.pos, 1.0, 0.6, 0.6);
        }
      }
    }
    this.smoke.update(dt);
    this.fire.update(dt);
    this.flashTime = Math.max(0, this.flashTime - dt);
    this.flash.intensity = this.flashTime > 0 ? 60 * (this.flashTime / 0.35) : 0;
  }
}
