// Velvet Club: a night club interior (built once, high above the town, like the store hall).
// Round main stage with a pole and a runway, a second podium with a pole, LED edges, a spinning
// mirror ball and sweeping coloured light beams; a bar with a bartender, bottles and stools;
// velvet sofas, tables with candles and seated guests; a DJ booth and a bouncer at the door.
// Dancers (dressed in club outfits) dance different routines around the poles.
// Inside you can order a drink at the bar or tip a dancer at the runway.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { HumanCrowd, dancePose, idlePose, sitPose, restPose, type Outfit } from '../character/HumanRig.ts';

const ORIGIN = new THREE.Vector3(300, 1500, 0);
const W = 20, D = 24, H = 5;
const STAGE_H = 0.8;
export const DRINK_PRICE = 80;
export const TIP_PRICE = 100;

function colored(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  const n = ng.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

function neonText(lines: { text: string; color: string; size: number }[], w = 1024, h = 300): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const step = h / (lines.length + 1);
  lines.forEach((l, i) => {
    g.font = `italic 800 ${l.size}px "Brush Script MT", "Segoe Script", cursive, system-ui`;
    g.shadowColor = l.color;
    for (const blur of [40, 22, 10]) {
      g.shadowBlur = blur;
      g.fillStyle = l.color;
      g.fillText(l.text, w / 2, step * (i + 1));
    }
    g.shadowBlur = 4;
    g.fillStyle = '#fff6fb';
    g.fillText(l.text, w / 2, step * (i + 1));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Npc { i: number; kind: 'dance' | 'idle' | 'sit'; x: number; y: number; z: number; yaw: number; style: number; orbit?: { cx: number; cz: number; r: number; speed: number } ; t0: number }

export class Club {
  readonly group = new THREE.Group();
  readonly spawn = ORIGIN.clone().add(new THREE.Vector3(0, 0.1, D / 2 - 2.6));
  readonly spawnYaw = Math.PI;
  readonly exit = ORIGIN.clone().add(new THREE.Vector3(0, 0, D / 2 - 0.9));
  readonly bar = ORIGIN.clone().add(new THREE.Vector3(6.4, 0, 2.5));
  /** Runway centre line (for tips): x = 0, z from -4 to 1.5. */
  private beams: THREE.Mesh[] = [];
  private ball: THREE.Mesh;
  private leds: THREE.MeshBasicMaterial[] = [];
  private crowd = new HumanCrowd(14);
  private npcs: Npc[] = [];
  private pose = restPose();
  private time = 0;
  private bills: { mesh: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  private billGeo = new THREE.PlaneGeometry(0.16, 0.08);
  private billMat = new THREE.MeshBasicMaterial({ color: 0x8fd18b, side: THREE.DoubleSide });
  /** A tipped dancer waves for a while. */
  private cheer = new Map<number, number>();

  constructor(phys: PhysicsWorld) {
    const parts: THREE.BufferGeometry[] = [];
    const colliders: [number, number, number, number, number, number][] = [];
    const add = (g: THREE.BufferGeometry, color: number) => parts.push(colored(g, color));
    const solid = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, collide = true) => {
      add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
      if (collide) colliders.push([x, y, z, w / 2, h / 2, d / 2]);
    };
    const cyl = (r: number, h: number, x: number, y: number, z: number, color: number, seg = 32, collide = true) => {
      add(new THREE.CylinderGeometry(r, r, h, seg).translate(x, y, z), color);
      if (collide) colliders.push([x, y, z, r * 0.8, h / 2, r * 0.8]);
    };
    // Room: dark floor with a checker dance area, walls with purple panels, black ceiling.
    solid(W, 0.2, D, 0, -0.1, 0, 0x141018);
    for (let i = -4; i < 4; i++) for (let j = 0; j < 4; j++) {
      const c = (i + j) % 2 ? 0x2a1630 : 0x161019;
      add(new THREE.BoxGeometry(1.2, 0.02, 1.2).translate(i * 1.2 + 0.6, 0.011, 4 + j * 1.2), c);
    }
    solid(W, H, 0.3, 0, H / 2, -D / 2, 0x1d1420);
    solid(W, H, 0.3, 0, H / 2, D / 2, 0x1d1420);
    solid(0.3, H, D, -W / 2, H / 2, 0, 0x1d1420);
    solid(0.3, H, D, W / 2, H / 2, 0, 0x1d1420);
    solid(W, 0.3, D, 0, H + 0.15, 0, 0x08070a, false);
    for (let k = 0; k < 6; k++) {
      // Quilted velvet panels on the side walls.
      add(new THREE.BoxGeometry(0.06, 2.2, 3.2).translate(-W / 2 + 0.18, 2.1, -9 + k * 3.6), 0x3a1440);
      add(new THREE.BoxGeometry(0.06, 2.2, 3.2).translate(W / 2 - 0.18, 2.6, -9 + k * 3.6), 0x2c1034);
    }
    // Main stage, runway and the end podium; a second podium at the back left.
    cyl(3.2, STAGE_H, 0, STAGE_H / 2, -6.5, 0x0e0c10);
    solid(2.4, STAGE_H, 5.6, 0, STAGE_H / 2, -1.6, 0x0e0c10);
    cyl(1.4, STAGE_H, 0, STAGE_H / 2, 1.2, 0x0e0c10);
    cyl(1.25, 0.6, -6.8, 0.3, -8, 0x0e0c10);
    // Chrome poles.
    for (const [x, z, y0] of [[0, -6.5, STAGE_H], [0, 1.2, STAGE_H], [-6.8, -8, 0.6]] as const) {
      add(new THREE.CylinderGeometry(0.045, 0.045, H - y0, 12).translate(x, y0 + (H - y0) / 2, z), 0xe8e8ee);
    }
    // Bar on the right: counter with a lighter top, back shelves, stools.
    solid(1.0, 1.1, 10, 7.6, 0.55, 3, 0x2a1a14);
    add(new THREE.BoxGeometry(1.2, 0.06, 10.2).translate(7.6, 1.13, 3), 0x6a4a34);
    solid(0.5, 2.6, 10, 9.6, 1.3, 3, 0x1a1012);
    for (let k = 0; k < 3; k++) add(new THREE.BoxGeometry(0.5, 0.04, 9.6).translate(9.45, 1.4 + k * 0.5, 3), 0x8a6a4a);
    for (let k = 0; k < 6; k++) {
      const z = -1 + k * 1.6;
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16).translate(6.7, 0.75, z), 0x8a1830);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 8).translate(6.7, 0.375, z), 0xcccccc);
    }
    // Velvet sofas on the left with low tables.
    for (let k = 0; k < 3; k++) {
      const z = -1 + k * 3.4;
      solid(0.9, 0.45, 2.4, -8.9, 0.225, z, 0x6a0f2a);
      solid(0.3, 0.9, 2.4, -9.5, 0.45, z, 0x5a0c22);
      solid(0.9, 0.38, 0.8, -7.4, 0.19, z, 0x1a1418);
    }
    // Round tables with stools by the runway.
    for (const [x, z] of [[-3.4, 3], [3.4, 3], [-3.6, 6.6], [3.6, 6.6]]) {
      cyl(0.45, 0.05, x, 0.74, z, 0x1a1418, 24, false);
      cyl(0.06, 0.74, x, 0.37, z, 0x888888, 8);
      for (const a of [0.6, 2.6]) add(new THREE.CylinderGeometry(0.2, 0.2, 0.45, 12).translate(x + Math.cos(a) * 0.8, 0.225, z + Math.sin(a) * 0.8), 0x4a0c20);
    }
    // DJ booth at the back right.
    solid(2.6, 1.15, 1.0, 6.5, 0.575, -10.4, 0x121014);
    add(new THREE.BoxGeometry(0.5, 0.05, 0.5).translate(6.0, 1.17, -10.4), 0x333333);
    add(new THREE.BoxGeometry(0.5, 0.05, 0.5).translate(7.0, 1.17, -10.4), 0x333333);
    // Entrance: door frame.
    solid(3.4, 0.4, 0.4, 0, 3.0, D / 2 - 0.25, 0x0a0a0a, false);
    colliders.push([0, 1.4, D / 2 - 0.1, 1.6, 1.4, 0.15]);

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
    const room = new THREE.Mesh(mergeGeometries(parts, false)!, mat);
    room.receiveShadow = true;
    this.group.add(room);

    // Glowing parts (unaffected by light): LED edges, bottles, candles, signs.
    const glow = (color: number) => {
      const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      this.leds.push(m);
      return m;
    };
    const ledPink = glow(0xff2fa8), ledBlue = glow(0x3a6bff);
    const ring = (r: number, x: number, y: number, z: number, m: THREE.Material) => {
      const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 6, 64).rotateX(Math.PI / 2), m);
      t.position.set(x, y, z);
      this.group.add(t);
    };
    ring(3.2, 0, STAGE_H, -6.5, ledPink);
    ring(1.4, 0, STAGE_H, 1.2, ledPink);
    ring(1.25, -6.8, 0.6, -8, ledBlue);
    for (const x of [-1.2, 1.2]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 4.6), ledPink);
      strip.position.set(x, STAGE_H, -1.5);
      this.group.add(strip);
    }
    // Bar underglow and bottles.
    const under = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 10), ledBlue);
    under.position.set(7.08, 0.1, 3);
    this.group.add(under);
    const bottleGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.3, 8);
    const bottleCols = [0x2fa84f, 0xb8862f, 0xd8e4f0, 0x8a2f6a, 0x2f6aa8, 0xc4542a];
    const bottles = new THREE.InstancedMesh(bottleGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), 54);
    let bi = 0;
    for (let k = 0; k < 3; k++) for (let j = 0; j < 18; j++) {
      bottles.setMatrixAt(bi, new THREE.Matrix4().makeTranslation(9.4, 1.57 + k * 0.5, -1.2 + j * 0.5));
      bottles.setColorAt(bi++, new THREE.Color(bottleCols[(j * 7 + k * 3) % bottleCols.length]).multiplyScalar(0.8));
    }
    this.group.add(bottles);
    // Candles on the tables.
    const candleMat = glow(0xffb347);
    for (const [x, z] of [[-3.4, 3], [3.4, 3], [-3.6, 6.6], [3.6, 6.6], [-7.4, -1], [-7.4, 2.4], [-7.4, 5.8]]) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), candleMat);
      c.position.set(x, x < -7 ? 0.45 : 0.82, z);
      this.group.add(c);
    }
    // Neon signs: club name above the stage, "BAR" above the bar, "EXIT" over the door.
    const sign = (tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
      m.position.set(x, y, z);
      m.rotation.y = ry;
      this.group.add(m);
    };
    sign(neonText([{ text: 'Velvet', color: '#ff2fa8', size: 170 }, { text: 'CLUB', color: '#7a5cff', size: 90 }]), 6, 1.75, 0, 3.4, -D / 2 + 0.2, 0);
    sign(neonText([{ text: 'Bar', color: '#3ad6ff', size: 200 }], 512, 256), 2.4, 1.2, W / 2 - 0.2, 3.5, 3, -Math.PI / 2);
    sign(neonText([{ text: 'EXIT', color: '#3aff6a', size: 120 }], 512, 160), 1.2, 0.38, 0, 3.4, D / 2 - 0.5, Math.PI);
    // DJ screen.
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), glow(0x4a2a8a));
    screen.position.set(6.5, 2.4, -D / 2 + 0.2);
    this.group.add(screen);
    // Mirror ball and light beams (additive cones) sweeping over the stage.
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 2), new THREE.MeshStandardMaterial({ color: 0xdadde6, metalness: 1, roughness: 0.12, flatShading: true, emissive: 0x332a44 }));
    this.ball.position.set(0, H - 0.8, -2.5);
    this.group.add(this.ball);
    const beamGeo = new THREE.ConeGeometry(1.1, H - 0.4, 24, 1, true).translate(0, -(H - 0.4) / 2, 0);
    [0xff2fa8, 0x3a6bff, 0x9b4bff, 0xff2fa8, 0x3ad6ff].forEach((color, k) => {
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      beam.position.set(-6 + k * 3, H - 0.1, -9);
      this.beams.push(beam);
      this.group.add(beam);
    });
    // Exit ring by the door.
    const exitRing = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3aff6a, transparent: true, opacity: 0.6, toneMapped: false }));
    exitRing.position.set(0, 0.03, D / 2 - 0.9);
    this.group.add(exitRing);

    // People.
    this.group.add(this.crowd.group);
    const dancer = (top: number, hair: number, skin: number): Outfit => ({
      skin, hair, top, legs: top, shoes: 0x111111, shortSleeves: true, shorts: true, hairStyle: 'long', build: 1, height: 1.0,
    });
    const npc = (o: Outfit, n: Omit<Npc, 'i' | 't0'>) => {
      const i = this.npcs.length;
      this.crowd.setOutfit(i, o);
      this.npcs.push({ ...n, i, t0: Math.random() * 10 });
    };
    npc(dancer(0xd4148a, 0x1d1612, 0xe8c0a0), { kind: 'dance', x: 0, y: STAGE_H, z: -6.5, yaw: 0, style: 3, orbit: { cx: 0, cz: -6.5, r: 0.38, speed: 0.35 } });
    npc(dancer(0xc9a23a, 0xc9a66b, 0xf1d0b5), { kind: 'dance', x: 0, y: STAGE_H, z: 1.2, yaw: Math.PI, style: 3, orbit: { cx: 0, cz: 1.2, r: 0.38, speed: -0.28 } });
    npc(dancer(0x1d1d24, 0x6e2a1a, 0xb88466), { kind: 'dance', x: -6.8, y: 0.6, z: -7.4, yaw: 0.6, style: 1 });
    npc(dancer(0x5a2fd4, 0x1d1612, 0x8d5f45), { kind: 'dance', x: 0.2, y: STAGE_H, z: -3.2, yaw: 0, style: 0 });
    // Bartender behind the bar, bouncers at the door, DJ.
    npc({ skin: 0xd6a684, hair: 0x1d1612, top: 0x111111, legs: 0x1a1a1a, shoes: 0x111111, hairStyle: 'short' }, { kind: 'idle', x: 8.6, y: 0, z: 3, yaw: -Math.PI / 2, style: 0 });
    npc({ skin: 0x8d5f45, hair: 0x111111, top: 0x0c0c0c, legs: 0x0c0c0c, shoes: 0x111111, hairStyle: 'bald', build: 0, height: 1.06 }, { kind: 'idle', x: 1.9, y: 0, z: D / 2 - 1.6, yaw: Math.PI - 0.4, style: 0 });
    npc({ skin: 0xe8c0a0, hair: 0x3a2a1e, top: 0x2b2b2b, legs: 0x1e1e22, shoes: 0x111111, hairStyle: 'cap' }, { kind: 'dance', x: 6.5, y: 0, z: -11.2, yaw: 0, style: 1 });
    // Guests: at the tables, on the sofas and at the bar.
    const guest = (k: number): Outfit => ({
      skin: [0xe8c0a0, 0xd6a684, 0xb88466, 0xf1d0b5][k % 4], hair: [0x3a2a1e, 0x1d1612, 0x8a6236][k % 3], top: [0x2f5a8a, 0x8a2f2f, 0x3f6f3a, 0x2b2b2b, 0xd8d4c8, 0x5a4a6a][k % 6],
      legs: [0x2e3442, 0x1e1e22, 0x4a5a7a][k % 3], shoes: 0x1f1f1f, hairStyle: (['short', 'short', 'cap', 'long', 'bald'] as const)[k % 5], build: k % 4 === 3 ? 0.8 : 0.1,
    });
    let k = 0;
    for (const [x, z, yaw] of [[-3.4 + 0.66, 3 + 0.45, -2.2], [3.4 + 0.66, 3 + 0.45, -2.6], [-3.6 + 0.66, 6.6 + 0.45, -2.4], [3.6 - 0.66, 6.6 + 0.45, 2.6], [-8.75, -1, Math.PI / 2], [-8.75, 2.4, Math.PI / 2], [6.7, -1 + 1.6 * 2, Math.PI / 2]]) {
      npc(guest(k++), { kind: 'sit', x, y: 0, z, yaw, style: 0 });
    }
    this.crowd.count = this.npcs.length;

    this.group.position.copy(ORIGIN);
    for (const [x, y, z, hx, hy, hz] of colliders) {
      phys.world.createCollider(phys.R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(ORIGIN.x + x, ORIGIN.y + y, ORIGIN.z + z));
    }
  }

  near(p: THREE.Vector3, spot: THREE.Vector3, r: number): boolean {
    return Math.hypot(p.x - spot.x, p.z - spot.z) < r && Math.abs(p.y - spot.y) < 3;
  }

  /** Standing at the bar counter. */
  atBar(p: THREE.Vector3): boolean {
    const x = p.x - ORIGIN.x, z = p.z - ORIGIN.z;
    return Math.abs(p.y - ORIGIN.y) < 2 && x > 5.9 && x < 7.2 && z > -2 && z < 8;
  }

  /** Standing by the runway or a stage (tip a dancer). */
  atStage(p: THREE.Vector3): boolean {
    const x = p.x - ORIGIN.x, z = p.z - ORIGIN.z;
    if (Math.abs(p.y - ORIGIN.y) > 2) return false;
    return (Math.abs(x) < 2.6 && z > -4.5 && z < 3) || Math.hypot(x, z + 6.5) < 4.4 || Math.hypot(x + 6.8, z + 8) < 2.4;
  }

  /** Tip the dancer nearest to `p`: money rains over her and she cheers. */
  tip(p: THREE.Vector3) {
    let best: Npc | null = null, bd = Infinity;
    for (const n of this.npcs) {
      if (n.kind !== 'dance' || n.i === 6) continue;
      const d = Math.hypot(ORIGIN.x + n.x - p.x, ORIGIN.z + n.z - p.z);
      if (d < bd) { bd = d; best = n; }
    }
    if (!best) return;
    this.cheer.set(best.i, this.time + 3.5);
    for (let k = 0; k < 10; k++) {
      const mesh = new THREE.Mesh(this.billGeo, this.billMat);
      mesh.position.set(best.x + (Math.random() - 0.5) * 0.8, best.y + 2.3 + Math.random() * 0.5, best.z + (Math.random() - 0.5) * 0.8);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.group.add(mesh);
      this.bills.push({ mesh, v: new THREE.Vector3((Math.random() - 0.5) * 0.4, -0.6 - Math.random() * 0.4, (Math.random() - 0.5) * 0.4), life: 3 });
    }
  }

  /** Animations; only called while the player is inside. */
  update(dt: number) {
    this.time += dt;
    const t = this.time;
    this.ball.rotation.y += dt * 0.6;
    this.beams.forEach((b, k) => {
      b.rotation.set(Math.sin(t * 0.7 + k * 1.3) * 0.45, 0, Math.cos(t * 0.53 + k) * 0.45);
      (b.material as THREE.MeshBasicMaterial).opacity = 0.07 + Math.max(0, Math.sin(t * 2.1 + k * 2)) * 0.06;
    });
    // LEDs pulse with the beat (~120 bpm).
    const beat = Math.pow(1 - ((t * 2) % 1), 3);
    this.leds.forEach((m, k) => m.color.setHSL(k % 2 ? 0.62 : 0.89, 1, 0.42 + beat * 0.2));
    const root = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (const n of this.npcs) {
      let x = n.x, z = n.z, yaw = n.yaw;
      if (n.orbit) {
        // Around the pole, facing it slightly, one hand on it.
        const a = t * n.orbit.speed + n.t0;
        x = n.orbit.cx + Math.sin(a) * n.orbit.r;
        z = n.orbit.cz + Math.cos(a) * n.orbit.r;
        yaw = a + Math.PI / 2 * Math.sign(n.orbit.speed);
      }
      const cheering = (this.cheer.get(n.i) ?? 0) > t;
      if (n.kind === 'dance') dancePose(this.pose, t + n.t0, cheering ? 0 : n.style);
      else if (n.kind === 'sit') sitPose(this.pose, t + n.t0);
      else idlePose(this.pose, t + n.t0);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      root.compose(pos.set(x, n.y, z), q, one);
      this.crowd.setPose(n.i, root, this.pose);
    }
    this.crowd.commit();
    for (let k = this.bills.length - 1; k >= 0; k--) {
      const b = this.bills[k];
      b.life -= dt;
      b.mesh.position.addScaledVector(b.v, dt);
      b.mesh.rotation.x += dt * 4;
      b.mesh.rotation.z += dt * 3;
      if (b.mesh.position.y < STAGE_H + 0.02) b.v.set(0, 0, 0);
      if (b.life <= 0) {
        this.group.remove(b.mesh);
        this.bills.splice(k, 1);
      }
    }
  }
}
