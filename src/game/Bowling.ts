// Bowling Blansko (Dvorská 2388/4): the hall inside the real building, modelled after photos of
// the place – 8 wooden lanes with gutters, a sea / sunset mural over the pins, ball returns with
// racks of coloured balls, monitors over the lanes, a red carpet aisle, grey carpet with round
// salmon-coloured tables and wooden chairs, and a bar. Built once high above the town (like the
// store hall and the club), with its own colliders.
//
// Lane 6 is playable: the ball and the ten pins are real Rapier bodies; a game is 10 frames
// with normal scoring (strikes, spares, bonus balls in the 10th frame).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { HumanCrowd, idlePose, sitPose, restPose, type Outfit } from '../character/HumanRig.ts';

const ORIGIN = new THREE.Vector3(-300, 1500, 0);
/** Hall: x across the lanes, z along them (pins at -z). */
const X0 = -11, X1 = 11, Z0 = -16, Z1 = 21, H = 4.2;
const LANES = 8, PITCH = 1.62, LANE_W = 1.06, GUTTER = 0.24;
const laneX = (i: number) => -9.2 + i * PITCH;
const FOUL = 6, PIN_Z = FOUL - 18.29, LANE_END = PIN_Z - 1.0, LANE_TOP = 0.05;
const PLAY = 5; // playable lane index
export const GAME_PRICE = 120;
const BALL_R = 0.108, PIN_H = 0.38, PIN_R = 0.06;

function colored(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  const n = ng.attributes.position.count, c = new THREE.Color(color), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

/** The mural over the pins: a sea at sunset with a breaking wave, gulls and a boat. */
function muralTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 256;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 170);
  sky.addColorStop(0, '#5b9ad8');
  sky.addColorStop(0.55, '#9cc8ea');
  sky.addColorStop(1, '#f2c27a');
  g.fillStyle = sky;
  g.fillRect(0, 0, 2048, 256);
  // Sun and red streaks of cloud.
  const sun = g.createRadialGradient(880, 160, 10, 880, 160, 260);
  sun.addColorStop(0, 'rgba(255,240,140,1)');
  sun.addColorStop(0.15, 'rgba(255,200,90,0.9)');
  sun.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = sun;
  g.fillRect(500, 0, 800, 256);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(${200 + Math.random() * 55},${50 + Math.random() * 60},${40 + Math.random() * 40},${0.35 + Math.random() * 0.35})`;
    g.beginPath();
    g.ellipse(950 + Math.random() * 700, 60 + Math.random() * 90, 120 + Math.random() * 160, 8 + Math.random() * 10, 0, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 22; i++) {
    g.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.4})`;
    g.beginPath();
    g.ellipse(Math.random() * 2048, 20 + Math.random() * 100, 60 + Math.random() * 140, 6 + Math.random() * 12, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Sea with the sun's reflection.
  const sea = g.createLinearGradient(0, 168, 0, 256);
  sea.addColorStop(0, '#3f7fb0');
  sea.addColorStop(1, '#1d4f7a');
  g.fillStyle = sea;
  g.fillRect(0, 168, 2048, 88);
  g.fillStyle = 'rgba(255,210,120,0.55)';
  for (let y = 172; y < 256; y += 6) g.fillRect(880 - (y - 160) * 0.8, y, (y - 160) * 1.6, 2);
  // Big breaking wave on the left, icebergs at the far left.
  g.fillStyle = '#e8f6ff';
  g.beginPath();
  g.moveTo(60, 200);
  g.quadraticCurveTo(220, 60, 380, 150);
  g.quadraticCurveTo(300, 120, 280, 175);
  g.lineTo(520, 210);
  g.lineTo(60, 230);
  g.fill();
  g.fillStyle = '#4f96c8';
  g.beginPath();
  g.moveTo(100, 205);
  g.quadraticCurveTo(230, 90, 340, 150);
  g.quadraticCurveTo(270, 140, 260, 190);
  g.fill();
  g.fillStyle = '#d6ecfa';
  for (const [x, w] of [[10, 70], [40, 50]]) {
    g.beginPath();
    g.moveTo(x, 175);
    g.lineTo(x + w / 2, 110);
    g.lineTo(x + w, 175);
    g.fill();
  }
  // Gulls and a boat on the right.
  g.strokeStyle = '#3a3a44';
  g.lineWidth = 3;
  for (const [x, y] of [[1000, 40], [1180, 70], [700, 90], [1500, 50]]) {
    g.beginPath();
    g.moveTo(x - 14, y);
    g.quadraticCurveTo(x - 6, y - 8, x, y);
    g.quadraticCurveTo(x + 6, y - 8, x + 14, y);
    g.stroke();
  }
  g.fillStyle = '#5a4030';
  g.beginPath();
  g.moveTo(1820, 196);
  g.lineTo(1960, 196);
  g.lineTo(1940, 212);
  g.lineTo(1835, 212);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Wooden lane texture: maple boards with the arrows and dots. */
function laneTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 1024;
  const g = c.getContext('2d')!;
  for (let b = 0; b < 16; b++) {
    const l = 74 + Math.random() * 8;
    g.fillStyle = `hsl(36, 58%, ${l}%)`;
    g.fillRect(b * 8, 0, 8, 1024);
    g.fillStyle = 'rgba(120,80,30,0.12)';
    g.fillRect(b * 8, 0, 1, 1024);
  }
  // Glossy streak and the aiming arrows (~15 ft past the foul line).
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(48, 0, 30, 1024);
  g.fillStyle = '#5a3a22';
  for (let k = 0; k < 7; k++) {
    const x = 12 + k * 17, y = 860 - Math.abs(3 - k) * 12;
    g.beginPath();
    g.moveTo(x, y - 18);
    g.lineTo(x + 4, y);
    g.lineTo(x - 4, y);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function pinGeometry(): THREE.BufferGeometry {
  // Bowling pin profile (radius, height from the base), with two red neck stripes via vertex colours.
  const prof: [number, number][] = [[0, 0], [0.026, 0], [0.04, 0.02], [0.058, 0.09], [0.06, 0.13], [0.05, 0.2], [0.026, 0.27], [0.022, 0.3], [0.03, 0.34], [0.026, 0.37], [0.012, 0.38], [0, 0.381]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y - PIN_H / 2)), 16).toNonIndexed();
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + PIN_H / 2;
    const red = (y > 0.245 && y < 0.258) || (y > 0.265 && y < 0.278);
    col.set(red ? [0.75, 0.05, 0.05] : [0.96, 0.95, 0.92], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Score of a game from the list of knocked pins per roll (standard ten-pin rules). */
export function scoreFrames(rolls: number[]): { marks: string[][]; totals: (number | null)[] } {
  const marks: string[][] = [], totals: (number | null)[] = [];
  let i = 0, total = 0;
  for (let f = 0; f < 10; f++) {
    const m: string[] = [];
    if (f < 9) {
      if (rolls[i] === undefined) { marks.push(m); totals.push(null); continue; }
      if (rolls[i] === 10) {
        m.push('X');
        const b1 = rolls[i + 1], b2 = rolls[i + 2];
        total += 10 + (b1 ?? 0) + (b2 ?? 0);
        totals.push(b1 !== undefined && b2 !== undefined ? total : null);
        i += 1;
      } else {
        m.push(rolls[i] ? String(rolls[i]) : '-');
        const r2 = rolls[i + 1];
        if (r2 === undefined) { marks.push(m); totals.push(null); i += 1; continue; }
        const spare = rolls[i] + r2 === 10;
        m.push(spare ? '/' : r2 ? String(r2) : '-');
        const bonus = spare ? rolls[i + 2] : 0;
        total += rolls[i] + r2 + (bonus ?? 0);
        totals.push(spare && bonus === undefined ? null : total);
        i += 2;
      }
    } else {
      const r = rolls.slice(i, i + 3);
      r.forEach((v, k) => {
        const prev = r[k - 1];
        m.push(v === 10 && (k === 0 || prev === 10 || (k === 2 && r[0] + r[1] === 10 && r[1] !== 10)) ? 'X' : k > 0 && prev !== 10 && prev + v === 10 && !(k === 2 && r[0] + r[1] === 10) ? '/' : v ? String(v) : '-');
      });
      const done = r.length === 3 || (r.length === 2 && r[0] + r[1] < 10);
      if (done) total += r.reduce((a, b) => a + b, 0);
      totals.push(done ? total : null);
    }
    marks.push(m);
  }
  return { marks, totals };
}

type Phase = 'idle' | 'aim' | 'swing' | 'roll' | 'settle' | 'over';

export class Bowling {
  readonly group = new THREE.Group();
  readonly spawn = ORIGIN.clone().add(new THREE.Vector3(2.2, 0.1, Z1 - 2.2));
  readonly spawnYaw = Math.PI;
  readonly exit = ORIGIN.clone().add(new THREE.Vector3(2.2, 0, Z1 - 0.9));
  /** Where you start a game (the approach of the playable lane). */
  readonly start = ORIGIN.clone().add(new THREE.Vector3(laneX(PLAY), 0, FOUL + 3.4));
  private ball: { body: RAPIER.RigidBody; mesh: THREE.Mesh };
  private pins: { body: RAPIER.RigidBody; mesh: THREE.Mesh; home: THREE.Vector3; down: boolean; gone: boolean }[] = [];
  private crowd = new HumanCrowd(10);
  private npcs: { x: number; z: number; yaw: number; sit: boolean; t0: number }[] = [];
  private pose = restPose();
  private time = 0;
  private screens: { tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D }[] = [];
  private board = document.createElement('div');
  // Game state.
  phase: Phase = 'idle';
  private rolls: number[] = [];
  private frame = 0;
  private ballInFrame = 0;
  private standingBefore = 10;
  /** Aim: offset across the lane (m) and angle (rad); power 0..1 (oscillating meter). */
  private offset = 0;
  private angle = 0;
  private power = 0;
  private powerDir = 1;
  private charging = false;
  private phaseT = 0;
  /** Called to play the throw animation and sounds. */
  onThrow?: () => void;
  onPins?: (n: number, strike: boolean, spare: boolean) => void;
  onMessage?: (text: string) => void;

  constructor(phys: PhysicsWorld) {
    const R = phys.R, world = phys.world;
    const parts: THREE.BufferGeometry[] = [];
    const colliders: [number, number, number, number, number, number][] = [];
    const add = (g: THREE.BufferGeometry, color: number) => parts.push(colored(g, color));
    const solid = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, collide = true) => {
      add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
      if (collide) colliders.push([x, y, z, w / 2, h / 2, d / 2]);
    };
    const W = X1 - X0, D = Z1 - Z0, CX = (X0 + X1) / 2, CZ = (Z0 + Z1) / 2;
    // Floors: grey carpet, red aisle behind the approaches, the pit behind the pins lower.
    solid(W, 0.2, Z1 - LANE_END, CX, -0.1, (Z1 + LANE_END) / 2, 0x5b6470);
    solid(W, 0.2, LANE_END - Z0, CX, -0.7, (LANE_END + Z0) / 2, 0x1a1a1c);
    add(new THREE.BoxGeometry(13.4, 0.012, 1.6).translate(-3.6, 0.006, FOUL + 5.4), 0x8a1c22);
    add(new THREE.BoxGeometry(1.6, 0.012, Z1 - FOUL - 6.2).translate(3.95, 0.006, (FOUL + 6.2 + Z1) / 2), 0x8a1c22);
    // Approach (wood) in front of the foul lines.
    add(new THREE.BoxGeometry(13.2, 0.03, 4.6).translate(-3.53, 0.015, FOUL + 2.3), 0xd8a964);
    // Walls: white, the back wall over the pins carries the mural.
    solid(W, H, 0.3, CX, H / 2, Z0, 0x2a2a2e);
    solid(W, H, 0.3, CX, H / 2, Z1, 0xeceae4);
    solid(0.3, H, D, X0, H / 2, CZ, 0xeceae4);
    solid(0.3, H, D, X1, H / 2, CZ, 0xeceae4);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xcfcbc0 }));
    ceiling.position.set(CX, H, CZ);
    this.group.add(ceiling);
    // Masking unit above the pins (dark, with the mural over it) and the lane dividers.
    solid(13.8, 1.1, 0.4, -3.53, H - 0.55, PIN_Z - 0.9, 0x1c1c20, false);
    for (let i = 0; i <= LANES; i++) {
      // Capping between lanes (ball returns run under it on the approach).
      const x = laneX(i) - PITCH / 2;
      solid(0.14, 0.12, FOUL - LANE_END, x, 0.06, (FOUL + LANE_END) / 2, 0x3a3a3e);
    }
    // Lanes: each a slightly raised wooden strip with two sunken gutters.
    const laneMat = new THREE.MeshStandardMaterial({ map: laneTexture(), roughness: 0.18, metalness: 0.05 });
    const laneGeo = new THREE.BoxGeometry(LANE_W, LANE_TOP, FOUL - LANE_END).translate(0, LANE_TOP / 2, 0);
    for (let i = 0; i < LANES; i++) {
      const lane = new THREE.Mesh(laneGeo, laneMat);
      lane.position.set(laneX(i), 0, (FOUL + LANE_END) / 2);
      lane.receiveShadow = true;
      this.group.add(lane);
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(GUTTER, 0.01, FOUL - LANE_END).translate(laneX(i) + s * (LANE_W / 2 + GUTTER / 2), 0.0, (FOUL + LANE_END) / 2), 0x9a9da2);
      // Foul line.
      add(new THREE.BoxGeometry(LANE_W, 0.052, 0.03).translate(laneX(i), 0.026, FOUL), 0x111111);
    }
    // Playable lane colliders: lane top, gutter floors, side walls.
    const lx = laneX(PLAY);
    colliders.push([lx, LANE_TOP / 2 - 0.0, (FOUL + LANE_END) / 2, LANE_W / 2, LANE_TOP / 2, (FOUL - LANE_END) / 2]);
    for (const s of [-1, 1]) colliders.push([lx + s * (LANE_W / 2 + GUTTER + 0.07), 0.15, (FOUL + LANE_END) / 2 - 1, 0.07, 0.15, (FOUL - LANE_END) / 2 + 1]);
    // Back cushion in the pit.
    colliders.push([lx, -0.1, Z0 + 0.8, 1.2, 0.6, 0.15]);
    // Ball returns between lane pairs with racks of coloured balls, and the score consoles.
    const ballCols = [0xc8102e, 0x1f4fd8, 0x2fa84f, 0xf2c200, 0xff7a1a, 0x7a2fd8, 0xe03a8f, 0x1a8a8a];
    const rackBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(BALL_R, 16, 12), new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.1 }), 4 * 10);
    let bi = 0;
    for (let k = 0; k < 4; k++) {
      const x = laneX(k * 2) + PITCH / 2;
      solid(0.5, 0.75, 1.1, x, 0.375, FOUL + 1.6, 0xb8bcc2);
      add(new THREE.BoxGeometry(0.42, 0.25, 0.9).translate(x, 0.88, FOUL + 1.55), 0x2a2a2e);
      add(new THREE.BoxGeometry(0.7, 0.06, 1.6).translate(x, 0.42, FOUL + 3.0), 0x1d1d20);
      for (let j = 0; j < 10; j++) {
        rackBalls.setMatrixAt(bi, new THREE.Matrix4().makeTranslation(x + (j % 2 ? 0.13 : -0.13), 0.56 + (j > 5 ? 0.0 : 0), FOUL + 2.35 + Math.floor(j / 2) * 0.27));
        rackBalls.setColorAt(bi++, new THREE.Color(ballCols[(j * 3 + k) % ballCols.length]));
      }
      // Console on a stand.
      add(new THREE.CylinderGeometry(0.04, 0.06, 1.0, 8).translate(x, 0.5, FOUL + 4.3), 0x222222);
      add(new THREE.ConeGeometry(0.3, 0.12, 3).rotateX(Math.PI).translate(x, 1.05, FOUL + 4.3), 0x9aa0a8);
    }
    this.group.add(rackBalls);
    // Seating: grey carpet area to the right with salmon tables and wooden chairs, and a bar.
    for (const [x, z] of [[6.5, 8], [9, 8], [6.5, 11.5], [9, 11.5], [6.5, 15], [9, 15], [-4, 14.5], [-1, 14.5], [-7, 14.5]]) {
      add(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 24).translate(x, 0.74, z), 0xe27a5f);
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.72, 8).translate(x, 0.36, z), 0xcfcfcf);
      add(new THREE.CylinderGeometry(0.25, 0.25, 0.02, 16).translate(x, 0.01, z), 0xcfcfcf);
      colliders.push([x, 0.4, z, 0.4, 0.4, 0.4]);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4, cx = x + Math.cos(a) * 0.82, cz = z + Math.sin(a) * 0.82;
        const seat = new THREE.BoxGeometry(0.44, 0.05, 0.42).translate(0, 0.46, 0);
        const back = new THREE.BoxGeometry(0.44, 0.48, 0.04).rotateX(-0.12).translate(0, 0.72, 0.21);
        const cushion = new THREE.BoxGeometry(0.4, 0.04, 0.38).translate(0, 0.49, 0);
        const yaw = Math.atan2(x - cx, z - cz) + Math.PI;
        for (const [geo, col] of [[seat, 0xc8913f], [back, 0xc8913f], [cushion, 0x6a1a3a]] as const) add(geo.rotateY(yaw).translate(cx, 0, cz), col);
      }
    }
    // Bar at the back right.
    solid(4.5, 1.1, 0.8, 7.6, 0.55, Z1 - 2.4, 0x8a5a34);
    add(new THREE.BoxGeometry(4.7, 0.06, 1.0).translate(7.6, 1.13, Z1 - 2.4), 0xd8c8a8);
    solid(4.5, 2.2, 0.4, 7.6, 1.1, Z1 - 0.4, 0x5a3a24, false);
    for (let k = 0; k < 2; k++) add(new THREE.BoxGeometry(4.2, 0.04, 0.35).translate(7.6, 1.3 + k * 0.55, Z1 - 0.75), 0xd8c8a8);
    // Exit door with a green sign.
    add(new THREE.BoxGeometry(1.8, 2.3, 0.06).translate(2.2, 1.15, Z1 - 0.17), 0x8aa4b4);
    // Windows on the right wall (light panels).
    const glass = new THREE.MeshBasicMaterial({ color: 0xdfe9f2 });
    for (let k = 0; k < 4; k++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), glass);
      w.position.set(X1 - 0.16, 2.6, 4 + k * 3.6);
      w.rotation.y = -Math.PI / 2;
      this.group.add(w);
    }
    // Ceiling lights and the score monitors over the approaches.
    const lamp = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    for (let k = 0; k < 6; k++) for (const x of [-7, -1.5, 5.5]) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5).rotateX(Math.PI / 2), lamp);
      l.position.set(x, H - 0.01, -10 + k * 5.5);
      this.group.add(l);
    }
    for (let k = 0; k < 4; k++) {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 256;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const x = laneX(k * 2) + PITCH / 2;
      add(new THREE.BoxGeometry(1.5, 0.82, 0.12).translate(x, H - 0.75, FOUL - 0.6), 0x111111);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.74), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      scr.position.set(x, H - 0.75, FOUL - 0.53);
      this.group.add(scr);
      this.screens.push({ tex, ctx: c.getContext('2d')! });
      this.drawScreen(k);
    }
    // Mural over the pins and on the side walls near the lanes.
    const mural = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.4, 2.2), new THREE.MeshBasicMaterial({ map: muralTexture() }));
    mural.position.set(CX, 2.1, Z0 + 0.17);
    this.group.add(mural);
    const side = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.2), new THREE.MeshBasicMaterial({ map: muralTexture() }));
    side.position.set(X0 + 0.17, 2.1, -9);
    side.rotation.y = Math.PI / 2;
    this.group.add(side);
    // Big "BOWLING" letters on the wall behind the bar.
    const logo = document.createElement('canvas');
    logo.width = 1024;
    logo.height = 200;
    const lg = logo.getContext('2d')!;
    lg.font = 'italic 900 130px system-ui, sans-serif';
    lg.textAlign = 'center';
    lg.textBaseline = 'middle';
    lg.fillStyle = '#ff6a1a';
    lg.fillText('BOWLING BLANSKO', 512, 100);
    const lt = new THREE.CanvasTexture(logo);
    lt.colorSpace = THREE.SRGBColorSpace;
    const lm = new THREE.Mesh(new THREE.PlaneGeometry(5, 1), new THREE.MeshBasicMaterial({ map: lt, transparent: true }));
    lm.position.set(4, 3.2, Z1 - 0.17);
    lm.rotation.y = Math.PI;
    this.group.add(lm);

    const room = new THREE.Mesh(mergeGeometries(parts, false)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    room.receiveShadow = true;
    this.group.add(room);
    // Standing (decorative) pins on the other lanes.
    const pinGeo = pinGeometry();
    const pinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25 });
    const deco = new THREE.InstancedMesh(pinGeo, pinMat, (LANES - 1) * 10);
    let di = 0;
    for (let i = 0; i < LANES; i++) {
      if (i === PLAY) continue;
      for (const p of this.pinSpots(laneX(i))) deco.setMatrixAt(di++, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
    }
    this.group.add(deco);
    // Playable pins and ball (real bodies, in world coordinates).
    for (const p of this.pinSpots(lx)) {
      const home = p.clone().add(ORIGIN);
      const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(home.x, home.y, home.z).setCanSleep(true).setAngularDamping(0.4).setLinearDamping(0.1));
      world.createCollider(R.ColliderDesc.cylinder(PIN_H / 2, PIN_R).setFriction(0.35).setRestitution(0.45)
        .setMassProperties(1.55, { x: 0, y: -0.05, z: 0 }, { x: 0.017, y: 0.0025, z: 0.017 }, { w: 1, x: 0, y: 0, z: 0 }), body);
      const mesh = new THREE.Mesh(pinGeo, pinMat);
      mesh.castShadow = true;
      this.pins.push({ body, mesh, home, down: false, gone: false });
      body.sleep();
    }
    const bstart = this.ballStart();
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(bstart.x, bstart.y, bstart.z).setCcdEnabled(true).setLinearDamping(0.02).setAngularDamping(0.05));
    world.createCollider(R.ColliderDesc.ball(BALL_R).setMass(6.4).setFriction(0.06).setRestitution(0.05), body);
    body.setEnabled(false);
    const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.12, metalness: 0.15 }));
    ballMesh.castShadow = true;
    ballMesh.visible = false;
    this.ball = { body, mesh: ballMesh };
    // The movable objects live in world space (not in the hall group).
    this.world = new THREE.Group();
    this.world.add(ballMesh, ...this.pins.map((p) => p.mesh));
    this.syncMeshes();

    // People: bowlers on other lanes, guests at the tables, the barman.
    this.group.add(this.crowd.group);
    const person = (k: number, female = false): Outfit => ({
      skin: [0xe8c0a0, 0xd6a684, 0xf1d0b5, 0xb88466][k % 4], hair: [0x3a2a1e, 0x1d1612, 0x8a6236, 0xc9a66b][k % 4],
      top: [0x2f5a8a, 0xc8102e, 0x3f6f3a, 0xe7e2d6, 0x5a4a6a, 0xd8a020][k % 6], legs: [0x2e3442, 0x4a5a7a, 0x1e1e22][k % 3], shoes: [0x8a1f1f, 0x2a3550, 0x1f1f1f][k % 3],
      female, hairStyle: female ? 'ponytail' : (['short', 'cap', 'short'] as const)[k % 3], build: female ? 0.85 : 0.1, shortSleeves: k % 2 === 0,
    });
    const npc = (o: Outfit, x: number, z: number, yaw: number, sit: boolean) => {
      this.crowd.setOutfit(this.npcs.length, o);
      this.npcs.push({ x, z, yaw, sit, t0: Math.random() * 20 });
    };
    npc(person(0), laneX(1), FOUL + 2.2, Math.PI, false);
    npc(person(1, true), laneX(2) + 0.4, FOUL + 4.6, Math.PI + 0.3, false);
    npc(person(2), laneX(3), FOUL + 2.6, Math.PI, false);
    npc(person(3, true), 6.5 + 0.8, 8.2, -Math.PI / 2, true);
    npc(person(4), 9 - 0.8, 8.1, Math.PI / 2, true);
    npc(person(5), 6.5, 11.5 + 0.8, Math.PI, true);
    npc(person(6, true), -4 + 0.8, 14.5, -Math.PI / 2, true);
    npc(person(7), 7.6, Z1 - 1.2, Math.PI, false);
    this.crowd.count = this.npcs.length;

    this.group.position.copy(ORIGIN);
    for (const [x, y, z, hx, hy, hz] of colliders) world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(ORIGIN.x + x, ORIGIN.y + y, ORIGIN.z + z).setFriction(0.3));

    this.board.id = 'bowling';
    this.board.hidden = true;
    document.body.append(this.board);
  }

  /** Moving objects (ball and pins) in world coordinates; add to the scene. */
  readonly world: THREE.Group;

  private pinSpots(x: number): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (let r = 0; r < 4; r++) for (let k = 0; k <= r; k++) out.push(new THREE.Vector3(x + (k - r / 2) * 0.305, LANE_TOP + PIN_H / 2 + 0.001, PIN_Z - r * 0.264));
    return out;
  }

  private ballStart(): THREE.Vector3 {
    return ORIGIN.clone().add(new THREE.Vector3(laneX(PLAY) + this.offset, LANE_TOP + BALL_R + 0.02, FOUL - 0.3));
  }

  near(p: THREE.Vector3, spot: THREE.Vector3, r: number): boolean {
    return Math.hypot(p.x - spot.x, p.z - spot.z) < r && Math.abs(p.y - spot.y) < 3;
  }

  get active() {
    return this.phase !== 'idle';
  }

  /** Starts a new game (the player has paid). */
  begin() {
    this.rolls = [];
    this.frame = 0;
    this.ballInFrame = 0;
    this.offset = 0;
    this.angle = 0;
    this.resetPins(true);
    this.phase = 'aim';
    this.power = 0.15;
    this.board.hidden = false;
    this.drawScreen(Math.floor(PLAY / 2));
    this.renderBoard();
  }

  quit() {
    this.phase = 'idle';
    setTimeout(() => this.drawScreen(Math.floor(PLAY / 2)), 0);
    this.board.hidden = true;
    this.ball.body.setEnabled(false);
    this.ball.mesh.visible = false;
    this.resetPins(true);
  }

  private resetPins(all: boolean) {
    for (const p of this.pins) {
      if (all) p.gone = false;
      if (p.gone) continue;
      p.down = false;
      p.body.setEnabled(true);
      p.body.setTranslation(p.home, true);
      p.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      p.body.sleep();
    }
    for (const p of this.pins) if (p.gone) {
      p.body.setEnabled(false);
      p.mesh.visible = false;
    } else p.mesh.visible = true;
    this.syncMeshes();
  }

  /** Controls while playing: A/D (or arrows) move, Q/E aim, hold Space to charge and release to throw. */
  update(dt: number, keys: { left: boolean; right: boolean; aimL: boolean; aimR: boolean; throwHeld: boolean }) {
    this.time += dt;
    this.animateNpcs();
    if (this.phase === 'idle') return;
    this.phaseT += dt;
    if (this.phase === 'aim') {
      const mv = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      this.offset = THREE.MathUtils.clamp(this.offset + mv * dt * 0.8, -0.45, 0.45);
      const am = (keys.aimR ? 1 : 0) - (keys.aimL ? 1 : 0);
      this.angle = THREE.MathUtils.clamp(this.angle + am * dt * 0.05, -0.05, 0.05);
      if (keys.throwHeld) {
        this.charging = true;
        this.power += this.powerDir * dt * 0.9;
        if (this.power > 1) { this.power = 1; this.powerDir = -1; }
        if (this.power < 0.15) { this.power = 0.15; this.powerDir = 1; }
      } else if (this.charging) {
        this.charging = false;
        this.phase = 'swing';
        this.phaseT = 0;
        this.onThrow?.();
      }
      this.renderBoard();
    } else if (this.phase === 'swing' && this.phaseT > 0.75) {
      // Release: the ball leaves the hand at the foul line.
      const b = this.ball.body, s = this.ballStart();
      const speed = 5.5 + this.power * 4.5;
      b.setEnabled(true);
      b.setTranslation(s, true);
      b.setLinvel({ x: Math.sin(this.angle) * speed, y: 0, z: -Math.cos(this.angle) * speed }, true);
      b.setAngvel({ x: -speed / BALL_R, y: 0, z: 0 }, true);
      this.ball.mesh.visible = true;
      for (const p of this.pins) if (!p.gone) p.body.wakeUp();
      this.phase = 'roll';
      this.phaseT = 0;
    } else if (this.phase === 'roll') {
      const t = this.ball.body.translation();
      if (t.z < ORIGIN.z + PIN_Z - 1.6 || t.y < ORIGIN.y - 0.3 || this.phaseT > 7) {
        this.phase = 'settle';
        this.phaseT = 0;
      }
    } else if (this.phase === 'settle' && this.phaseT > 2.2) {
      this.scoreRoll();
    } else if (this.phase === 'over' && this.phaseT > 6) {
      this.quit();
    }
    this.syncMeshes();
  }

  private scoreRoll() {
    let down = 0;
    for (const p of this.pins) {
      if (p.gone) continue;
      const t = p.body.translation(), r = p.body.rotation();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
      const moved = Math.hypot(t.x - p.home.x, t.z - p.home.z);
      if (up.y < 0.8 || t.y < p.home.y - 0.08 || moved > 0.6) {
        p.gone = true;
        down++;
      }
    }
    this.rolls.push(down);
    const standing = this.pins.filter((p) => !p.gone).length;
    const strike = this.ballInFrame === 0 && down === 10 || (this.frame === 9 && down === this.standingBefore && this.standingBefore === 10);
    const spare = !strike && standing === 0;
    this.onPins?.(down, strike, spare);
    this.ball.body.setEnabled(false);
    this.ball.mesh.visible = false;
    // Next ball / frame.
    let newRack = false;
    if (this.frame < 9) {
      if (standing === 0 || this.ballInFrame === 1) {
        this.frame++;
        this.ballInFrame = 0;
        newRack = true;
      } else this.ballInFrame++;
    } else {
      const r = this.rolls.slice(this.rolls.length - this.ballInFrame - 1);
      this.ballInFrame++;
      const bonus = r[0] === 10 || r[0] + (r[1] ?? 0) === 10;
      if (this.ballInFrame >= 3 || (this.ballInFrame === 2 && !bonus)) {
        this.phase = 'over';
        this.phaseT = 0;
        const total = scoreFrames(this.rolls).totals[9] ?? 0;
        this.onMessage?.(`Konec hry: ${total} bodů`);
        this.renderBoard();
        this.drawScreen(Math.floor(PLAY / 2));
        return;
      }
      if (standing === 0) newRack = true;
    }
    this.resetPins(newRack);
    this.standingBefore = this.pins.filter((p) => !p.gone).length;
    this.phase = 'aim';
    this.phaseT = 0;
    this.power = 0.15;
    this.renderBoard();
    this.drawScreen(Math.floor(PLAY / 2));
  }

  private syncMeshes() {
    const sync = (b: RAPIER.RigidBody, m: THREE.Object3D) => {
      const t = b.translation(), r = b.rotation();
      m.position.set(t.x, t.y, t.z);
      m.quaternion.set(r.x, r.y, r.z, r.w);
    };
    for (const p of this.pins) if (!p.gone) sync(p.body, p.mesh);
    if (this.ball.mesh.visible) sync(this.ball.body, this.ball.mesh);
  }

  private animateNpcs() {
    const root = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    this.npcs.forEach((n, i) => {
      if (n.sit) sitPose(this.pose, this.time + n.t0);
      else idlePose(this.pose, this.time + n.t0);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), n.yaw);
      root.compose(pos.set(n.x, 0, n.z), q, one);
      this.crowd.setPose(i, root, this.pose);
    });
    this.crowd.commit();
  }

  /** Where the player stands and the camera looks while playing. */
  playerSpot(): { pos: THREE.Vector3; yaw: number } {
    return { pos: ORIGIN.clone().add(new THREE.Vector3(laneX(PLAY) + this.offset + 0.18, 0.06, FOUL + 0.9)), yaw: Math.PI };
  }

  /** Camera: behind the bowler while aiming, following the ball down the lane. */
  placeCamera(cam: THREE.PerspectiveCamera) {
    const lx = ORIGIN.x + laneX(PLAY);
    if (this.phase === 'roll' || this.phase === 'settle') {
      const t = this.ball.body.translation();
      const z = this.phase === 'roll' ? Math.max(t.z + 3.2, ORIGIN.z + PIN_Z + 2.6) : ORIGIN.z + PIN_Z + 2.6;
      cam.position.set(lx, ORIGIN.y + 1.1, z);
      cam.lookAt(lx, ORIGIN.y + 0.2, ORIGIN.z + PIN_Z - 0.4);
    } else {
      cam.position.set(lx + this.offset * 0.5, ORIGIN.y + 2.1, ORIGIN.z + FOUL + 4.2);
      cam.lookAt(lx + this.offset + Math.sin(this.angle) * 18, ORIGIN.y + 0.2, ORIGIN.z + PIN_Z);
    }
  }

  private renderBoard() {
    const { marks, totals } = scoreFrames(this.rolls);
    const cells = marks.map((m, f) => `<td class="${f === this.frame && this.phase !== 'over' ? 'cur' : ''}"><div class="m">${(f === 9 ? [0, 1, 2] : [0, 1]).map((k) => `<span>${m[k] ?? ''}</span>`).join('')}</div><b>${totals[f] ?? ''}</b></td>`).join('');
    const aiming = this.phase === 'aim';
    this.board.innerHTML = `<div class="head"><b>BOWLING BLANSKO</b><span>Dráha ${PLAY + 1}</span></div>
      <table><tr>${Array.from({ length: 10 }, (_, f) => `<th>${f + 1}</th>`).join('')}</tr><tr>${cells}</tr></table>
      ${aiming ? `<div class="power"><span>Síla</span><i><u style="width:${Math.round(this.power * 100)}%"></u></i></div>
      <p class="keys">A/D posun · Q/E míření · drž mezerník a pusť = hod · F konec</p>` : this.phase === 'over' ? `<p class="keys">Konec hry – ${totals[9] ?? 0} bodů</p>` : ''}`;
  }

  /** The monitor over a pair of lanes: our score on the playable lane, a demo elsewhere. */
  private drawScreen(k: number) {
    const s = this.screens[k];
    if (!s) return;
    const g = s.ctx;
    g.fillStyle = '#0a1a3a';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = '#ff9a3a';
    g.font = 'bold 30px system-ui, sans-serif';
    g.fillText(`DRÁHA ${k * 2 + 1} / ${k * 2 + 2}`, 20, 40);
    const mine = k === Math.floor(PLAY / 2);
    const { totals } = scoreFrames(mine ? this.rolls : [9, 1, 7, 2, 10, 8, 1, 6, 3, 9, 0]);
    g.fillStyle = '#fff';
    g.font = '22px system-ui, sans-serif';
    totals.forEach((t, f) => {
      g.strokeStyle = '#4a6aa8';
      g.strokeRect(10 + f * 49, 70, 47, 70);
      g.fillText(String(f + 1), 26 + f * 49, 95);
      if (t !== null) g.fillText(String(t), 14 + f * 49, 130);
    });
    g.font = 'bold 34px system-ui, sans-serif';
    g.fillStyle = '#ffd24a';
    g.fillText(mine ? (this.active ? 'HRAJEŠ' : 'VOLNO – F u dráhy') : 'OBSAZENO', 20, 210);
    s.tex.needsUpdate = true;
  }
}
