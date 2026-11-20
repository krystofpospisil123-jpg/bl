// Procedural low-poly person with a simple walk/run cycle. Origin at the feet, facing +Z.
import * as THREE from 'three';

export interface Outfit {
  skin: number;
  hair: number;
  top: number;
  legs: number;
  shoes: number;
}

export const DEFAULT_OUTFIT: Outfit = { skin: 0xe0b394, hair: 0x3a2a1e, top: 0x2f6d8f, legs: 0x2e3442, shoes: 0x1f1f1f };

function part(w: number, h: number, d: number, color: number, y: number): THREE.Mesh {
  // Box hanging down from its pivot (top), so rotations swing from the joint.
  const g = new THREE.BoxGeometry(w, h, d).translate(0, -h / 2 + y, 0);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color }));
  m.castShadow = true;
  return m;
}

export class CharacterModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private shinL: THREE.Group;
  private shinR: THREE.Group;
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private head = new THREE.Group();
  private phase = 0;

  constructor(o: Outfit = DEFAULT_OUTFIT) {
    this.root.add(this.body);
    // Legs: thigh + shin with knee joint.
    const makeLeg = (g: THREE.Group, x: number) => {
      g.position.set(x, 0.92, 0);
      g.add(part(0.16, 0.46, 0.18, o.legs, 0));
      const shin = new THREE.Group();
      shin.position.y = -0.46;
      shin.add(part(0.14, 0.42, 0.16, o.legs, 0));
      const shoe = part(0.15, 0.06, 0.26, o.shoes, -0.4);
      shoe.position.z = 0.04;
      shin.add(shoe);
      g.add(shin);
      this.body.add(g);
      return shin;
    };
    this.shinL = makeLeg(this.legL, 0.1);
    this.shinR = makeLeg(this.legR, -0.1);
    // Torso and hips
    const torso = part(0.42, 0.56, 0.24, o.top, 1.48);
    this.body.add(torso, part(0.38, 0.12, 0.22, o.legs, 0.98));
    // Arms
    const makeArm = (g: THREE.Group, x: number) => {
      g.position.set(x, 1.44, 0);
      g.add(part(0.12, 0.34, 0.13, o.top, 0));
      g.add(part(0.1, 0.3, 0.11, o.top, -0.33));
      g.add(part(0.09, 0.09, 0.1, o.skin, -0.63));
      this.body.add(g);
    };
    makeArm(this.armL, 0.28);
    makeArm(this.armR, -0.28);
    // Head with hair cap and neck
    this.head.position.y = 1.5;
    const neck = part(0.1, 0.08, 0.1, o.skin, 0.08);
    const face = part(0.22, 0.25, 0.23, o.skin, 0.33);
    const hair = part(0.24, 0.08, 0.25, o.hair, 0.36);
    const back = part(0.24, 0.16, 0.06, o.hair, 0.32);
    back.position.z = -0.1;
    this.head.add(neck, face, hair, back);
    this.body.add(this.head);
  }

  /**
   * @param speed horizontal speed (m/s)
   * @param grounded whether the feet touch the ground
   */
  animate(speed: number, grounded: boolean, dt: number) {
    const stride = speed > 5.5 ? 1.25 : 1.0;
    this.phase += (speed / stride) * dt * Math.PI;
    const amp = Math.min(1, speed / 4.5) * (speed > 5.5 ? 0.85 : 0.6);
    const s = Math.sin(this.phase);
    if (!grounded) {
      // Airborne pose: knees up, arms out.
      this.legL.rotation.x = -0.5;
      this.legR.rotation.x = 0.2;
      this.shinL.rotation.x = 0.9;
      this.shinR.rotation.x = 0.4;
      this.armL.rotation.set(-0.6, 0, 0.3);
      this.armR.rotation.set(-0.6, 0, -0.3);
      this.body.position.y = 0;
      return;
    }
    this.legL.rotation.x = s * amp;
    this.legR.rotation.x = -s * amp;
    // Knee bends on the back swing.
    this.shinL.rotation.x = Math.max(0, -Math.cos(this.phase)) * amp * 1.4;
    this.shinR.rotation.x = Math.max(0, Math.cos(this.phase)) * amp * 1.4;
    this.armL.rotation.set(-s * amp * 0.9, 0, 0.06);
    this.armR.rotation.set(s * amp * 0.9, 0, -0.06);
    // Bob and slight forward lean when running.
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.05 * amp;
    this.body.rotation.x = Math.min(0.18, speed * 0.025);
    // Idle breathing
    if (speed < 0.2) this.armL.rotation.z = 0.06 + Math.sin(performance.now() / 700) * 0.02;
  }
}
