// Velvet Club private rooms: behind the curtain at the back left of the club the madam offers
// the girls. Pay, and the chosen girl leads you to a room upstairs – a big bed with a tufted
// headboard and satin sheets, rose petals, lamps on the nightstands, a neon heart, champagne.
// A short scene plays: she leads you in, you sit on the bed, she gives you a private dance, sits
// down next to you, the lights dim and the screen fades to black ("an hour later…"); the rest is
// left to the imagination. Afterwards you walk back to the club through the door.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { HumanCrowd, DEFAULT_OUTFIT, dancePose, sitPose, walkPose, restPose, type Outfit } from '../character/HumanRig.ts';
import { formatKc } from '../combat/Arsenal.ts';

/** The room stands 40 m south of the club hall (both high above the town). */
const ORIGIN = new THREE.Vector3(300, 1500, 40);
const RW = 7, RD = 6, RH = 3.1;
const SEAT = 0.07; // root height when sitting on the mattress edge

export interface Girl {
  name: string;
  price: number;
  blurb: string;
  outfit: Outfit;
}

export const GIRLS: Girl[] = [
  { name: 'Nikol', price: 1500, blurb: 'Brunetka, 23 let. Usměvavá a milá.', outfit: { skin: 0xe8c0a0, hair: 0x3a2216, top: 0xc8102e, legs: 0xc8102e, shoes: 0x0c0c0c, female: true, bare: true, hairStyle: 'long', build: 1 } },
  { name: 'Vanessa', price: 2500, blurb: 'Blondýna, 26 let. Tanečnice z pódia.', outfit: { skin: 0xf1d0b5, hair: 0xd8b878, top: 0x1d1d24, legs: 0x1d1d24, shoes: 0xb3102e, female: true, bare: true, hairStyle: 'ponytail', build: 1, height: 1.02 } },
  { name: 'Lara', price: 4000, blurb: 'Zrzka, 28 let. Hvězda Velvet Clubu, VIP pokoj.', outfit: { skin: 0xf4d6c0, hair: 0xa8401c, top: 0x5a2fd4, legs: 0x5a2fd4, shoes: 0x0c0c0c, female: true, bare: true, hairStyle: 'long', build: 1 } },
];

function colored(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  const n = ng.attributes.position.count, c = new THREE.Color(color), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

function heartTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.lineWidth = 9;
  g.strokeStyle = '#ff3fa0';
  g.shadowColor = '#ff2f8f';
  const heart = () => {
    g.beginPath();
    g.moveTo(128, 210);
    g.bezierCurveTo(30, 140, 20, 60, 80, 50);
    g.bezierCurveTo(110, 45, 125, 70, 128, 90);
    g.bezierCurveTo(131, 70, 146, 45, 176, 50);
    g.bezierCurveTo(236, 60, 226, 140, 128, 210);
    g.stroke();
  };
  for (const b of [30, 16, 6]) {
    g.shadowBlur = b;
    heart();
  }
  g.shadowBlur = 0;
  g.strokeStyle = '#ffe0f0';
  g.lineWidth = 3;
  heart();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

type Phase = 'none' | 'enter' | 'dance' | 'close' | 'black' | 'after';
const T_ENTER = 3.4, T_DANCE = 9, T_CLOSE = 3.2, T_BLACK = 3.6;

export class Privat {
  readonly group = new THREE.Group();
  /** Where the (hidden) player waits during the scene, and where they stand afterwards. */
  readonly hold = ORIGIN.clone().add(new THREE.Vector3(2.6, 0.1, 2.3));
  readonly stand = ORIGIN.clone().add(new THREE.Vector3(1.5, 0.1, 0.2));
  readonly standYaw = Math.PI * 0.85;
  readonly exit = ORIGIN.clone().add(new THREE.Vector3(0, 0, RD / 2 - 0.55));
  private crowd = new HumanCrowd(2);
  private pose = restPose();
  phase: Phase = 'none';
  private t = 0;
  private time = 0;
  private girl = 0;
  private walkPhase = [0, 0];
  private fade = document.createElement('div');
  private menu = document.createElement('div');
  menuOpen = false;
  private msg = '';
  /** Paid for a girl from the menu: returns an error message, or '' when the scene starts. */
  onPick?: (i: number) => string;
  money: () => number = () => 0;

  constructor(phys: PhysicsWorld) {
    const parts: THREE.BufferGeometry[] = [];
    const colliders: [number, number, number, number, number, number][] = [];
    const add = (g: THREE.BufferGeometry, color: number) => parts.push(colored(g, color));
    const solid = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, collide = true) => {
      add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
      if (collide) colliders.push([x, y, z, w / 2, h / 2, d / 2]);
    };
    // Room: thick carpet, velvet walls with panels, dark ceiling.
    solid(RW, 0.2, RD, 0, -0.1, 0, 0x4a1420);
    solid(RW, RH, 0.3, 0, RH / 2, -RD / 2, 0x3a0c18);
    solid(RW, RH, 0.3, 0, RH / 2, RD / 2, 0x3a0c18);
    solid(0.3, RH, RD, -RW / 2, RH / 2, 0, 0x3a0c18);
    solid(0.3, RH, RD, RW / 2, RH / 2, 0, 0x3a0c18);
    solid(RW, 0.2, RD, 0, RH + 0.1, 0, 0x14080c, false);
    for (const x of [-2.4, 2.4]) add(new THREE.BoxGeometry(1.6, 2.0, 0.05).translate(x, 1.5, -RD / 2 + 0.17), 0x56142a);
    // Skirting and a gold picture rail.
    for (const [w, d, x, z] of [[RW, 0.04, 0, -RD / 2 + 0.16], [RW, 0.04, 0, RD / 2 - 0.16], [0.04, RD, -RW / 2 + 0.16, 0], [0.04, RD, RW / 2 - 0.16, 0]] as const) {
      add(new THREE.BoxGeometry(w, 0.1, d).translate(x, 0.05, z), 0x1a0a0e);
      add(new THREE.BoxGeometry(w, 0.04, d).translate(x, 2.55, z), 0xb08a3a);
    }
    // Bed against the back wall: dark frame, mattress, satin sheet, pillows, tufted headboard.
    const bz = -RD / 2 + 0.15 + 1.1;
    solid(2.1, 0.3, 2.2, 0, 0.15, bz, 0x2a1410);
    add(new THREE.BoxGeometry(2.0, 0.2, 2.1).translate(0, 0.4, bz), 0xf2e8e8);
    add(new THREE.BoxGeometry(2.06, 0.05, 1.55).translate(0, 0.5, bz + 0.3), 0x9a0f24);
    add(new THREE.BoxGeometry(2.08, 0.18, 0.04).translate(0, 0.42, bz + 1.06), 0x9a0f24);
    for (const x of [-0.5, 0.5]) add(new THREE.SphereGeometry(0.3, 12, 8).scale(1.3, 0.38, 0.75).translate(x, 0.56, bz - 0.8), 0xf6eeee);
    add(new THREE.BoxGeometry(2.3, 1.35, 0.14).translate(0, 0.9, -RD / 2 + 0.22), 0x1e0810);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) add(new THREE.SphereGeometry(0.03, 6, 4).translate(-0.9 + i * 0.45, 0.65 + j * 0.3, -RD / 2 + 0.3), 0x0e0408);
    // Nightstands with lamp bases, champagne bucket and two glasses.
    for (const x of [-1.5, 1.5]) {
      solid(0.55, 0.55, 0.45, x, 0.275, -RD / 2 + 0.4, 0x2a1410);
      add(new THREE.CylinderGeometry(0.04, 0.07, 0.3, 10).translate(x, 0.7, -RD / 2 + 0.4), 0xb08a3a);
    }
    add(new THREE.CylinderGeometry(0.11, 0.09, 0.2, 14).translate(1.5, 0.65, -RD / 2 + 0.55), 0xc8ccd0);
    add(new THREE.CylinderGeometry(0.035, 0.04, 0.32, 10).translate(1.5, 0.8, -RD / 2 + 0.55), 0x1f4a2a);
    for (const dx of [-0.13, 0.13]) add(new THREE.CylinderGeometry(0.03, 0.012, 0.12, 8).translate(-1.5 + dx, 0.62, -RD / 2 + 0.5), 0xe8e4dc);
    // Velvet armchair by the right wall, round rug, curtains on the left wall, a dresser.
    solid(0.8, 0.45, 0.8, 2.7, 0.225, -0.6, 0x6a0f2a);
    solid(0.8, 0.9, 0.2, 3.0, 0.45, -0.6, 0x5a0c22);
    add(new THREE.CylinderGeometry(1.4, 1.4, 0.015, 32).translate(0, 0.008, 0.7), 0x8a2038);
    for (let k = 0; k < 9; k++) add(new THREE.BoxGeometry(0.08, 2.6, 0.2).translate(-RW / 2 + 0.25 + (k % 2) * 0.05, 1.35, -1.4 + k * 0.28), k % 2 ? 0x5a0c22 : 0x6e1230);
    solid(1.3, 0.8, 0.45, -2.6, 0.4, 2.2, 0x2a1410);
    // Door frame.
    add(new THREE.BoxGeometry(1.3, 2.25, 0.06).translate(0, 1.125, RD / 2 - 0.16), 0x1a0a0e);
    add(new THREE.BoxGeometry(1.1, 2.1, 0.04).translate(0, 1.05, RD / 2 - 0.2), 0x3a1a14);
    const room = new THREE.Mesh(mergeGeometries(parts, false)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
    room.receiveShadow = true;
    this.group.add(room);
    // Glowing bits: lamp shades, the neon heart, candles; rose petals on the sheet.
    const glow = new THREE.MeshBasicMaterial({ color: 0xffb070, toneMapped: false });
    for (const x of [-1.5, 1.5]) {
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.2, 16, 1, true), glow);
      shade.position.set(x, 0.95, -RD / 2 + 0.4);
      this.group.add(shade);
    }
    const heart = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), new THREE.MeshBasicMaterial({ map: heartTexture(), transparent: true, toneMapped: false, depthWrite: false }));
    heart.position.set(0, 2.15, -RD / 2 + 0.17);
    this.group.add(heart);
    const petals = new THREE.InstancedMesh(new THREE.CircleGeometry(0.035, 6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb0102a, roughness: 0.5 }), 40);
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.55;
      petals.setMatrixAt(i, new THREE.Matrix4().makeRotationY(Math.random() * 3).setPosition(Math.cos(a) * r * 1.4, 0.53, bz + 0.25 + Math.sin(a) * r));
    }
    this.group.add(petals);
    const exitRing = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.55, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3aff6a, transparent: true, opacity: 0.6, toneMapped: false }));
    exitRing.position.set(0, 0.02, RD / 2 - 0.55);
    this.group.add(exitRing);
    this.group.add(this.crowd.group);

    this.group.position.copy(ORIGIN);
    for (const [x, y, z, hx, hy, hz] of colliders) {
      phys.world.createCollider(phys.R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(ORIGIN.x + x, ORIGIN.y + y, ORIGIN.z + z));
    }

    this.fade.id = 'privat-fade';
    this.menu.id = 'privat';
    this.menu.hidden = true;
    document.body.append(this.fade, this.menu);
    this.menu.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'close') return this.closeMenu();
      const res = this.onPick?.(Number(b.dataset.i)) ?? '';
      this.msg = res;
      if (res) this.renderMenu();
      else this.closeMenu();
    });
  }

  /** The scene is running (the player is hidden, the camera is ours). */
  get cinematic() {
    return this.phase === 'enter' || this.phase === 'dance' || this.phase === 'close' || this.phase === 'black';
  }

  /** In the room (scene or afterwards). */
  get active() {
    return this.phase !== 'none';
  }

  openMenu() {
    if (this.menuOpen) return;
    this.menuOpen = true;
    this.msg = '';
    this.menu.hidden = false;
    document.exitPointerLock?.();
    this.renderMenu();
  }

  closeMenu() {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.menu.hidden = true;
  }

  private renderMenu() {
    const money = this.money();
    const cards = GIRLS.map((g, i) => {
      const o = g.outfit, hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
      return `<article><div class="pic" style="--skin:${hex(o.skin)};--hair:${hex(o.hair)};--wear:${hex(o.top)}"><i></i><b></b><u></u></div>
        <div class="info"><h3>${g.name}</h3><p>${g.blurb}</p><p class="price">${formatKc(g.price)} <small>/ hodina</small></p>
        <button data-a="pick" data-i="${i}" class="main" ${money < g.price ? 'disabled' : ''}>Zaplatit a jít nahoru</button></div></article>`;
    }).join('');
    this.menu.innerHTML = `<header><small>VELVET CLUB · PRIVÁT</small><h2>Madam Simona</h2><p>„Vítej, zlato. Která se ti líbí?“</p></header>
      <div class="cards">${cards}</div>
      ${this.msg ? `<p class="msg">${this.msg}</p>` : ''}
      <footer><span>Máš ${formatKc(money)}</span><button data-a="close">Zavřít</button></footer>`;
  }

  /** Starts the scene with girl `i` (already paid). */
  begin(i: number) {
    this.girl = i;
    this.phase = 'enter';
    this.t = 0;
    this.crowd.setOutfit(0, GIRLS[i].outfit);
    this.crowd.setOutfit(1, DEFAULT_OUTFIT);
    this.crowd.count = 2;
    this.setFade(1, 0);
    requestAnimationFrame(() => this.setFade(0, 1.2));
  }

  /** F during the scene: skip ahead to the fade. */
  skip() {
    if (this.phase === 'enter' || this.phase === 'dance' || this.phase === 'close') {
      this.phase = 'black';
      this.t = 0;
      this.setFade(1, 0.6, 'O hodinu později…');
    }
  }

  /** Left the room (or the club): everything back to normal. */
  end() {
    this.phase = 'none';
    this.crowd.count = 0;
    this.setFade(0, 0);
    this.closeMenu();
  }

  private setFade(opacity: number, seconds: number, text = '') {
    this.fade.style.transition = `opacity ${seconds}s ease`;
    this.fade.style.opacity = String(opacity);
    this.fade.textContent = text;
  }

  near(p: THREE.Vector3, spot: THREE.Vector3, r: number): boolean {
    return Math.hypot(p.x - spot.x, p.z - spot.z) < r && Math.abs(p.y - spot.y) < 3;
  }

  /**
   * Advances the scene. Returns 'after' once, when the fade is over and the player should get
   * control back (standing next to the bed).
   */
  update(dt: number): 'after' | null {
    if (this.phase === 'none') return null;
    this.time += dt;
    this.t += dt;
    const t = this.t, time = this.time;
    let out: 'after' | null = null;
    const bz = -RD / 2 + 0.15 + 1.1, edge = bz + 1.0;
    // Positions in room coordinates: girl (0) and the player's double (1).
    let g = { x: 0.35, y: 0, z: edge, yaw: 0 }, p = { x: -0.35, y: 0, z: edge, yaw: 0 };
    const q = new THREE.Quaternion(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, Math.max(0, k));
    const pose = (i: number, x: number, y: number, z: number, yaw: number) => {
      q.setFromAxisAngle(up, yaw);
      m.compose(new THREE.Vector3(x, y, z), q, one);
      this.crowd.setPose(i, m, this.pose);
    };
    switch (this.phase) {
      case 'enter': {
        // She leads you by the hand from the door to the bed.
        const k = t / T_ENTER;
        g = { x: lerp(0.2, 0.35, k), y: 0, z: lerp(RD / 2 - 0.8, edge + 1.1, k), yaw: Math.PI };
        p = { x: lerp(-0.2, -0.35, k), y: 0, z: lerp(RD / 2 - 0.3, edge + 0.35, k * 1.05), yaw: Math.PI };
        const v = (RD / 2 - edge) / T_ENTER;
        this.walkPhase[0] += dt * v * 5.2;
        this.walkPhase[1] += dt * v * 5.2;
        walkPose(this.pose, this.walkPhase[0], k < 1 ? v : 0, time);
        this.pose.rSh = [-0.5, 0, -0.25]; // hand back, holding his
        this.pose.rEl = -0.2;
        pose(0, g.x, g.y, g.z, g.yaw);
        walkPose(this.pose, this.walkPhase[1], k < 1 ? v : 0, time);
        this.pose.lSh = [-0.55, 0, 0.2];
        pose(1, p.x, p.y, p.z, p.yaw);
        if (t >= T_ENTER) { this.phase = 'dance'; this.t = 0; }
        break;
      }
      case 'dance': {
        // You sit on the edge of the bed; she dances for you, turning now and then.
        sitPose(this.pose, time);
        this.pose.lSh = [-0.2, 0, 0.25]; this.pose.rSh = [-0.2, 0, -0.25];
        this.pose.lEl = -0.4; this.pose.rEl = -0.4;
        pose(1, -0.1, SEAT, edge - 0.1, 0);
        const style = [1, 2, 0, 1][Math.floor(t / 2.4) % 4];
        dancePose(this.pose, time, style);
        const turn = Math.sin(t * 0.7) * 0.6;
        pose(0, -0.1 + Math.sin(t * 0.9) * 0.25, 0, edge + 0.95, Math.PI + turn);
        if (t >= T_DANCE) { this.phase = 'close'; this.t = 0; this.setFade(0.45, T_CLOSE); }
        break;
      }
      case 'close': {
        // She sits down close beside you, leaning in; the lights go down.
        sitPose(this.pose, time);
        pose(1, -0.1, SEAT, edge - 0.1, 0.25);
        sitPose(this.pose, time + 2);
        this.pose.lean = -0.05;
        this.pose.sway = -0.12; this.pose.chestZ = -0.15; this.pose.headZ = -0.25;
        this.pose.lSh = [-0.9, 0, 0.6]; this.pose.lEl = -0.6; // arm around his shoulders
        const k = Math.min(1, t / 1.2);
        pose(0, lerp(0.3, 0.45, k), lerp(0, SEAT, k), edge - 0.08, -0.35);
        if (t >= T_CLOSE) { this.phase = 'black'; this.t = 0; this.setFade(1, 0.9, 'O hodinu později…'); }
        break;
      }
      case 'black':
        // Off screen. The double is hidden; she will be sitting on the bed afterwards.
        this.crowd.count = 1;
        if (t >= T_BLACK) {
          this.phase = 'after';
          this.t = 0;
          this.setFade(0, 1.4);
          out = 'after';
        }
        break;
      case 'after':
        // She sits on the bed, relaxed, and waves you goodbye.
        sitPose(this.pose, time);
        if (t < 4) { this.pose.rSh = [-0.4, 0, -2.4]; this.pose.rEl = -0.6 - Math.sin(t * 9) * 0.4; }
        this.pose.headY = -0.4;
        pose(0, 0.2, SEAT, edge - 0.1, 0.4);
        break;
    }
    this.crowd.commit();
    return out;
  }

  /** Cinematic camera during the scene. */
  placeCamera(cam: THREE.PerspectiveCamera) {
    const bz = -RD / 2 + 0.15 + 1.1, edge = bz + 1.0;
    const look = new THREE.Vector3(0, 0.95, edge + 0.3);
    const pos = new THREE.Vector3(2.6, 1.75, edge + 2.6);
    if (this.phase === 'dance') {
      const a = this.t * 0.06;
      pos.set(2.3 - a, 1.55, edge + 2.4);
      look.set(-0.1, 1.0, edge + 0.5);
    } else if (this.phase === 'close' || this.phase === 'black') {
      const k = Math.min(1, this.t / T_CLOSE);
      pos.set(1.9 - k * 0.4, 1.35, edge + 1.9 - k * 0.3);
      look.set(0.1, 0.85, edge - 0.1);
    }
    cam.position.copy(pos.add(ORIGIN));
    cam.lookAt(look.add(ORIGIN));
  }

  get girlName() {
    return GIRLS[this.girl].name;
  }
}
