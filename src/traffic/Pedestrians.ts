// Pedestrians walking the footpath graph (sidewalks beside streets, footways, squares).
// Rendered as instanced body parts with a simple walk cycle; they dodge a fast car
// and get knocked over (then stand up again) if hit.
import * as THREE from 'three';
import type { HeightField } from '../world/HeightField.ts';
import { Graph, type Lane } from './Graph.ts';

const MAX_PEDS = 60;
const SPAWN_MIN = 25, SPAWN_MAX = 200, DESPAWN = 240;
const SIDEWALK = new Set(['residential', 'unclassified', 'tertiary', 'secondary']);
const ROAD_HALF_WIDTH: Record<string, number> = { residential: 3, unclassified: 3, tertiary: 3.5, secondary: 4.25 };

const TOPS = [0x8a2f2f, 0x2f5a8a, 0x3f6f3a, 0xc9a23a, 0x5a4a6a, 0xd8d4c8, 0x2b2b2b, 0xb86a3a, 0x6a8fa8];
const LEGS = [0x2e3442, 0x3a3a3a, 0x4a5a7a, 0x6b5a45, 0x1e1e22, 0x8a8478];
const SKINS = [0xe8c0a0, 0xd6a684, 0xb88466, 0x8d5f45, 0xf0d0b8];

interface Ped {
  lane: Lane;
  s: number;
  speed: number;
  side: number; // -1 / 1: which sidewalk
  sideways: number; // extra lateral offset (dodging)
  phase: number;
  pos: THREE.Vector3;
  yaw: number;
  down: number; // seconds left lying on the ground
  fall: THREE.Vector3;
  top: THREE.Color;
  legs: THREE.Color;
  skin: THREE.Color;
  fresh: boolean;
}

const tmp = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };

function boxAt(w: number, h: number, d: number, x: number, yTop: number, z = 0): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, yTop - h / 2, z).toNonIndexed();
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [];
  for (const g of parts) {
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

export class Pedestrians {
  readonly graph: Graph;
  readonly group = new THREE.Group();
  readonly peds: Ped[] = [];
  enabled = true;
  /** Population limit (lower on phones); at most MAX_PEDS. */
  maxPeds = MAX_PEDS;
  private meshes: Record<'torso' | 'head' | 'armL' | 'armR' | 'legL' | 'legR', THREE.InstancedMesh>;
  private spawnTimer = 0;

  constructor(graph: Graph, private heights: HeightField) {
    this.graph = graph;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    // Limb geometries hang from their joint at the origin.
    const leg = merge([boxAt(0.15, 0.86, 0.17, 0, 0), boxAt(0.15, 0.07, 0.25, 0, -0.86, 0.04)]);
    const arm = merge([boxAt(0.11, 0.62, 0.12, 0, 0)]);
    const torso = merge([boxAt(0.4, 0.58, 0.23, 0, 1.48), boxAt(0.36, 0.12, 0.21, 0, 0.98)]);
    const head = merge([boxAt(0.1, 0.08, 0.1, 0, 1.58), boxAt(0.21, 0.25, 0.22, 0, 1.83), boxAt(0.23, 0.07, 0.24, 0, 1.86)]);
    const make = (g: THREE.BufferGeometry) => {
      const m = new THREE.InstancedMesh(g, mat, MAX_PEDS);
      m.castShadow = true;
      m.frustumCulled = false;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.count = 0;
      this.group.add(m);
      return m;
    };
    this.meshes = { torso: make(torso), head: make(head), armL: make(arm), armR: make(arm), legL: make(leg), legR: make(leg) };
  }

  private offsetFor(p: Ped): number {
    const e = this.graph.edges[p.lane.edge];
    const base = SIDEWALK.has(e.kind) ? (ROAD_HALF_WIDTH[e.kind] ?? 3) + 1.1 : 0.35;
    return p.side * base + p.sideways;
  }

  private spawn(focus: THREE.Vector3, minDist: number) {
    const g = this.graph;
    for (let attempt = 0; attempt < 30; attempt++) {
      const ei = Math.floor(Math.random() * g.edges.length);
      const lanes = g.out[g.edges[ei].a].filter((l) => l.edge === ei);
      if (!lanes.length) continue;
      const lane = lanes[0];
      const s = Math.random() * g.length(ei);
      g.sample(lane, s, tmp);
      const d = Math.hypot(tmp.x - focus.x, tmp.z - focus.z);
      if (d < minDist || d > SPAWN_MAX) continue;
      const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
      this.peds.push({
        lane: Math.random() < 0.5 ? lane : { edge: ei, dir: -1 }, s, speed: 1.1 + Math.random() * 0.6,
        side: Math.random() < 0.5 ? -1 : 1, sideways: 0, phase: Math.random() * 10,
        pos: new THREE.Vector3(), yaw: 0, down: 0, fall: new THREE.Vector3(),
        top: new THREE.Color(pick(TOPS)), legs: new THREE.Color(pick(LEGS)), skin: new THREE.Color(pick(SKINS)), fresh: true,
      });
      return;
    }
  }

  /** Points AI cars should stop for. */
  obstacles(): { x: number; z: number; radius: number }[] {
    return this.peds.map((p) => ({ x: p.pos.x, z: p.pos.z, radius: 0.5 }));
  }

  update(dt: number, focus: THREE.Vector3, playerCar?: { position: THREE.Vector3; yaw: number; speed: number }) {
    if (!this.enabled) this.peds.length = 0;
    for (let i = this.peds.length - 1; i >= 0; i--) if (this.peds[i].pos.distanceTo(focus) > DESPAWN && !this.peds[i].fresh) this.peds.splice(i, 1);
    this.spawnTimer -= dt;
    if (this.enabled && this.peds.length < this.maxPeds && this.spawnTimer <= 0) {
      this.spawn(focus, this.peds.length < this.maxPeds / 2 ? 10 : SPAWN_MIN);
      this.spawnTimer = 0.08;
    }

    const g = this.graph;
    const carFwd = playerCar ? new THREE.Vector3(Math.sin(playerCar.yaw), 0, Math.cos(playerCar.yaw)) : null;
    for (const p of this.peds) {
      if (p.down > 0) {
        p.down -= dt;
        // Slide to a stop after being hit.
        p.pos.addScaledVector(p.fall, dt);
        p.fall.multiplyScalar(Math.exp(-dt * 4));
        p.pos.y = this.heights.sample(p.pos.x, p.pos.z);
        if (p.down <= 0) p.fresh = true; // stand up where the walk graph says
        continue;
      }
      // React to the player's car.
      if (playerCar && carFwd && Math.abs(playerCar.speed) > 2) {
        const rel = p.pos.clone().sub(playerCar.position);
        rel.y = 0;
        const along = rel.dot(carFwd) * Math.sign(playerCar.speed);
        const lateral = rel.clone().addScaledVector(carFwd, -rel.dot(carFwd)).length();
        if (along > -2.2 && along < 2.4 && lateral < 1.2) {
          // Hit: knocked over in the car's direction.
          p.down = 4;
          p.fall.copy(carFwd).multiplyScalar(playerCar.speed * 0.5);
          continue;
        }
        if (along > 0 && along < 14 && lateral < 2.5) {
          // Jump aside, away from the car's path.
          const cross = carFwd.x * rel.z - carFwd.z * rel.x;
          p.sideways += Math.sign(cross || 1) * p.side * 6 * dt;
          p.sideways = THREE.MathUtils.clamp(p.sideways, -4, 4);
        }
      }
      p.sideways *= Math.exp(-dt * 0.5);

      p.s += p.speed * dt;
      const len = g.length(p.lane.edge);
      if (p.s >= len) {
        const opts = g.next(p.lane);
        p.lane = opts[Math.floor(Math.random() * opts.length)];
        p.s -= len;
        if (Math.random() < 0.15) p.side = -p.side; // occasionally cross to the other sidewalk
      }
      g.sample(p.lane, p.s, tmp);
      const off = this.offsetFor(p);
      const x = tmp.x - tmp.dz * off, z = tmp.z + tmp.dx * off;
      const terrain = this.heights.sample(x, z);
      const y = tmp.y > terrain + 1.5 ? tmp.y : terrain;
      const yaw = Math.atan2(tmp.dx, tmp.dz);
      if (p.fresh) {
        p.pos.set(x, y, z);
        p.yaw = yaw;
        p.fresh = false;
      } else {
        const k = 1 - Math.exp(-dt * 6);
        p.pos.lerp(new THREE.Vector3(x, y, z), k);
        let d = yaw - p.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        p.yaw += d * k;
      }
      p.phase += p.speed * dt * Math.PI * 1.1;
    }
    this.render();
  }

  private render() {
    const base = new THREE.Matrix4(), limb = new THREE.Matrix4(), out = new THREE.Matrix4();
    const q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const m = this.meshes;
    this.peds.forEach((p, i) => {
      // Lying peds are rotated 90° forward around the feet.
      q.setFromEuler(new THREE.Euler(p.down > 0 ? Math.PI / 2 : 0, p.yaw, 0, 'YXZ'));
      base.compose(p.pos, q, one);
      const swing = p.down > 0 ? 0 : Math.sin(p.phase) * 0.5;
      const set = (mesh: THREE.InstancedMesh, px: number, py: number, rot: number, color: THREE.Color) => {
        limb.makeRotationX(rot).setPosition(px, py, 0);
        out.multiplyMatrices(base, limb);
        mesh.setMatrixAt(i, out);
        mesh.setColorAt(i, color);
      };
      set(m.legL, 0.1, 0.92, swing, p.legs);
      set(m.legR, -0.1, 0.92, -swing, p.legs);
      set(m.armL, 0.27, 1.44, -swing * 0.8, p.top);
      set(m.armR, -0.27, 1.44, swing * 0.8, p.top);
      set(m.torso, 0, 0, 0, p.top);
      set(m.head, 0, 0, 0, p.skin);
    });
    for (const mesh of Object.values(m)) {
      mesh.count = this.peds.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
