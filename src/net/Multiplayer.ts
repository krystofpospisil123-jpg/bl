// Multiplayer over Supabase Realtime: every logged-in player joins one channel, shares their
// state ~8 times a second (broadcast) and their nickname (presence). Other players are drawn
// as characters or cars with a name tag, interpolated slightly in the past for smooth motion.
// Damage is sent to the victim, who applies it to themselves (no game server).
import * as THREE from 'three';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './Account.ts';
import { CharacterModel, DEFAULT_OUTFIT } from '../character/CharacterModel.ts';
import { CarModel } from '../vehicle/CarModel.ts';
import { CAR_SPEC } from '../vehicle/CarPhysics.ts';
import type { CarType } from '../assets/models.ts';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import type RAPIER from '@dimforge/rapier3d-compat';

const SEND_INTERVAL = 0.125;
/** Remote players are shown this far in the past so there are always two states to blend. */
const DELAY = 0.18;
const TIMEOUT = 10;

/** What a player shares about themselves. */
export interface NetState {
  m: 'foot' | 'car';
  /** Position (feet on foot, body centre in a car), rotation quaternion, speed. */
  p: [number, number, number];
  q: [number, number, number, number];
  s: number;
  /** Car: type, colour, rims, neon, spoiler, lowered. */
  c?: [CarType, number, number, number | null, boolean, boolean];
  h: number;
  a: boolean;
}

interface Sample { t: number; p: THREE.Vector3; q: THREE.Quaternion; s: number }

export class RemotePlayer {
  readonly person: CharacterModel;
  car: CarModel | null = null;
  private carKey = '';
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  mode: 'foot' | 'car' = 'foot';
  health = 100;
  lastSeen = performance.now();
  private samples: Sample[] = [];
  private tag: THREE.Sprite;
  private tagCanvas = document.createElement('canvas');
  private tagHealth = -1;
  body: RAPIER.RigidBody | null = null;

  constructor(readonly id: string, public nick: string, private group: THREE.Group, private phys: PhysicsWorld | undefined) {
    // Each player gets their own shirt colour from their id.
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const top = new THREE.Color().setHSL((h % 360) / 360, 0.65, 0.45).getHex();
    this.person = new CharacterModel({ ...DEFAULT_OUTFIT, top });
    this.tagCanvas.width = 256;
    this.tagCanvas.height = 72;
    const tex = new THREE.CanvasTexture(this.tagCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Same size on screen at any distance.
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    this.tag.scale.set(0.13, 0.0366, 1);
    this.tag.renderOrder = 10;
    this.drawTag();
    group.add(this.person.root, this.tag);
  }

  private drawTag() {
    const g = this.tagCanvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 72);
    g.font = 'bold 30px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(this.nick, 128, 24);
    g.fillStyle = '#fff';
    g.fillText(this.nick, 128, 24);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(58, 50, 140, 12);
    g.fillStyle = this.health > 35 ? '#4cd964' : '#ff3b30';
    g.fillRect(60, 52, 136 * Math.max(0, this.health) / 100, 8);
    (this.tag.material.map as THREE.CanvasTexture).needsUpdate = true;
    this.tagHealth = this.health;
  }

  push(st: NetState) {
    this.lastSeen = performance.now();
    this.health = st.h;
    this.mode = st.m;
    this.person.aiming = st.a && st.m === 'foot';
    this.samples.push({ t: performance.now() / 1000, p: new THREE.Vector3(...st.p), q: new THREE.Quaternion(...st.q), s: st.s });
    if (this.samples.length > 12) this.samples.shift();
    if (st.m === 'car' && st.c) {
      const key = st.c.join(',');
      if (key !== this.carKey) this.setCar(st.c, key);
    }
  }

  private setCar(c: NonNullable<NetState['c']>, key: string) {
    this.removeCar(false);
    const [type, color, rims, neon, spoiler, lowered] = c;
    const m = new CarModel(color, type);
    m.setRimColor(rims);
    m.setNeon(neon);
    m.setSpoiler(spoiler ? color : null);
    m.setLowered(lowered);
    m.wheels.forEach((w, i) => {
      const a = m.wheelAnchors?.[i];
      const y = CAR_SPEC.wheelY - CAR_SPEC.suspensionRest * 0.75;
      if (a) w.position.set(a.x, y, a.z);
      else w.position.set((i % 2 ? -0.8 : 0.8) * 1.06, y, i < 2 ? CAR_SPEC.wheelZFront : CAR_SPEC.wheelZRear);
    });
    this.car = m;
    this.carKey = key;
    this.group.add(m.root);
    // A kinematic box so cars bump into each other.
    if (this.phys) {
      const he = CAR_SPEC.halfExtents;
      this.body = this.phys.world.createRigidBody(this.phys.R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -1e4, 0));
      this.phys.world.createCollider(this.phys.R.ColliderDesc.cuboid(he.x, he.y, m.halfLength - 0.1), this.body);
    }
  }

  private removeCar(clearKey = true) {
    if (this.car) this.group.remove(this.car.root);
    this.car = null;
    if (clearKey) this.carKey = '';
    if (this.body && this.phys) this.phys.world.removeRigidBody(this.body);
    this.body = null;
  }

  update(dt: number) {
    // Blend between the two samples around (now - DELAY).
    const t = performance.now() / 1000 - DELAY;
    const s = this.samples;
    if (!s.length) return;
    let a = s[0], b = s[0];
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i].t <= t && s[i + 1].t >= t) { a = s[i]; b = s[i + 1]; break; }
      if (s[i + 1].t < t) { a = b = s[i + 1]; }
    }
    const k = b.t > a.t ? THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1) : 1;
    this.position.lerpVectors(a.p, b.p, k);
    this.quaternion.slerpQuaternions(a.q, b.q, k);
    const speed = a.s + (b.s - a.s) * k;
    const inCar = this.mode === 'car' && this.car;
    this.person.root.visible = !inCar;
    if (inCar) {
      const car = this.car!;
      car.root.visible = true;
      car.root.position.copy(this.position);
      car.root.quaternion.copy(this.quaternion);
      for (const w of car.wheels) w.rotation.x += (speed / CAR_SPEC.wheelRadius) * dt;
      this.body?.setNextKinematicTranslation(this.position);
      this.body?.setNextKinematicRotation(this.quaternion);
      this.tag.position.set(this.position.x, this.position.y + 1.9, this.position.z);
    } else {
      if (this.car) this.removeCar();
      this.person.root.position.copy(this.position);
      this.person.root.quaternion.copy(this.quaternion);
      this.person.animate(Math.abs(speed), true, dt);
      this.tag.position.set(this.position.x, this.position.y + 2.25, this.position.z);
    }
    if (Math.round(this.health) !== Math.round(this.tagHealth)) this.drawTag();
  }

  dispose() {
    this.removeCar();
    this.group.remove(this.person.root, this.tag);
    this.tag.material.map?.dispose();
    this.tag.material.dispose();
  }
}

export class Multiplayer {
  readonly group = new THREE.Group();
  readonly players = new Map<string, RemotePlayer>();
  private channel: RealtimeChannel | null = null;
  private sendClock = 0;
  private lastSent = '';
  private heartbeat = 0;
  connected = false;
  /** Another player hit us: damage and their nickname. */
  onHit?: (damage: number, from: string, kind: 'shot' | 'car') => void;
  /** Someone was killed by someone. */
  onKill?: (victim: string, killer: string) => void;
  onJoin?: (nick: string) => void;
  onLeave?: (nick: string) => void;

  constructor(private phys: PhysicsWorld | undefined = undefined) {}

  setPhysics(p: PhysicsWorld) {
    this.phys = p;
  }

  get online() {
    return this.connected;
  }

  join(id: string, nick: string) {
    if (this.channel) this.leave();
    this.myId = id;
    this.myNick = nick;
    const ch = supabase.channel('blansko-world', { config: { broadcast: { self: false }, presence: { key: id } } });
    ch.on('broadcast', { event: 'st' }, ({ payload }) => {
      const { id: pid, n, ...st } = payload as NetState & { id: string; n: string };
      if (pid === this.myId) return;
      let p = this.players.get(pid);
      if (!p) {
        p = new RemotePlayer(pid, n, this.group, this.phys);
        this.players.set(pid, p);
      } else if (p.nick !== n) p.nick = n;
      p.push(st as NetState);
    });
    ch.on('broadcast', { event: 'hit' }, ({ payload }) => {
      const { to, dmg, from, kind } = payload as { to: string; dmg: number; from: string; kind: 'shot' | 'car' };
      if (to === this.myId) this.onHit?.(Math.min(100, Math.max(0, dmg)), from, kind);
    });
    ch.on('broadcast', { event: 'kill' }, ({ payload }) => {
      const { victim, killer } = payload as { victim: string; killer: string };
      this.onKill?.(victim, killer);
    });
    ch.on('presence', { event: 'join' }, ({ key, newPresences }) => {
      if (key === this.myId) return;
      const nick = (newPresences[0] as { nick?: string } | undefined)?.nick;
      if (nick) this.onJoin?.(nick);
    });
    ch.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
      const p = this.players.get(key);
      const nick = p?.nick ?? (leftPresences[0] as { nick?: string } | undefined)?.nick;
      if (key === this.myId) return;
      // A short reconnect also reports a leave: the player disappears only if no state follows.
      if (p) p.lastSeen = Math.min(p.lastSeen, performance.now() - (TIMEOUT - 2.5) * 1000);
      setTimeout(() => {
        if (nick && !this.players.has(key)) this.onLeave?.(nick);
      }, 3000);
    });
    ch.subscribe((status) => {
      this.connected = status === 'SUBSCRIBED';
      if (this.connected) void ch.track({ nick, at: Date.now() });
    });
    this.channel = ch;
  }

  private myId = '';
  private myNick = '';

  get id() {
    return this.myId;
  }

  get nick() {
    return this.myNick;
  }

  leave() {
    if (this.channel) void supabase.removeChannel(this.channel);
    this.channel = null;
    this.connected = false;
    for (const p of this.players.values()) p.dispose();
    this.players.clear();
  }

  /** Sends our state (rate-limited) and moves the other players. */
  update(dt: number, me: NetState | null) {
    for (const [id, p] of this.players) {
      if (performance.now() - p.lastSeen > TIMEOUT * 1000) {
        p.dispose();
        this.players.delete(id);
      } else p.update(dt);
    }
    if (!this.channel || !this.connected || !me) return;
    this.sendClock += dt;
    this.heartbeat += dt;
    if (this.sendClock < SEND_INTERVAL) return;
    this.sendClock = 0;
    const r = (v: number) => Math.round(v * 100) / 100;
    const msg = { ...me, p: me.p.map(r), q: me.q.map((v) => Math.round(v * 1000) / 1000), s: r(me.s), h: Math.round(me.h) } as NetState;
    const key = JSON.stringify(msg);
    // Standing still: only a heartbeat every 2 s.
    if (key === this.lastSent && this.heartbeat < 2) return;
    this.lastSent = key;
    this.heartbeat = 0;
    void this.channel.send({ type: 'broadcast', event: 'st', payload: { id: this.myId, n: this.myNick, ...msg } });
  }

  hit(to: string, dmg: number, kind: 'shot' | 'car') {
    void this.channel?.send({ type: 'broadcast', event: 'hit', payload: { to, dmg: Math.round(dmg), from: this.myNick, kind } });
  }

  announceKill(killer: string) {
    void this.channel?.send({ type: 'broadcast', event: 'kill', payload: { victim: this.myNick, killer } });
  }
}
