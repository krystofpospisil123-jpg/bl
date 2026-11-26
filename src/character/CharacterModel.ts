// One animated person (the player, police officers, other players): the procedural human rig
// (see HumanRig) with walk/run/idle/jump/aim animations. Origin at the feet, facing +Z.
import * as THREE from 'three';
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
    this.crowd.setPose(0, this.identity, this.pose);
    this.crowd.commit();
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
    this.crowd.setPose(0, this.identity, p);
    this.crowd.commit();
    if (this.aiming) this.gun.matrix.copy(this.crowd.foreR[0]);
  }
}
