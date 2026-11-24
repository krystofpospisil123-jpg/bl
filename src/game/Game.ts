// Game loop: streamed 3D world, Rapier physics, the player on foot or in the car,
// and a free camera for exploring.
import * as THREE from 'three';
import type { WorldData } from '../world/WorldData.ts';
import { HeightField } from '../world/HeightField.ts';
import { ChunkManager } from '../world/ChunkManager.ts';
import { Materials, timeUniform } from '../render/materials.ts';
import { Pipeline, QUALITY_LABEL } from '../render/Pipeline.ts';
import { settings, saveSettings } from '../config.ts';
import { Environment, buildOverviewMesh } from '../render/Environment.ts';
import { FlyCamera } from '../controls/FlyCamera.ts';
import { ChaseCamera, CAR_STYLE, FOOT_STYLE } from '../controls/ChaseCamera.ts';
import { Input, MouseLook } from '../controls/Input.ts';
import { TouchControls, isTouchDevice } from '../controls/TouchControls.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Car } from '../vehicle/Car.ts';
import { Player } from '../character/Player.ts';
import { Hud } from '../ui/Hud.ts';
import { Graph } from '../traffic/Graph.ts';
import { Traffic } from '../traffic/Traffic.ts';
import { Pedestrians } from '../traffic/Pedestrians.ts';
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
  traffic?: Traffic;
  pedestrians?: Pedestrians;
  mode: Mode = 'loading';
  /** Mode to return to when leaving the free camera. */
  private playMode: 'foot' | 'car' = 'foot';
  /** Short message shown by the HUD (e.g. "slow down to get out"). */
  notice = '';
  private noticeUntil = 0;
  readonly pipeline: Pipeline;
  /** On-screen controls on phones and tablets. */
  touch?: TouchControls;
  private mats: Materials;
  private hud: Hud;
  private timer = new THREE.Timer();
  private autoQualityArmed = false;
  /** Shown by the HUD while mode === 'loading'. */
  loadingText = 'Načítám město a fyziku…';

  constructor(private canvas: HTMLCanvasElement, world: WorldData) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.heights = new HeightField(world.manifest);
    const mats = new Materials();
    this.mats = mats;
    this.env = new Environment(this.scene, this.renderer);
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, this.env);
    this.pipeline.onQualityChange = (q, auto) => this.say(auto ? `Kvalita grafiky snížena na: ${QUALITY_LABEL[q]}` : `Kvalita grafiky: ${QUALITY_LABEL[q]}`);
    this.chunks = new ChunkManager(world, this.heights, mats);
    this.chunks.uploadTexture = (t) => this.renderer.initTexture(t);
    const mobile = isTouchDevice();
    if (mobile) {
      this.chunks.useMobileProfile();
      this.touch = new TouchControls(this.input, { canEnterCar: () => this.canEnterCar });
    }
    this.scene.add(this.chunks.root);
    this.mouse = new MouseLook(canvas);
    this.fly = new FlyCamera(this.camera, this.input, this.mouse, canvas, (x, z) => this.heights.sample(x, z));
    this.fly.enabled = false;
    this.hud = new Hud(this);

    this.camera.position.set(SPAWN.x + 30, 330, SPAWN.z + 30);
    // Chunks wait for the aerial photo so every ground texture is painted with it.
    world.loadGroundPhoto().then(
      (photo) => {
        if (photo) this.chunks.painter.setPhoto(photo.bitmap, photo.step, photo.half);
        this.chunks.paused = false;
      },
      () => (this.chunks.paused = false),
    );
    world.loadOverview().then((o) => {
      this.heights.setOverview(o);
      this.scene.add(buildOverviewMesh(world.manifest, o, mats.overview));
      const g = this.heights.sample(SPAWN.x, SPAWN.z);
      this.camera.position.set(SPAWN.x - 12 * Math.sin(SPAWN.yaw), g + 5, SPAWN.z - 12 * Math.cos(SPAWN.yaw));
      this.camera.lookAt(SPAWN.x, g + 1, SPAWN.z);
    });
    Promise.all([PhysicsWorld.create(world.manifest), world.loadGraphs()]).then(([p, graphs]) => {
      this.physics = p;
      this.traffic = new Traffic(new Graph(graphs.drive, true), p, this.heights);
      this.pedestrians = new Pedestrians(new Graph(graphs.walk, false), this.heights);
      if (this.touch) {
        this.traffic.maxCars = 12;
        this.pedestrians.maxPeds = 24;
      }
      this.scene.add(this.traffic.group, this.pedestrians.group);
      this.chase = new ChaseCamera(this.camera, this.mouse, (x, z) => this.heights.sample(x, z), (o, d, max) =>
        p.castRay(o, d, max, this.mode === 'car' ? this.car?.body : this.player?.body),
      );
    });

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    let frameErrors = 0;
    this.renderer.setAnimationLoop(() => {
      try {
        this.frame();
      } catch (err) {
        // Keep the game running (and the picture moving) even if one frame fails.
        if (++frameErrors <= 5) console.error('Frame failed', err);
        this.input.endFrame();
      }
    });
    // Phones can drop the GPU context under memory pressure: tell the player instead of freezing.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.say('Grafika telefonu se restartuje…', 10);
    });
    canvas.addEventListener('webglcontextrestored', () => location.reload());
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
    this.pipeline.resize();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private handleKeys() {
    const k = this.input;
    VIEWPOINTS.forEach((v, i) => k.justPressed(v.key) && this.goTo(i));
    if (k.justPressed('KeyO')) this.env.sun.castShadow = !this.env.sun.castShadow;
    if (k.justPressed('KeyM')) location.hash = 'mapa';
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
    if (k.justPressed('KeyG')) {
      this.pipeline.cycle();
      this.pipeline.resetAuto(false);
    }
    if (k.justPressed('KeyN')) {
      settings.realNames = !settings.realNames;
      saveSettings();
      this.chunks.rebuildSigns();
      this.say(settings.realNames ? 'Skutečné názvy obchodů' : 'Obecné názvy obchodů');
    }
    if (k.justPressed('KeyT') && this.traffic && this.pedestrians) {
      this.traffic.enabled = this.pedestrians.enabled = !this.traffic.enabled;
      this.say(this.traffic.enabled ? 'Provoz zapnut' : 'Provoz vypnut');
    }
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
    timeUniform.value += dt;
    this.env.update(this.camera, cam.y - this.heights.sample(cam.x, cam.z), timeUniform.value);
    // Start watching the frame rate once the world around the player has loaded.
    if (!this.autoQualityArmed && this.mode !== 'loading' && this.chunks.stats().queued === 0) {
      this.autoQualityArmed = true;
      this.pipeline.resetAuto(true);
    }
    this.pipeline.render(dt);
    this.hud.update(dt);
    this.touch?.update(this.mode);
    this.input.endFrame();
  }

  private simulate(dt: number, groundReady: boolean) {
    const k = this.input;
    const car = this.car!, player = this.player!;
    const driving = this.mode === 'car';
    const walking = this.mode === 'foot';
    const carInput = {
      throttle: driving ? Math.max(k.down('KeyW', 'ArrowUp') ? 1 : 0, k.stick.y > 0 ? Math.min(1, k.stick.y * 1.3) : 0) : 0,
      brake: driving ? Math.max(k.down('KeyS', 'ArrowDown') ? 1 : 0, k.stick.y < -0.2 ? Math.min(1, -k.stick.y * 1.3) : 0) : 0,
      steer: driving ? THREE.MathUtils.clamp((k.down('KeyA', 'ArrowLeft') ? 1 : 0) - (k.down('KeyD', 'ArrowRight') ? 1 : 0) - k.stick.x, -1, 1) : 0,
      handbrake: driving ? k.down('Space') : true,
    };
    // On foot, WASD is relative to the camera direction.
    let mx = 0, mz = 0;
    if (walking && this.chase) {
      const f = (k.down('KeyW', 'ArrowUp') ? 1 : 0) - (k.down('KeyS', 'ArrowDown') ? 1 : 0) + k.stick.y;
      const r = (k.down('KeyD', 'ArrowRight') ? 1 : 0) - (k.down('KeyA', 'ArrowLeft') ? 1 : 0) + k.stick.x;
      const yaw = this.chase.viewYaw;
      mx = Math.sin(yaw) * f - Math.cos(yaw) * r;
      mz = Math.cos(yaw) * f + Math.sin(yaw) * r;
      const len = Math.hypot(mx, mz);
      if (len > 1) { mx /= len; mz /= len; }
    }
    const moveInput = { x: mx, z: mz, sprint: walking && k.down('ShiftLeft', 'ShiftRight'), jump: walking && k.down('Space') };

    // Traffic and pedestrians move first so their kinematic bodies are placed for this step.
    if (groundReady && this.traffic && this.pedestrians) {
      const focus = this.focus;
      const obstacles = [{ x: car.position.x, z: car.position.z, radius: 2.2 }, ...this.pedestrians.obstacles()];
      if (player.isActive) obstacles.push({ x: player.position.x, z: player.position.z, radius: 0.6 });
      const pc = driving ? { position: car.position, yaw: car.yaw, speed: car.speed } : undefined;
      // A bug in the AI must never stop the whole game: log it and start the AI afresh.
      this.guard('traffic', () => this.traffic!.update(dt, focus, obstacles, pc), () => this.traffic!.reset());
      this.guard('pedestrians', () => this.pedestrians!.update(dt, focus, pc), () => this.pedestrians!.reset());
    }

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

  private guardErrors = new Map<string, number>();

  private guard(name: string, run: () => void, recover: () => void) {
    try {
      run();
    } catch (err) {
      const n = (this.guardErrors.get(name) ?? 0) + 1;
      this.guardErrors.set(name, n);
      if (n <= 3) console.error(`${name} failed, restarting it`, err);
      try {
        recover();
      } catch {
        /* nothing more to do */
      }
    }
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
    this.warmUp().finally(() => this.setMode('foot'));
  }

  /**
   * Compiles every shader the city needs before play starts. Without this, each new kind
   * of object (water, signs, traffic, lamps...) froze the game for up to a second the first
   * time it came into view.
   */
  private async warmUp() {
    this.loadingText = 'Připravuji grafiku…';
    // Wait until the chunks around the player are built so their materials are in the scene.
    const t0 = performance.now();
    while (this.chunks.stats().queued > 0 && performance.now() - t0 < 8000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    // One small sample of every material variant, in case the nearby chunks lack some (water, signs...).
    const samples = new THREE.Group();
    const box = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const m = this.mats;
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    const sign = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 });
    for (const mat of [m.walls, m.roofs, m.flatRoofs, m.water, m.bridge, m.bridgeDeck, m.bridgeRail, m.overview, sign]) samples.add(new THREE.Mesh(box, mat));
    for (const mat of [m.trees, m.props, m.jets, m.parkedCars]) samples.add(new THREE.InstancedMesh(box, mat, 1));
    samples.position.copy(this.camera.position).add(new THREE.Vector3(0, -50, 0));
    samples.traverse((o) => { o.castShadow = o.receiveShadow = true; });
    this.scene.add(samples);
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch (err) {
      console.warn('Shader warm-up failed', err);
    }
    this.scene.remove(samples);
    box.dispose();
    sign.dispose();
    tex.dispose();
    this.loadingText = '';
  }
}
