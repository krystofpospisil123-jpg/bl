// Police: a wanted level (0-5 stars) raised by crimes, police cars that patrol, chase the
// player along the road graph and ram or box them in, and an arrest when they catch you.
// Police cars are kinematic bodies like the AI traffic, so ramming pushes the player's car.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { HeightField } from '../world/HeightField.ts';
import { Graph, type Lane } from '../traffic/Graph.ts';
import { assets, useCarAttributes } from '../assets/models.ts';
import { CAR_SPEC } from '../vehicle/CarPhysics.ts';

const RIDE_HEIGHT = 0.74;
const SPAWN_MIN = 90, SPAWN_MAX = 170, DESPAWN = 420;
/** How far police can see the player. */
const SIGHT = 60;
/** Chase speed (m/s) per wanted level. */
const CHASE_SPEED = [0, 15, 17, 20, 23, 26];

type UnitMode = 'patrol' | 'chase' | 'leave' | 'wreck';

interface Unit {
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  body: RAPIER.RigidBody;
  mesh: THREE.Group;
  lane: Lane;
  s: number;
  path: Lane[];
  repath: number;
  mode: UnitMode;
  /** Driving straight at the player instead of following the roads. */
  direct: boolean;
  stuck: number;
  hitCooldown: number;
  hp: number;
}

export interface PoliceTarget {
  position: THREE.Vector3;
  speed: number;
  /** Driving (police chase faster and ram) or on foot. */
  inCar: boolean;
}

const tmp = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };

export class Police {
  readonly group = new THREE.Group();
  readonly units: Unit[] = [];
  enabled = true;
  /** Wanted level shown as stars. */
  wanted = 0;
  /** Whether a police car currently sees the player. */
  seen = false;
  /** Seconds the police have been close to a stopped player (arrest at ARREST_TIME). */
  arrest = 0;
  readonly arrestTime = 4;
  onBusted?: () => void;
  onWanted?: (level: number, reason: string) => void;
  /** Materials to compile during the loading screen (avoids a stutter at the first police car). */
  get warmMaterials(): THREE.Material[] {
    return [this.beaconOn, this.beaconOff, this.bodyMat, this.burnt];
  }
  private heat = 0;
  private lostFor = 0;
  private spawnTimer = 0;
  private flash = 0;
  private beaconOn: THREE.MeshStandardMaterial;
  private beaconOff: THREE.MeshStandardMaterial;
  private bodyMat = useCarAttributes(new THREE.MeshStandardMaterial({ metalness: 0.3 }));

  constructor(readonly graph: Graph, private phys: PhysicsWorld, private heights: HeightField) {
    this.beaconOn = new THREE.MeshStandardMaterial({ color: 0x6f95ff, emissive: 0x2a5cff, emissiveIntensity: 3, roughness: 0.2 });
    this.beaconOff = new THREE.MeshStandardMaterial({ color: 0x1b2d66, emissive: 0x0a1433, roughness: 0.2 });
  }

  /** A crime: raises the wanted level (pedestrian 1, police car 1, ramming traffic 0.5…). */
  report(amount: number, reason: string) {
    if (!this.enabled) return;
    const before = this.wanted;
    this.heat = Math.min(5, this.heat + amount);
    this.wanted = Math.max(this.wanted, Math.min(5, Math.floor(this.heat + 1e-6)));
    this.lostFor = 0;
    if (this.wanted > before) this.onWanted?.(this.wanted, reason);
  }

  /** Clears the wanted level and sends all police cars away (after an arrest or a reset). */
  clear() {
    this.wanted = 0;
    this.heat = 0;
    this.arrest = 0;
    this.lostFor = 0;
    while (this.units.length) this.remove(this.units[0]);
  }

  /** Called when a police car is shot to pieces (explosion and fire). */
  onWrecked?: (pos: THREE.Vector3) => void;
  private burnt = new THREE.MeshStandardMaterial({ color: 0x1d1c1b, roughness: 0.9 });

  /** Gunfire on a police car: an attack on the police; enough hits wreck the car. */
  damage(u: Unit, amount: number) {
    if (u.mode === 'wreck') return;
    if (u.hitCooldown === 0) {
      this.report(1, 'shooting at the police');
      u.hitCooldown = 6;
    }
    u.hp -= amount;
    if (u.hp > 0) return;
    u.mode = 'wreck';
    u.speed = 0;
    u.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = this.burnt;
    });
    this.report(1, 'destroyed a police car');
    this.onWrecked?.(u.pos);
  }

  /** Positions of police cars with sirens on (for the sound). */
  sirens(): THREE.Vector3[] {
    return this.units.filter((u) => u.mode === 'chase').map((u) => u.pos);
  }

  update(dt: number, target: PoliceTarget) {
    if (!this.enabled) {
      this.clear();
      return;
    }
    const tp = target.position;
    // --- Population: one patrol car without a wanted level, more police the higher it is.
    const want = this.wanted === 0 ? 1 : Math.min(3, Math.ceil(this.wanted * 0.6));
    for (const u of [...this.units]) {
      // A chasing car that ended up far away (one-way streets) is replaced by a closer one.
      if (u.pos.distanceTo(tp) > DESPAWN || (u.mode === 'chase' && u.pos.distanceTo(tp) > 220)) this.remove(u);
    }
    const active = this.units.filter((u) => u.mode !== 'leave' && u.mode !== 'wreck');
    this.spawnTimer -= dt;
    if (active.length < want && this.spawnTimer <= 0) {
      this.spawn(tp);
      this.spawnTimer = this.wanted ? 6 : 12;
    }
    for (const u of active) u.mode = this.wanted > 0 ? 'chase' : 'patrol';
    if (this.wanted === 0) {
      // Extra cars from a finished chase drive off.
      active.slice(1).forEach((u) => (u.mode = 'leave'));
    }

    // --- Seeing the player, losing them, arrest.
    this.seen = this.units.some((u) => u.mode === 'chase' && u.pos.distanceTo(tp) < SIGHT);
    if (this.wanted > 0) {
      this.lostFor = this.seen ? 0 : this.lostFor + dt;
      if (this.lostFor > 6 + this.wanted * 3) {
        this.wanted--;
        this.heat = this.wanted;
        this.lostFor = 0;
        this.onWanted?.(this.wanted, 'lost');
      }
      const close = this.units.some((u) => u.mode === 'chase' && u.pos.distanceTo(tp) < 6.5);
      this.arrest = close && Math.abs(target.speed) < 2 ? this.arrest + dt : Math.max(0, this.arrest - dt * 2);
      if (this.arrest > this.arrestTime) {
        this.clear();
        this.onBusted?.();
        return;
      }
    }

    for (const u of this.units) {
      u.hitCooldown = Math.max(0, u.hitCooldown - dt);
      if (u.mode === 'wreck') continue;
      const d = u.pos.distanceTo(tp);
      // Speeding past a patrol car, or ramming a police car, is a crime.
      if (target.inCar && u.hitCooldown === 0) {
        if (d < 4.6 && Math.abs(target.speed) > 5) {
          this.report(1, 'ramming the police');
          u.hitCooldown = 3;
        } else if (this.wanted === 0 && d < 25 && Math.abs(target.speed) > 28) {
          this.report(1, 'speeding');
          u.hitCooldown = 3;
        }
      }
      this.drive(u, dt, target);
    }

    // --- Flashing light bars: left and right alternate.
    this.flash += dt;
    const phase = Math.floor(this.flash * 6) % 4;
    for (const u of this.units) {
      if (u.mode === 'wreck') continue;
      const [l, r] = u.mesh.userData.beacons as [THREE.Mesh, THREE.Mesh];
      const on = u.mode === 'chase';
      l.material = on && (phase === 0 || phase === 2) ? this.beaconOn : this.beaconOff;
      r.material = on && (phase === 1 || phase === 3) ? this.beaconOn : this.beaconOff;
    }
  }

  private drive(u: Unit, dt: number, target: PoliceTarget) {
    const g = this.graph;
    const tp = target.position;
    const d = Math.hypot(tp.x - u.pos.x, tp.z - u.pos.z);
    const terrain = this.heights.sample(tp.x, tp.z);
    const playerOnGround = tp.y < terrain + 3;
    let maxSpeed = u.mode === 'chase' ? CHASE_SPEED[this.wanted] : g.edges[u.lane.edge].speed * 0.85;

    if (u.mode === 'chase' && d < 32 && playerOnGround) {
      // Close: leave the road graph and head straight for the player (ram them in a car).
      u.direct = true;
      const want = Math.atan2(tp.x - u.pos.x, tp.z - u.pos.z);
      let dy = want - u.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const turn = 1.6 * dt * Math.min(1, Math.abs(u.speed) / 4 + 0.3);
      u.yaw += THREE.MathUtils.clamp(dy, -turn, turn);
      const stopAt = target.inCar ? 3 : 5; // they pull up next to you rather than ram at full speed
      // Braking curve: on foot they stop beside you, in a car they keep pushing.
      const room = Math.max(0, d - stopAt - 1);
      const desired = Math.min(maxSpeed, Math.sqrt(2 * 9 * room) + (target.inCar ? 2 : 0)) * (Math.abs(dy) > 1.2 ? 0.4 : 1);
      u.speed += THREE.MathUtils.clamp(desired - u.speed, -14 * dt, 7 * dt);
      u.pos.x += Math.sin(u.yaw) * u.speed * dt;
      u.pos.z += Math.cos(u.yaw) * u.speed * dt;
      u.pos.y = this.heights.sample(u.pos.x, u.pos.z) + RIDE_HEIGHT;
      u.repath = 0;
    } else {
      if (u.direct) {
        // Back onto the roads: plan from the nearest node.
        u.direct = false;
        const n = this.nearestNode(u.pos.x, u.pos.z);
        const out = g.out[n];
        if (out.length) {
          u.lane = out[0];
          u.s = 0;
        }
        u.path = [];
      }
      u.repath -= dt;
      if (u.path.length === 0 || u.repath <= 0) {
        u.repath = u.mode === 'chase' ? 1.5 : 30;
        const goal = u.mode === 'chase' ? this.nearestNode(tp.x, tp.z) : u.mode === 'leave' ? this.farNode(tp) : this.randomNode(u.pos);
        u.path = this.route(g.endNode(u.lane), goal);
      }
      const len = g.length(u.lane.edge);
      const toEnd = len - u.s;
      if (toEnd < 18 && u.path.length) {
        g.sample(u.lane, len - 1, tmp);
        const hx = tmp.dx, hz = tmp.dz;
        g.sample(u.path[0], 4, tmp);
        const turnAmt = 1 - (hx * tmp.dx + hz * tmp.dz);
        maxSpeed = Math.min(maxSpeed, Math.max(7, maxSpeed * (1 - turnAmt * 0.55)));
      }
      u.speed += THREE.MathUtils.clamp(maxSpeed - u.speed, -10 * dt, 6 * dt);
      u.s += u.speed * dt;
      while (u.s >= g.length(u.lane.edge)) {
        u.s -= g.length(u.lane.edge);
        u.lane = u.path.shift() ?? g.next(u.lane)[0];
      }
      g.sample(u.lane, u.s, tmp);
      const off = u.mode === 'chase' ? 0.4 : 1.6;
      const px = tmp.x - tmp.dz * off, pz = tmp.z + tmp.dx * off;
      const ground = this.heights.sample(px, pz);
      const y = (tmp.y > ground + 1.5 ? tmp.y : ground) + RIDE_HEIGHT;
      const k = 1 - Math.exp(-dt * 10);
      u.pos.lerp(new THREE.Vector3(px, y, pz), k);
      let dy = Math.atan2(tmp.dx, tmp.dz) - u.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      u.yaw += dy * (1 - Math.exp(-dt * 8));
    }
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), u.yaw);
    u.body.setNextKinematicTranslation(u.pos);
    u.body.setNextKinematicRotation(q);
    u.mesh.position.copy(u.pos);
    u.mesh.quaternion.copy(q);
  }

  /** A* over the drive graph; returns the lanes to follow after `from`. */
  private route(from: number, to: number): Lane[] {
    const g = this.graph;
    if (from === to) return [];
    const [tx, , tz] = g.nodePos(to);
    const h = (n: number) => {
      const [x, , z] = g.nodePos(n);
      return Math.hypot(x - tx, z - tz);
    };
    const cost = new Map<number, number>([[from, 0]]);
    const came = new Map<number, Lane>();
    const open: [number, number][] = [[h(from), from]];
    let steps = 0;
    while (open.length && steps++ < 4000) {
      // Small graphs: a linear scan for the best open node is fast enough.
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, n] = open.splice(bi, 1)[0];
      if (n === to) break;
      for (const l of g.out[n]) {
        const m = g.endNode(l);
        const c = cost.get(n)! + g.length(l.edge);
        if (c < (cost.get(m) ?? Infinity)) {
          cost.set(m, c);
          came.set(m, l);
          open.push([c + h(m), m]);
        }
      }
    }
    if (!came.has(to)) return [];
    const path: Lane[] = [];
    for (let n = to; n !== from; ) {
      const l = came.get(n)!;
      path.unshift(l);
      n = g.startNode(l);
      if (path.length > 2000) break;
    }
    return path;
  }

  private nearestNode(x: number, z: number): number {
    const nodes = this.graph.nodes;
    let best = 0, bd = Infinity;
    for (let i = 0; i < nodes.length / 3; i++) {
      if (!this.graph.out[i].length) continue;
      const d = (nodes[i * 3] - x) ** 2 + (nodes[i * 3 + 2] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  private randomNode(near: THREE.Vector3): number {
    const a = Math.random() * Math.PI * 2, r = 150 + Math.random() * 200;
    return this.nearestNode(near.x + Math.cos(a) * r, near.z + Math.sin(a) * r);
  }

  private farNode(from: THREE.Vector3): number {
    const a = Math.random() * Math.PI * 2;
    return this.nearestNode(from.x + Math.cos(a) * 600, from.z + Math.sin(a) * 600);
  }

  private spawn(focus: THREE.Vector3) {
    const g = this.graph;
    for (let attempt = 0; attempt < 300; attempt++) {
      const ei = Math.floor(Math.random() * g.edges.length);
      const e = g.edges[ei];
      if (e.kind === 'service' || e.kind === 'track') continue;
      const lanes = g.out[e.a].concat(g.out[e.b]).filter((l) => l.edge === ei);
      if (!lanes.length) continue;
      const lane = lanes[Math.floor(Math.random() * lanes.length)];
      const s = Math.random() * g.length(ei);
      g.sample(lane, s, tmp);
      const d = Math.hypot(tmp.x - focus.x, tmp.z - focus.z);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      const pos = new THREE.Vector3(tmp.x, this.heights.sample(tmp.x, tmp.z) + RIDE_HEIGHT, tmp.z);
      const body = this.phys.world.createRigidBody(this.phys.R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z));
      const he = CAR_SPEC.halfExtents;
      this.phys.world.createCollider(this.phys.R.ColliderDesc.cuboid(he.x, he.y, he.z).setTranslation(0, 0.1, 0), body);
      const mesh = this.makeMesh();
      this.group.add(mesh);
      this.units.push({
        pos, yaw: Math.atan2(tmp.dx, tmp.dz), speed: 8, body, mesh, lane, s, path: [], repath: 0,
        mode: this.wanted ? 'chase' : 'patrol', direct: false, stuck: 0, hitCooldown: 2, hp: 160,
      });
      return;
    }
  }

  private remove(u: Unit) {
    this.phys.world.removeRigidBody(u.body);
    this.group.remove(u.mesh);
    u.mesh.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    this.units.splice(this.units.indexOf(u), 1);
  }

  private makeMesh(): THREE.Group {
    const g = new THREE.Group();
    const a = assets.police;
    if (!a) {
      // Fallback without the Blender model: a white box with a blue roof light.
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 4.4).translate(0, -0.1, 0), new THREE.MeshStandardMaterial({ color: 0xf2f2f0 }));
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.25).translate(0.3, 0.45, 0), this.beaconOff);
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.25).translate(-0.3, 0.45, 0), this.beaconOff);
      g.add(body, l, r);
      g.userData.beacons = [l, r];
      return g;
    }
    const body = new THREE.InstancedMesh(a.body, this.bodyMat, 1);
    body.setMatrixAt(0, new THREE.Matrix4());
    body.setColorAt(0, new THREE.Color(1, 1, 1));
    body.computeBoundingSphere();
    body.castShadow = true;
    const tail = new THREE.InstancedMesh(a.tail, this.bodyMat, 1);
    tail.setMatrixAt(0, new THREE.Matrix4());
    tail.setColorAt(0, new THREE.Color(1, 1, 1));
    tail.computeBoundingSphere();
    const l = new THREE.Mesh(a.beaconL, this.beaconOff);
    const r = new THREE.Mesh(a.beaconR, this.beaconOff);
    g.add(body, tail, l, r);
    for (const p of a.wheelPos) {
      const w = new THREE.Mesh(a.wheel, this.bodyMat);
      w.position.copy(p);
      if (p.x < 0) w.rotation.y = Math.PI;
      w.castShadow = true;
      g.add(w);
    }
    g.userData.beacons = [l, r];
    return g;
  }
}
