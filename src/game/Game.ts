// Game loop: streamed 3D world, Rapier physics, the player on foot or in the car,
// and a free camera for exploring.
import * as THREE from 'three';
import type { WorldData } from '../world/WorldData.ts';
import { HeightField } from '../world/HeightField.ts';
import { ChunkManager } from '../world/ChunkManager.ts';
import { Materials } from '../render/materials.ts';
import { Environment, buildOverviewMesh } from '../render/Environment.ts';
import { FlyCamera } from '../controls/FlyCamera.ts';
import { ChaseCamera, CAR_STYLE, FOOT_STYLE } from '../controls/ChaseCamera.ts';
import { Input, MouseLook } from '../controls/Input.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Car } from '../vehicle/Car.ts';
import { Player } from '../character/Player.ts';
import { Hud } from '../ui/Hud.ts';
import { VIEWPOINTS } from './viewpoints.ts';

/** Car spawn on náměstí Republiky (on the street, heading along it). */
const SPAWN = { x: -15.7, z: 184.2, yaw: -2.79 };
/** Max distance (m) from the car centre at which F gets you in. */
const ENTER_DISTANCE = 3.6;
/** Max speed (m/s) at which you can get out. */
const EXIT_SPEED = 4;

export type Mode = 'loading' | 'foot' | 'car' | 'fly';

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.3, 6000);
  readonly heights: HeightField;
  readonly chunks: ChunkManager;
  readonly env: Environment;
  readonly input = new Input();
  readonly mouse: MouseLook;
  readonly fly: FlyCamera;
  chase?: ChaseCamera;
  physics?: PhysicsWorld;
  car?: Car;
  player?: Player;
  mode: Mode = 'loading';
  /** Mode to return to when leaving the free camera. */
  private playMode: 'foot' | 'car' = 'foot';
  /** Short message shown by the HUD (e.g. "slow down to get out"). */
  notice = '';
  private noticeUntil = 0;
  private hud: Hud;
  private timer = new THREE.Timer();

  constructor(private canvas: HTMLCanvasElement, world: WorldData) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.heights = new HeightField(world.manifest);
    const mats = new Materials();
    this.env = new Environment(this.scene);
    this.chunks = new ChunkManager(world, this.heights, mats);
    this.scene.add(this.chunks.root);
    this.mouse = new MouseLook(canvas);
    this.fly = new FlyCamera(this.camera, this.input, this.mouse, canvas, (x, z) => this.heights.sample(x, z));
    this.fly.enabled = false;
    this.hud = new Hud(this);

    this.camera.position.set(SPAWN.x + 30, 330, SPAWN.z + 30);
    world.loadOverview().then((o) => {
      this.heights.setOverview(o);
      this.scene.add(buildOverviewMesh(world.manifest, o, mats.overview));
      const g = this.heights.sample(SPAWN.x, SPAWN.z);
      this.camera.position.set(SPAWN.x - 12 * Math.sin(SPAWN.yaw), g + 5, SPAWN.z - 12 * Math.cos(SPAWN.yaw));
      this.camera.lookAt(SPAWN.x, g + 1, SPAWN.z);
    });
    PhysicsWorld.create(world.manifest).then((p) => {
      this.physics = p;
      this.chase = new ChaseCamera(this.camera, this.mouse, (x, z) => this.heights.sample(x, z), (o, d, max) =>
        p.castRay(o, d, max, this.mode === 'car' ? this.car?.body : this.player?.body),
      );
    });

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Position the world streams around. */
  get focus(): THREE.Vector3 {
    if (this.mode === 'car' && this.car) return this.car.position;
    if (this.mode === 'foot' && this.player) return this.player.position;
    return this.camera.position;
  }

  /** True when the player can press F to get into the car. */
  get canEnterCar(): boolean {
    return this.mode === 'foot' && !!this.car && !!this.player && this.player.position.distanceTo(this.car.position) < ENTER_DISTANCE;
  }

  say(text: string, seconds = 2.5) {
    this.notice = text;
    this.noticeUntil = performance.now() + seconds * 1000;
  }

  goTo(i: number) {
    const v = VIEWPOINTS[i];
    const [x, z, above] = v.pos;
    this.setMode('fly');
    this.camera.position.set(x, this.heights.sample(x, z) + above, z);
    this.fly.lookAt(new THREE.Vector3(v.look[0], this.heights.sample(v.look[0], v.look[1]) + 10, v.look[1]));
  }

  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.fly.enabled = mode === 'fly';
    if (mode === 'fly') this.fly.syncFromCamera();
    if (mode === 'foot' || mode === 'car') {
      this.playMode = mode;
      this.chase?.setStyle(mode === 'car' ? CAR_STYLE : FOOT_STYLE);
    }
  }

  /** Surface height below (x, z) from `fromY` downward (roofs and bridges count), or terrain. */
  private surfaceBelow(x: number, z: number, fromY: number): number {
    const terrain = this.heights.sample(x, z);
    if (!this.physics || fromY <= terrain) return terrain;
    const free = this.physics.castRay({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }, fromY - terrain + 1, this.car?.body);
    return Math.max(terrain, fromY - free);
  }

  private enterCar() {
    if (!this.car || !this.player) return;
    this.player.setActive(false);
    this.setMode('car');
  }

  private exitCar() {
    if (!this.car || !this.player || !this.physics) return;
    if (Math.abs(this.car.speed) > EXIT_SPEED) {
      this.say('Zpomal, za jízdy nevystoupíš');
      return;
    }
    // Driver's door is on the left (+X in car space); try left, right, then the roof.
    const q = this.car.quaternion;
    const candidates = [new THREE.Vector3(1.55, 0, 0.3), new THREE.Vector3(-1.55, 0, 0.3), new THREE.Vector3(0, 1.4, 0)];
    let spot: THREE.Vector3 | null = null;
    for (const local of candidates) {
      const worldOff = local.clone().applyQuaternion(q);
      const dir = worldOff.clone().normalize();
      const origin = this.car.position.clone().add(new THREE.Vector3(0, 0.3, 0));
      const free = this.physics.castRay(origin, dir, worldOff.length() + 0.4, this.car.body);
      if (free >= worldOff.length() + 0.4) {
        spot = this.car.position.clone().add(worldOff);
        break;
      }
    }
    if (!spot) {
      this.say('Tady se nedá vystoupit');
      return;
    }
    const feetY = this.surfaceBelow(spot.x, spot.z, spot.y + 1.5) + 0.05;
    this.player.teleport(new THREE.Vector3(spot.x, feetY, spot.z), this.car.yaw);
    this.player.setActive(true);
    this.setMode('foot');
  }

  /** From the free camera: put the player (and the car beside them) under the camera. */
  private landHere() {
    if (!this.player || !this.car) return;
    const c = this.camera.position;
    const yaw = this.fly.yaw + Math.PI; // face where the camera was looking
    const feetY = this.surfaceBelow(c.x, c.z, c.y) + 0.1;
    if (this.playMode === 'car') {
      this.car.reset(new THREE.Vector3(c.x, feetY + 1.2, c.z), yaw);
    } else {
      this.player.teleport(new THREE.Vector3(c.x, feetY, c.z), yaw);
      // Park the car 4 m to the player's right so it is always at hand.
      const side = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw)).multiplyScalar(4);
      const cx = c.x + side.x, cz = c.z + side.z;
      this.car.reset(new THREE.Vector3(cx, this.surfaceBelow(cx, cz, c.y) + 1.2, cz), yaw);
    }
    this.chase?.setYaw(yaw);
    this.setMode(this.playMode);
  }

  private resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private handleKeys() {
    const k = this.input;
    VIEWPOINTS.forEach((v, i) => k.justPressed(v.key) && this.goTo(i));
    if (k.justPressed('KeyO')) this.env.sun.castShadow = !this.env.sun.castShadow;
    if (k.justPressed('KeyP') && this.car) {
      if (this.mode === 'fly') this.landHere();
      else if (this.mode !== 'loading') {
        this.camera.fov = 60;
        this.setMode('fly');
      }
    }
    if (k.justPressed('KeyF')) {
      if (this.mode === 'car') this.exitCar();
      else if (this.canEnterCar) this.enterCar();
    }
    if (k.justPressed('KeyR') && this.car && this.mode === 'car') this.car.reset(undefined, this.car.yaw);
  }

  private frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    if (this.notice && performance.now() > this.noticeUntil) this.notice = '';
    this.handleKeys();

    const focus = this.focus;
    this.chunks.update(focus);

    if (this.physics) {
      // Colliders follow the player; the parked car keeps its own ground while nearby.
      const ready = this.physics.updateStreaming(focus.x, focus.z, (cx, cz) => this.chunks.physicsSource(cx, cz));
      if (!this.car && ready && this.mode === 'loading') this.spawn();
      if (this.car && this.player) this.simulate(dt, ready);
    }

    if ((this.mode === 'car' || this.mode === 'foot') && this.chase) {
      const t = this.mode === 'car'
        ? { position: this.car!.position, yaw: this.car!.yaw, speed: this.car!.speed }
        : { position: this.player!.position, yaw: this.player!.yaw, speed: this.player!.speed };
      this.chase.update(t, dt);
    } else if (this.mode === 'fly') {
      this.fly.update(dt);
    } else {
      this.mouse.take();
    }

    const cam = this.camera.position;
    this.env.update(this.camera, cam.y - this.heights.sample(cam.x, cam.z));
    this.renderer.render(this.scene, this.camera);
    this.hud.update(dt);
    this.input.endFrame();
  }

  private simulate(dt: number, groundReady: boolean) {
    const k = this.input;
    const car = this.car!, player = this.player!;
    const driving = this.mode === 'car';
    const walking = this.mode === 'foot';
    const carInput = {
      throttle: driving && k.down('KeyW', 'ArrowUp') ? 1 : 0,
      brake: driving && k.down('KeyS', 'ArrowDown') ? 1 : 0,
      steer: driving ? (k.down('KeyA', 'ArrowLeft') ? 1 : 0) - (k.down('KeyD', 'ArrowRight') ? 1 : 0) : 0,
      handbrake: driving ? k.down('Space') : true,
    };
    // On foot, WASD is relative to the camera direction.
    let mx = 0, mz = 0;
    if (walking && this.chase) {
      const f = (k.down('KeyW', 'ArrowUp') ? 1 : 0) - (k.down('KeyS', 'ArrowDown') ? 1 : 0);
      const r = (k.down('KeyD', 'ArrowRight') ? 1 : 0) - (k.down('KeyA', 'ArrowLeft') ? 1 : 0);
      const yaw = this.chase.viewYaw;
      mx = Math.sin(yaw) * f - Math.cos(yaw) * r;
      mz = Math.cos(yaw) * f + Math.sin(yaw) * r;
      const len = Math.hypot(mx, mz);
      if (len > 1) { mx /= len; mz /= len; }
    }
    const moveInput = { x: mx, z: mz, sprint: walking && k.down('ShiftLeft', 'ShiftRight'), jump: walking && k.down('Space') };

    // Only simulate while the ground around the player exists.
    if (groundReady) {
      this.physics!.step(dt, (h) => {
        car.control(carInput, h);
        player.control(moveInput, h);
      });
    }
    car.sync(dt);
    player.sync(dt);

    // Safety net: anything that fell through the world is put back on the terrain.
    const below = (p: THREE.Vector3) => p.y < this.heights.sample(p.x, p.z) - 10;
    if (below(car.position)) car.reset(new THREE.Vector3(car.position.x, this.heights.sample(car.position.x, car.position.z) + 2, car.position.z), car.yaw);
    if (player.isActive && below(player.position)) player.teleport(new THREE.Vector3(player.position.x, this.heights.sample(player.position.x, player.position.z) + 0.5, player.position.z));
  }

  private spawn() {
    const g = this.heights.sample(SPAWN.x, SPAWN.z);
    this.car = new Car(this.physics!, new THREE.Vector3(SPAWN.x, g + 1.2, SPAWN.z), SPAWN.yaw);
    this.scene.add(this.car.model.root);
    // The player stands by the driver's door, facing the same way as the car.
    const door = new THREE.Vector3(2.2, 0, 0.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), SPAWN.yaw);
    const px = SPAWN.x + door.x, pz = SPAWN.z + door.z;
    this.player = new Player(this.physics!, new THREE.Vector3(px, this.heights.sample(px, pz) + 0.1, pz), SPAWN.yaw);
    this.scene.add(this.player.model.root);
    this.chase?.setStyle(FOOT_STYLE);
    this.chase?.setYaw(SPAWN.yaw);
    this.setMode('foot');
  }
}
