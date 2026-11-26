// Pedestrians walking the footpath graph (sidewalks beside streets, footways, squares).
// Rendered as instanced body parts with a simple walk cycle; they dodge a fast car
// and get knocked over (then stand up again) if hit.
import * as THREE from 'three';
import type { HeightField } from '../world/HeightField.ts';
import { Graph, type Lane } from './Graph.ts';
import { HumanCrowd, walkPose, limpPose, restPose, type Outfit, type HairStyle } from '../character/HumanRig.ts';

const MAX_PEDS = 24;
const SPAWN_MIN = 35, SPAWN_MAX = 170, DESPAWN = 210;
const SIDEWALK = new Set(['residential', 'unclassified', 'tertiary', 'secondary']);
const ROAD_HALF_WIDTH: Record<string, number> = { residential: 3, unclassified: 3, tertiary: 3.5, secondary: 4.25 };

const TOPS = [0x8a2f2f, 0x2f5a8a, 0x3f6f3a, 0xc9a23a, 0x5a4a6a, 0xd8d4c8, 0x2b2b2b, 0xb86a3a, 0x6a8fa8, 0xe7e2d6, 0x9b2d5a, 0x2c6b6b, 0x7a7f86];
const LEGS = [0x2e3442, 0x3a3a3a, 0x4a5a7a, 0x6b5a45, 0x1e1e22, 0x8a8478, 0x34465e, 0xb9ad94];
const SKINS = [0xf1d0b5, 0xe8c0a0, 0xd6a684, 0xb88466, 0x8d5f45, 0x6b4430];
const HAIRS = [0x1d1612, 0x3a2a1e, 0x5a3c22, 0x8a6236, 0xc9a66b, 0x9a9690, 0x6e2a1a];
const SHOES = [0x1f1f1f, 0xe8e6e0, 0x5a3a24, 0x2a3550, 0x8a1f1f];

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** A random townsperson: clothes, hair, build, height. */
export function randomOutfit(): Outfit {
  const slim = Math.random() < 0.5;
  const style: HairStyle = slim ? pick(['long', 'long', 'bun', 'ponytail', 'short']) : pick(['short', 'short', 'short', 'cap', 'bald']);
  const summer = Math.random() < 0.3;
  return {
    skin: pick(SKINS), hair: pick(HAIRS), top: pick(TOPS), legs: pick(LEGS), shoes: pick(SHOES),
    female: slim, hairStyle: style, build: slim ? 0.75 + Math.random() * 0.25 : Math.random() * 0.25,
    height: (slim ? 0.94 : 0.99) + Math.random() * 0.08, shortSleeves: summer || Math.random() < 0.15, shorts: summer && Math.random() < 0.6,
  };
}

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
  outfit: Outfit;
  fresh: boolean;
  /** Seconds left running away in panic (after gunshots). */
  panic: number;
  hp: number;
  /** Killed: lies on the ground until removed (no blood). */
  dead: boolean;
}

const tmp = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };

export class Pedestrians {
  readonly graph: Graph;
  readonly group = new THREE.Group();
  readonly peds: Ped[] = [];
  enabled = true;
  /** Called when the player's car knocks someone over. */
  onHit?: () => void;
  /** Called when someone dies (they drop money). */
  onKilled?: (pos: THREE.Vector3) => void;
  /** Population limit (lower on phones); at most MAX_PEDS. */
  maxPeds = MAX_PEDS;
  private spawnTimer = 0;
  private crowd = new HumanCrowd(MAX_PEDS);
  private pose = restPose();
  private time = 0;
  private slots: (Ped | null)[] = new Array(MAX_PEDS).fill(null);

  constructor(graph: Graph, private heights: HeightField) {
    this.graph = graph;
    this.group.add(this.crowd.group);
  }

  private offsetFor(p: Ped): number {
    const e = this.graph.edges[p.lane.edge];
    const base = SIDEWALK.has(e.kind) ? (ROAD_HALF_WIDTH[e.kind] ?? 3) + 1.1 : 0.35;
    return p.side * (base + p.sideways);
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
      this.peds.push({
        lane: Math.random() < 0.5 ? lane : { edge: ei, dir: -1 }, s, speed: 1.1 + Math.random() * 0.6,
        side: Math.random() < 0.5 ? -1 : 1, sideways: 0, phase: Math.random() * 10,
        pos: new THREE.Vector3(), yaw: 0, down: 0, fall: new THREE.Vector3(),
        outfit: randomOutfit(), fresh: true, panic: 0, hp: 50, dead: false,
      });
      return;
    }
  }

  /** Removes all pedestrians (used to recover from errors); new ones spawn gradually. */
  reset() {
    this.peds.length = 0;
  }

  /** Gunshot damage; at zero health the pedestrian dies. */
  damage(p: Ped, amount: number, dir: THREE.Vector3) {
    if (p.dead) return;
    p.hp -= amount;
    if (p.hp <= 0) this.kill(p, dir);
    else p.panic = 10;
  }

  kill(p: Ped, dir: THREE.Vector3) {
    if (p.dead) return;
    p.dead = true;
    p.down = 30;
    p.fall.copy(dir).setY(0).normalize().multiplyScalar(1.5);
    this.panicAround(p.pos, 30);
    this.onKilled?.(p.pos.clone());
  }

  /** Knocks a pedestrian over (shot or hit) and makes people around them run. */
  knockDown(p: Ped, dir: THREE.Vector3) {
    if (p.down > 0) return;
    p.down = 6;
    p.fall.copy(dir).setY(0).normalize().multiplyScalar(1.5);
    this.panicAround(p.pos, 30);
  }

  /** Everyone within `radius` runs away for a while. */
  panicAround(pos: THREE.Vector3, radius: number) {
    for (const o of this.peds) if (o.pos.distanceTo(pos) < radius) o.panic = 8 + Math.random() * 4;
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
      this.spawn(focus, SPAWN_MIN);
      this.spawnTimer = 0.7;
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
        if (p.down <= 0) {
          if (p.dead) p.speed = -1; // marked for removal below
          else p.fresh = true; // stand up where the walk graph says
        }
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
          this.onHit?.();
          if (Math.abs(playerCar.speed) > 13) this.kill(p, carFwd);
          p.fall.copy(carFwd).multiplyScalar(playerCar.speed * 0.5);
          continue;
        }
        if (along > 0 && along < 14 && lateral < 2.5) {
          // Step back from the kerb (away from the road), never towards the car's path.
          p.sideways += p.side * 3 * dt;
          p.sideways = THREE.MathUtils.clamp(p.sideways, -0.2, 1.2);
        }
      }
      p.sideways *= Math.exp(-dt * 0.5);

      p.panic = Math.max(0, p.panic - dt);
      const speed = p.panic > 0 ? 4.2 : p.speed;
      p.s += speed * dt;
      const len = g.length(p.lane.edge);
      if (p.s >= len) {
        const opts = g.next(p.lane);
        p.lane = opts[Math.floor(Math.random() * opts.length)];
        p.s -= len;
        if (p.panic <= 0 && Math.random() < 0.05) p.side = -p.side; // occasionally cross to the other sidewalk (never while fleeing)
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
      p.phase += (p.panic > 0 ? 4.2 : p.speed) * dt * Math.PI * 1.1;
    }
    for (let i = this.peds.length - 1; i >= 0; i--) if (this.peds[i].speed < 0) this.peds.splice(i, 1);
    this.render();
  }

  private render() {
    const root = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
    this.time += 1 / 60;
    // The crowd mesh draws instances 0..n-1: keep each ped in its slot, rewriting the clothes
    // only when the slot changes hands.
    this.peds.forEach((p, i) => {
      if (this.slots[i] !== p) {
        this.slots[i] = p;
        this.crowd.setOutfit(i, p.outfit);
      }
      const lying = p.down > 0 || p.dead;
      // Lying peds are rotated 90° backwards around the feet, limbs loose.
      e.set(lying ? -Math.PI / 2 : 0, p.yaw, 0, 'YXZ');
      q.setFromEuler(e);
      root.compose(lying ? p.pos.clone().add(new THREE.Vector3(0, 0.12, 0)) : p.pos, q, one);
      if (lying) limpPose(this.pose);
      else walkPose(this.pose, p.phase, p.panic > 0 ? 4.6 : p.speed, this.time + i * 7.3);
      this.crowd.setPose(i, root, this.pose);
    });
    for (let i = this.peds.length; i < MAX_PEDS; i++) this.slots[i] = null;
    this.crowd.count = this.peds.length;
    this.crowd.commit();
  }
}
