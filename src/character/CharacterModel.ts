// One animated person (the player, police officers, other players): the procedural human rig
// (see HumanRig) with walk/run/idle/jump/aim animations. Origin at the feet, facing +Z.
import * as THREE from 'three';
import type { GlassKind } from '../game/BarMenu.ts';
import { HumanCrowd, DEFAULT_OUTFIT, restPose, walkPose, airPose, aimArms, dancePose, type Outfit, type Pose } from './HumanRig.ts';

export type { Outfit } from './HumanRig.ts';
export { DEFAULT_OUTFIT } from './HumanRig.ts';

export class CharacterModel {
  readonly root = new THREE.Group();
  private crowd: HumanCrowd;
  private phase = 0;
  private time = Math.random() * 100;
  private pose: Pose = restPose();
  /** Holding the pistol out in front (both arms raised). */
  aiming = false;
  /** Dancing (club): routine number, or null. */
  dance: number | null = null;
  private gun: THREE.Mesh;
  private airTime = 0;
  /** 0 sober .. 1+ very drunk: staggering walk, swaying when standing. */
  drunk = 0;
  /** Drinking animation: seconds since it started (-1 = not drinking). */
  private drinkT = -1;
  private glass = new THREE.Group();
  private liquid: THREE.Mesh;
  static readonly DRINK_TIME = 3.4;
  private identity = new THREE.Matrix4();

  constructor(o: Outfit = DEFAULT_OUTFIT) {
    this.crowd = new HumanCrowd(1);
    this.crowd.setOutfit(0, o);
    this.crowd.count = 1;
    this.root.add(this.crowd.group);
    // Pistol in the right hand, shown only while aiming.
    this.gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.2, 0.11).translate(0, -0.33, 0.035),
      new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.4, metalness: 0.6 }),
    );
    this.gun.matrixAutoUpdate = false;
    this.gun.visible = false;
    this.root.add(this.gun);
    // A glass for the drinking animation (shape and colour set per drink).
    this.liquid = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), new THREE.MeshStandardMaterial({ roughness: 0.2, transparent: true, opacity: 0.92 }));
    this.glass.add(this.liquid);
    this.glass.add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xdfeef5, roughness: 0.05, transparent: true, opacity: 0.35, side: THREE.DoubleSide })));
    this.glass.matrixAutoUpdate = false;
    this.glass.visible = false;
    this.root.add(this.glass);
    this.crowd.setPose(0, this.identity, this.pose);
    this.crowd.commit();
  }

  get drinking() {
    return this.drinkT >= 0;
  }

  /** Starts the drinking animation with a glass of the given kind and colour. */
  drink(color: number, kind: GlassKind) {
    const size: Record<GlassKind, [number, number, number]> = {
      beer: [0.042, 0.17, 0.9], wine: [0.035, 0.09, 0.6], cocktail: [0.04, 0.13, 0.85], tumbler: [0.042, 0.1, 0.8], shot: [0.022, 0.06, 0.85],
    };
    const [r, h, fill] = size[kind];
    const [liq, outer] = this.glass.children as THREE.Mesh[];
    outer.scale.set(r, h, r);
    outer.position.y = h / 2;
    liq.scale.set(r * 0.9, h * fill, r * 0.9);
    liq.position.y = (h * fill) / 2 + 0.004;
    (liq.material as THREE.MeshStandardMaterial).color.setHex(color);
    this.drinkT = 0;
  }

  /** Changes the clothes. */
  setOutfit(o: Outfit) {
    this.crowd.setOutfit(0, o);
  }

  /** Colour of the hand-held gun (police tasers are yellow). */
  setGunColor(hex: number) {
    (this.gun.material as THREE.MeshStandardMaterial).color.setHex(hex);
  }

  /** World position of the pistol's muzzle. */
  muzzle(): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return new THREE.Vector3(0, -0.43, 0.06).applyMatrix4(this.crowd.foreR[0]).applyMatrix4(this.root.matrixWorld);
  }

  /**
   * @param speed horizontal speed (m/s)
   * @param grounded whether the feet touch the ground
   */
  animate(speed: number, grounded: boolean, dt: number) {
    this.time += dt;
    const p = this.pose;
    this.airTime = grounded ? 0 : this.airTime + dt;
    if (this.dance !== null) dancePose(p, this.time, this.dance);
    else if (this.airTime > 0.12) airPose(p);
    else {
      // Stride length grows with speed, so the feet do not slide.
      const stride = speed > 4 ? 1.55 : 1.1;
      this.phase += (speed / stride) * dt * Math.PI;
      walkPose(p, this.phase, speed, this.time);
    }
    this.gun.visible = this.aiming;
    if (this.aiming) aimArms(p);
    if (this.drunk > 0.02) this.stagger(p);
    if (this.drinkT >= 0) this.drinkArms(p, dt);
    this.crowd.setPose(0, this.identity, p);
    this.crowd.commit();
    if (this.aiming) this.gun.matrix.copy(this.crowd.foreR[0]);
    if (this.glass.visible) this.placeGlass();
  }

  /** Drunk: the body sways, the head lolls, arms out for balance. */
  private stagger(p: Pose) {
    const d = Math.min(1.3, this.drunk), t = this.time;
    const w = Math.sin(t * 1.15 + Math.sin(t * 0.37) * 2);
    p.sway += w * 0.09 * d;
    p.lean += Math.sin(t * 0.83) * 0.06 * d;
    p.chestZ += -w * 0.07 * d;
    p.headZ += Math.sin(t * 1.7) * 0.16 * d;
    p.headX += 0.1 * d + Math.sin(t * 1.1) * 0.08 * d;
    p.lSh[2] += 0.22 * d * (0.6 + Math.max(0, w));
    p.rSh[2] -= 0.22 * d * (0.6 + Math.max(0, -w));
    p.lKnee += 0.08 * d;
    p.rKnee += 0.08 * d;
  }

  /** Raise the glass, drink with the head back, lower it. */
  private drinkArms(p: Pose, dt: number) {
    this.drinkT += dt;
    const T = CharacterModel.DRINK_TIME, t = this.drinkT;
    if (t > T) {
      this.drinkT = -1;
      this.glass.visible = false;
      return;
    }
    this.glass.visible = true;
    // 0..1 raise during the first 0.7 s, lower during the last 0.6 s.
    const up = Math.min(1, t / 0.7, (T - t) / 0.6);
    const e = up * up * (3 - 2 * up);
    const sip = THREE.MathUtils.clamp((t - 0.7) / (T - 1.3), 0, 1);
    p.rSh = [THREE.MathUtils.lerp(p.rSh[0], -1.25, e), 0, THREE.MathUtils.lerp(p.rSh[2], 0.32, e)];
    p.rEl = THREE.MathUtils.lerp(p.rEl, -2.25, e);
    p.headX = THREE.MathUtils.lerp(p.headX, -0.32 - sip * 0.18, e);
    p.chestX = THREE.MathUtils.lerp(p.chestX, -0.08, e);
    this.glassTilt = e * (0.35 + sip * 1.15);
  }

  private glassTilt = 0;

  /** The glass in the right hand, tilting towards the mouth while drinking. */
  private placeGlass() {
    const hand = new THREE.Vector3(0, -0.33, 0.045).applyMatrix4(this.crowd.foreR[0]);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.glassTilt);
    this.glass.matrix.compose(hand.add(new THREE.Vector3(0, -0.05, 0)), q, new THREE.Vector3(1, 1, 1));
  }
}
