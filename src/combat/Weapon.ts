// Guns for the on-foot player (pistol, sub-machine gun, shotgun): aim along the camera, damage
// pedestrians, traffic and police cars (cars burn out when wrecked). Shots are hitscan rays
// with tracers, a muzzle flash and a spark where they land. No blood.
import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { Pedestrians } from '../traffic/Pedestrians.ts';
import type { Traffic } from '../traffic/Traffic.ts';
import type { Police } from '../police/Police.ts';

import { WEAPONS, type Arsenal, type WeaponId, type WeaponSpec } from './Arsenal.ts';

const RANGE = 120;

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
  /** Other players (multiplayer): a hit is sent to them over the network. */
  players?: { pos: THREE.Vector3; inCar: boolean; hit: (damage: number) => void }[];
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
  readonly group = new THREE.Group();
  /** Called for crimes: amount of wanted level and a reason. */
  onCrime?: (amount: number, reason: string) => void;
  onShot?: (id: WeaponId) => void;
  onEmpty?: () => void;
  private cooldown = 0;
  private fxTime = 0;
  private policeAlertCooldown = 0;
  private tracers: THREE.LineSegments;
  private flash: THREE.Mesh;
  private spark: THREE.Mesh;

  constructor(readonly arsenal: Arsenal) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 2 * 3), 3));
    this.tracers = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.8 }));
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd36a }));
    this.spark = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    for (const o of [this.tracers, this.flash, this.spark]) {
      o.visible = false;
      o.frustumCulled = false;
      this.group.add(o);
    }
  }

  get equipped(): boolean {
    return this.arsenal.current !== null;
  }

  update(dt: number, firing: boolean, ctx: ShotContext) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.policeAlertCooldown = Math.max(0, this.policeAlertCooldown - dt);
    this.fxTime -= dt;
    this.tracers.visible = this.flash.visible = this.fxTime > 0.04;
    this.spark.visible = this.fxTime > 0;
    const id = this.arsenal.current;
    if (!id || !firing || this.cooldown > 0) return;
    const spec = WEAPONS[id];
    this.cooldown = spec.interval;
    if (this.arsenal.ammo[id] <= 0) {
      this.onEmpty?.();
      this.cooldown = 0.4;
      return;
    }
    this.arsenal.ammo[id]--;
    this.shoot(ctx, spec);
    this.onShot?.(id);
  }

  private shoot(ctx: ShotContext, spec: WeaponSpec) {
    const o = ctx.camera.getWorldPosition(new THREE.Vector3());
    const aim = ctx.camera.getWorldDirection(new THREE.Vector3());
    // Ignore everything between the camera and the player (the camera is behind them).
    const minT = Math.max(0, new THREE.Vector3().subVectors(ctx.playerFeet, o).dot(aim)) + 0.6;
    const pos = this.tracers.geometry.attributes.position as THREE.BufferAttribute;
    let lastEnd = o.clone();
    for (let k = 0; k < 8; k++) pos.setXYZ(k * 2, 0, -1e5, 0), pos.setXYZ(k * 2 + 1, 0, -1e5, 0);
    for (let k = 0; k < spec.pellets; k++) {
      const d = aim.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).multiplyScalar(spec.spread)).normalize();
      const start = o.clone().addScaledVector(d, minT);
      let best = ctx.phys.castRay(start, d, RANGE, ctx.exclude) + minT;
      let hit: (() => void) | null = null;
      ctx.pedestrians?.peds.forEach((p) => {
        if (p.down > 0) return;
        const t = rayCapsule(o, d, p.pos, 1.8, 0.35);
        if (t > minT && t < best) {
          best = t;
          hit = () => {
            ctx.pedestrians!.damage(p, spec.damage, d);
            this.onCrime?.(1, 'shooting a pedestrian');
          };
        }
      });
      ctx.traffic?.cars.forEach((c) => {
        const t = raySphere(o, d, c.pos, 1.7);
        if (t > minT && t < best) {
          best = t;
          hit = () => ctx.traffic!.damage(c, spec.damage);
        }
      });
      ctx.police?.units.forEach((u) => {
        const t = raySphere(o, d, u.pos, 1.7);
        if (t > minT && t < best) {
          best = t;
          hit = () => ctx.police!.damage(u, spec.damage);
        }
      });
      ctx.police?.cops.forEach((c) => {
        const t = rayCapsule(o, d, c.pos, 1.8, 0.4);
        if (t > minT && t < best) {
          best = t;
          hit = () => ctx.police!.hurtCop(c, spec.damage);
        }
      });
      ctx.players?.forEach((pl) => {
        const t = pl.inCar ? raySphere(o, d, pl.pos, 1.7) : rayCapsule(o, d, pl.pos, 1.8, 0.4);
        if (t > minT && t < best) {
          best = t;
          hit = () => pl.hit(spec.damage);
        }
      });
      (hit as (() => void) | null)?.();
      lastEnd = o.clone().addScaledVector(d, Math.min(best, RANGE));
      if (k < 8) {
        pos.setXYZ(k * 2, ctx.muzzle.x, ctx.muzzle.y, ctx.muzzle.z);
        pos.setXYZ(k * 2 + 1, lastEnd.x, lastEnd.y, lastEnd.z);
      }
    }
    pos.needsUpdate = true;

    // Gunshots scare people nearby; police that hear them get involved.
    ctx.pedestrians?.panicAround(ctx.muzzle, 25);
    if (ctx.police && this.policeAlertCooldown === 0 && ctx.police.units.some((u) => u.pos.distanceTo(ctx.muzzle) < 60)) {
      this.policeAlertCooldown = 10;
      this.onCrime?.(1, 'shooting near the police');
    }
    this.flash.position.copy(ctx.muzzle);
    this.spark.position.copy(lastEnd);
    this.fxTime = 0.12;
  }
}
