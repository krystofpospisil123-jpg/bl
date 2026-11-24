// Pistol for the on-foot player: aims along the camera, hits pedestrians (they fall over and
// get up later, no blood), stops traffic cars, and police cars count as an attack. Shots are
// hitscan rays with a short tracer, a muzzle flash and a spark where they land.
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { Pedestrians } from '../traffic/Pedestrians.ts';
import type { Traffic } from '../traffic/Traffic.ts';
import type { Police } from '../police/Police.ts';

const RANGE = 120;
const FIRE_INTERVAL = 0.28;

export interface ShotContext {
  camera: THREE.Camera;
  /** Muzzle position (player's hand) and the player's own body to ignore. */
  muzzle: THREE.Vector3;
  playerFeet: THREE.Vector3;
  phys: PhysicsWorld;
  exclude?: Parameters<PhysicsWorld['castRay']>[3];
  pedestrians?: Pedestrians;
  traffic?: Traffic;
  police?: Police;
}

/** Distance along the ray (origin o, unit dir d) to a vertical capsule, or Infinity. */
function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, feet: THREE.Vector3, height: number, radius: number): number {
  // Closest approach in the horizontal plane, then check the height there.
  const fx = feet.x - o.x, fz = feet.z - o.z;
  const hd = Math.hypot(d.x, d.z) || 1e-6;
  const t = (fx * d.x + fz * d.z) / (hd * hd);
  if (t < 0) return Infinity;
  const px = o.x + d.x * t, pz = o.z + d.z * t, py = o.y + d.y * t;
  if (Math.hypot(px - feet.x, pz - feet.z) > radius) return Infinity;
  if (py < feet.y || py > feet.y + height) return Infinity;
  return t;
}

function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number {
  const oc = new THREE.Vector3().subVectors(o, c);
  const b = oc.dot(d), cc = oc.lengthSq() - r * r;
  const h = b * b - cc;
  if (h < 0) return Infinity;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : Infinity;
}

export class Weapon {
  equipped = false;
  readonly group = new THREE.Group();
  /** Called for crimes: amount of wanted level and a reason. */
  onCrime?: (amount: number, reason: string) => void;
  onShot?: () => void;
  private cooldown = 0;
  private fxTime = 0;
  private policeAlertCooldown = 0;
  private tracer: THREE.Line;
  private flash: THREE.Mesh;
  private spark: THREE.Mesh;

  constructor() {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
    this.tracer = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.8 }));
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd36a }));
    this.spark = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    for (const o of [this.tracer, this.flash, this.spark]) {
      o.visible = false;
      o.frustumCulled = false;
      this.group.add(o);
    }
  }

  update(dt: number, firing: boolean, ctx: ShotContext) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.policeAlertCooldown = Math.max(0, this.policeAlertCooldown - dt);
    this.fxTime -= dt;
    this.tracer.visible = this.flash.visible = this.fxTime > 0.04;
    this.spark.visible = this.fxTime > 0;
    if (!this.equipped || !firing || this.cooldown > 0) return;
    this.cooldown = FIRE_INTERVAL;
    this.shoot(ctx);
  }

  private shoot(ctx: ShotContext) {
    const o = ctx.camera.getWorldPosition(new THREE.Vector3());
    const d = ctx.camera.getWorldDirection(new THREE.Vector3());
    // Ignore everything between the camera and the player (the camera is behind them).
    const minT = Math.max(0, new THREE.Vector3().subVectors(ctx.playerFeet, o).dot(d)) + 0.6;
    const start = o.clone().addScaledVector(d, minT);
    let best = ctx.phys.castRay(start, d, RANGE, ctx.exclude) + minT;
    let hit: (() => void) | null = null;

    ctx.pedestrians?.peds.forEach((p) => {
      if (p.down > 0) return;
      const t = rayCapsule(o, d, p.pos, 1.8, 0.35);
      if (t > minT && t < best) {
        best = t;
        hit = () => {
          ctx.pedestrians!.knockDown(p, d);
          this.onCrime?.(1, 'shooting a pedestrian');
        };
      }
    });
    ctx.traffic?.cars.forEach((c) => {
      const t = raySphere(o, d, c.pos, 1.7);
      if (t > minT && t < best) {
        best = t;
        hit = () => ctx.traffic!.shoot(c);
      }
    });
    ctx.police?.units.forEach((u) => {
      const t = raySphere(o, d, u.pos, 1.7);
      if (t > minT && t < best) {
        best = t;
        hit = () => this.onCrime?.(1, 'shooting at the police');
      }
    });
    (hit as (() => void) | null)?.();

    // Gunshots scare people nearby; police that hear them get involved.
    ctx.pedestrians?.panicAround(ctx.muzzle, 25);
    if (ctx.police && this.policeAlertCooldown === 0 && ctx.police.units.some((u) => u.pos.distanceTo(ctx.muzzle) < 60)) {
      this.policeAlertCooldown = 10;
      this.onCrime?.(1, 'shooting near the police');
    }

    // Effects
    const end = o.clone().addScaledVector(d, Math.min(best, RANGE));
    const pos = this.tracer.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, ctx.muzzle.x, ctx.muzzle.y, ctx.muzzle.z);
    pos.setXYZ(1, end.x, end.y, end.z);
    pos.needsUpdate = true;
    this.tracer.geometry.computeBoundingSphere();
    this.flash.position.copy(ctx.muzzle);
    this.spark.position.copy(end);
    this.fxTime = 0.12;
    this.onShot?.();
  }
}
