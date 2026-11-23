// AI traffic: cars follow the drive graph on the right-hand lane, keep distance,
// yield at junctions and stop for obstacles. Rendered as two instanced meshes and
// represented in physics by kinematic boxes so the player can crash into them.
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type { HeightField } from '../world/HeightField.ts';
import { Graph, type Lane } from './Graph.ts';
import { bakeCarGeometries, CAR_COLORS } from '../vehicle/CarModel.ts';
import { CAR_SPEC } from '../vehicle/CarPhysics.ts';

const MAX_CARS = 26;
const SPAWN_MIN = 90, SPAWN_MAX = 340, DESPAWN = 420;
const CAR_LEN = CAR_SPEC.halfExtents.z * 2;
const RIDE_HEIGHT = 0.74; // chassis origin above the road surface

/** Something AI cars must not drive into (player, player car, pedestrians). */
export interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

interface AiCar {
  id: number;
  lane: Lane;
  s: number;
  speed: number;
  next?: Lane;
  offset: number;
  color: THREE.Color;
  blockedFor: number;
  stunnedFor: number;
  body: RAPIER.RigidBody;
  // Rendered (smoothed) state
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  fresh: boolean;
}

const tmp = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };

export class Traffic {
  readonly graph: Graph;
  readonly group = new THREE.Group();
  readonly cars: AiCar[] = [];
  enabled = true;
  /** Population limit (lower on phones); at most MAX_CARS. */
  maxCars = MAX_CARS;
  private paintMesh: THREE.InstancedMesh;
  private detailMesh: THREE.InstancedMesh;
  /** Junction reservations: node -> car id. */
  private reserved = new Map<number, number>();
  private nextId = 1;
  private spawnTimer = 0;

  constructor(graph: Graph, private phys: PhysicsWorld, private heights: HeightField) {
    this.graph = graph;
    const { paint, detail } = bakeCarGeometries();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.3 });
    this.paintMesh = new THREE.InstancedMesh(paint, mat, MAX_CARS);
    this.detailMesh = new THREE.InstancedMesh(detail, mat, MAX_CARS);
    for (const m of [this.paintMesh, this.detailMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // instances spread over a large area
      m.setColorAt(0, new THREE.Color(1, 1, 1)); // create the colour buffer before the first render
      m.count = 0;
      this.group.add(m);
    }
  }

  /** Lane-centre offset to the right of the travel direction. */
  private laneOffset(lane: Lane): number {
    const e = this.graph.edges[lane.edge];
    if (e.oneway) return e.lanes > 1 ? 1.6 : 0;
    if (e.kind === 'service' || e.kind === 'living_street') return 1.1;
    return Math.min(1.8, 0.9 + e.lanes * 0.35);
  }

  private pickNext(l: Lane): Lane {
    const opts = this.graph.next(l);
    // Prefer proper streets over service roads.
    const weights = opts.map((o) => (this.graph.edges[o.edge].kind === 'service' ? 0.15 : 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < opts.length; i++) if ((r -= weights[i]) <= 0) return opts[i];
    return opts[opts.length - 1];
  }

  private spawn(focus: THREE.Vector3, minDist: number) {
    const g = this.graph;
    for (let attempt = 0; attempt < 30; attempt++) {
      const ei = Math.floor(Math.random() * g.edges.length);
      const e = g.edges[ei];
      if (e.kind === 'service' && Math.random() < 0.85) continue;
      const lanes = g.out[e.a].concat(g.out[e.b]).filter((l) => l.edge === ei);
      if (!lanes.length) continue;
      const lane = lanes[Math.floor(Math.random() * lanes.length)];
      const len = g.length(ei);
      const s = Math.random() * len;
      g.sample(lane, s, tmp);
      const d = Math.hypot(tmp.x - focus.x, tmp.z - focus.z);
      if (d < minDist || d > SPAWN_MAX) continue;
      // Keep clear of other cars.
      if (this.cars.some((c) => c.pos.distanceTo(new THREE.Vector3(tmp.x, c.pos.y, tmp.z)) < 15)) continue;
      const body = this.phys.world.createRigidBody(this.phys.R.RigidBodyDesc.kinematicPositionBased().setTranslation(tmp.x, tmp.y + RIDE_HEIGHT, tmp.z));
      const he = CAR_SPEC.halfExtents;
      this.phys.world.createCollider(this.phys.R.ColliderDesc.cuboid(he.x, he.y, he.z).setTranslation(0, 0.1, 0), body);
      const car: AiCar = {
        id: this.nextId++, lane, s, speed: 0, offset: this.laneOffset(lane),
        color: new THREE.Color(CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]),
        blockedFor: 0, stunnedFor: 0, body, pos: new THREE.Vector3(), yaw: 0, pitch: 0, fresh: true,
      };
      car.speed = g.edges[ei].speed * 0.7;
      this.cars.push(car);
      return;
    }
  }

  /** Removes all cars (used to recover from errors); new ones spawn gradually. */
  reset() {
    while (this.cars.length) this.remove(this.cars[0]);
    this.reserved.clear();
  }

  private remove(c: AiCar) {
    this.phys.world.removeRigidBody(c.body);
    for (const [n, id] of this.reserved) if (id === c.id) this.reserved.delete(n);
    this.cars.splice(this.cars.indexOf(c), 1);
  }

  /** Called when the player crashes into AI cars: they stop for a while. */
  private checkPlayerHits(playerCar?: { position: THREE.Vector3; speed: number }) {
    if (!playerCar || Math.abs(playerCar.speed) < 3) return;
    for (const c of this.cars) if (c.pos.distanceTo(playerCar.position) < 4.6) c.stunnedFor = 4;
  }

  update(dt: number, focus: THREE.Vector3, obstacles: Obstacle[], playerCar?: { position: THREE.Vector3; speed: number }) {
    if (!this.enabled) {
      while (this.cars.length) this.remove(this.cars[0]);
      this.render();
      return;
    }
    // Despawn far cars, top up the population gradually.
    for (const c of [...this.cars]) if (c.pos.distanceTo(focus) > DESPAWN && !c.fresh) this.remove(c);
    this.spawnTimer -= dt;
    if (this.cars.length < this.maxCars && this.spawnTimer <= 0) {
      this.spawn(focus, this.cars.length < this.maxCars / 2 ? 40 : SPAWN_MIN);
      this.spawnTimer = 0.15;
    }
    this.checkPlayerHits(playerCar);

    const g = this.graph;
    for (const c of this.cars) {
      const len = g.length(c.lane.edge);
      const edge = g.edges[c.lane.edge];
      c.stunnedFor = Math.max(0, c.stunnedFor - dt);

      // Current heading for the obstacle scan.
      g.sample(c.lane, c.s, tmp);
      const hx = tmp.dx, hz = tmp.dz;
      const rx = -hz, rz = hx;
      const cx = tmp.x + rx * c.offset, cz = tmp.z + rz * c.offset;

      // 1. Gap to the nearest thing ahead in our lane.
      let gap = Infinity;
      const consider = (ox: number, oz: number, radius: number) => {
        const vx = ox - cx, vz = oz - cz;
        const along = vx * hx + vz * hz;
        if (along <= 0 || along > 45) return;
        const lateral = Math.abs(vx * rx + vz * rz);
        if (lateral > 1.6 + radius) return;
        gap = Math.min(gap, along - radius - CAR_LEN / 2);
      };
      for (const o of this.cars) if (o !== c) consider(o.pos.x, o.pos.z, CAR_LEN / 2);
      for (const o of obstacles) consider(o.x, o.z, o.radius);

      // 2. Junction ahead: reserve it or stop before it.
      const toEnd = len - c.s;
      const endNode = g.endNode(c.lane);
      if (!c.next && toEnd < 25) c.next = this.pickNext(c.lane);
      if (toEnd < 14) {
        const holder = this.reserved.get(endNode);
        if (holder === undefined || holder === c.id) this.reserved.set(endNode, c.id);
        else gap = Math.min(gap, toEnd - 6);
      }

      // 3. Speed control: speed limit, slower for tight turns, keep distance.
      let target = edge.speed;
      if (c.next && toEnd < 30) {
        g.sample(c.next, 6, tmp);
        const turn = 1 - (hx * tmp.dx + hz * tmp.dz); // 0 straight .. 2 U-turn
        target = Math.min(target, Math.max(3, edge.speed * (1 - turn * 0.6)));
      }
      if (gap < Infinity) target = Math.min(target, Math.max(0, (gap - 2.5) * 0.9));
      if (c.stunnedFor > 0) target = 0;
      const accel = target > c.speed ? 2.5 : 7;
      c.speed += Math.sign(target - c.speed) * Math.min(Math.abs(target - c.speed), accel * dt);

      // Stuck behind something that does not move: turn around.
      c.blockedFor = c.speed < 0.3 && gap < 12 ? c.blockedFor + dt : 0;
      if (c.blockedFor > 8) {
        c.lane = { edge: c.lane.edge, dir: c.lane.dir === 1 ? -1 : 1 };
        c.s = Math.max(0, len - c.s);
        c.next = undefined;
        c.offset = this.laneOffset(c.lane);
        c.blockedFor = 0;
      }

      // 4. Advance, moving onto the next edge at the junction.
      c.s += c.speed * dt;
      if (c.s >= len) {
        if (c.next === undefined) c.next = this.pickNext(c.lane);
        c.s -= len;
        c.lane = c.next;
        c.next = undefined;
        c.offset = this.laneOffset(c.lane);
      }
      // Release junctions we have left behind.
      const startNode = g.startNode(c.lane);
      if (c.s > 8 && this.reserved.get(startNode) === c.id) this.reserved.delete(startNode);
      for (const [n, id] of this.reserved) if (id === c.id && n !== endNode && n !== startNode) this.reserved.delete(n);

      // 5. Pose: lane position, terrain height, pitch from slope.
      g.sample(c.lane, c.s, tmp);
      const px = tmp.x - tmp.dz * c.offset, pz = tmp.z + tmp.dx * c.offset;
      const terrain = this.heights.sample(px, pz);
      const y = tmp.y > terrain + 1.5 ? tmp.y : terrain; // bridges keep the deck height
      const yaw = Math.atan2(tmp.dx, tmp.dz);
      const ahead = this.heights.sample(px + tmp.dx * 1.5, pz + tmp.dz * 1.5);
      const behind = this.heights.sample(px - tmp.dx * 1.5, pz - tmp.dz * 1.5);
      const pitch = tmp.y > terrain + 1.5 ? 0 : -Math.atan2(ahead - behind, 3);
      if (c.fresh) {
        c.pos.set(px, y + RIDE_HEIGHT, pz);
        c.yaw = yaw;
        c.pitch = pitch;
        c.fresh = false;
      } else {
        // Smooth corners and lane changes.
        const k = 1 - Math.exp(-dt * 10);
        c.pos.lerp(new THREE.Vector3(px, y + RIDE_HEIGHT, pz), k);
        let dy = yaw - c.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        c.yaw += dy * (1 - Math.exp(-dt * 8));
        c.pitch += (pitch - c.pitch) * k;
      }
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(c.pitch, c.yaw, 0, 'YXZ'));
      c.body.setNextKinematicTranslation(c.pos);
      c.body.setNextKinematicRotation(q);
    }
    this.render();
  }

  private render() {
    const m = new THREE.Matrix4();
    const white = new THREE.Color(1, 1, 1);
    this.cars.forEach((c, i) => {
      m.compose(c.pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(c.pitch, c.yaw, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
      this.paintMesh.setMatrixAt(i, m);
      this.detailMesh.setMatrixAt(i, m);
      this.paintMesh.setColorAt(i, c.color);
      this.detailMesh.setColorAt(i, white);
    });
    for (const mesh of [this.paintMesh, this.detailMesh]) {
      mesh.count = this.cars.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
