// Game loop: streamed 3D world, Rapier physics, the player on foot or in the car,
// and a free camera for exploring.
import * as THREE from 'three';
import { loadModels } from '../assets/models.ts';
import { applyPhotoFacades } from '../render/facades.ts';
import { signMaterial } from '../world/builders/trafficSigns.ts';
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
import { Police } from '../police/Police.ts';
import { Sound } from '../audio/Sound.ts';
import { Weapon } from '../combat/Weapon.ts';
import { Arsenal, WEAPONS, formatKc } from '../combat/Arsenal.ts';
import { Effects } from '../fx/Effects.ts';
import { Pickups } from './Pickups.ts';
import { Shops } from './Shops.ts';
import { Interior } from './Interior.ts';
import { Garage } from './Garage.ts';
import { stockTuning } from '../vehicle/Tuning.ts';
import { StartMenu } from '../ui/StartMenu.ts';
import type { StoreEntrance } from '../world/builders/signs.ts';
import { Minimap, type MapMark } from '../ui/Minimap.ts';
import { assets } from '../assets/models.ts';
import type RAPIER from '@dimforge/rapier3d-compat';

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
  police?: Police;
  readonly sound = new Sound(settings.muted);
  readonly arsenal = new Arsenal();
  readonly weapon = new Weapon(this.arsenal);
  readonly effects = new Effects();
  readonly pickups = new Pickups();
  shops?: Shops;
  interior?: Interior;
  readonly garage = new Garage(this.arsenal);
  private lastThrottle = 0;
  /** Paused from the menu (Esc): the world stops, rendering goes on. */
  paused = false;
  private ready = false;
  private modelsReady = false;
  menu?: StartMenu;
  /** The store the player is inside, if any. */
  insideStore: (StoreEntrance & { y: number }) | null = null;
  /** Bins searched recently (key "x,z" -> time when they can be searched again). */
  private searchedBins = new Map<string, number>();
  /** Smoke from the bonnet of a badly damaged car. */
  private carSmoke = this.effects.addSource(new THREE.Vector3(0, -1e4, 0), 0, false);
  minimap?: Minimap;
  /** Cars the player left behind after stealing another one (static, with a collider). */
  private leftCars: { mesh: THREE.Object3D; collider: RAPIER.Collider }[] = [];
  private mouseFire = false;
  private crosshair = document.createElement('div');
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
      this.touch = new TouchControls(this.input, {
        canEnterCar: () => this.canEnterCar, canSteal: () => this.canSteal, armed: () => this.weapon.equipped, nearBin: () => !!this.nearBin && !this.nearEntrance, nearEntrance: () => !!this.nearEntrance,
      });
    }
    this.scene.add(this.chunks.root);
    this.mouse = new MouseLook(canvas);
    this.fly = new FlyCamera(this.camera, this.input, this.mouse, canvas, (x, z) => this.heights.sample(x, z));
    this.fly.enabled = false;
    this.hud = new Hud(this);
    // Shooting: left mouse button while the mouse is captured (the first click captures it).
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.mouse.locked) this.mouseFire = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseFire = false;
    });
    this.scene.add(this.effects.group);
    this.menu = new StartMenu(this);
    this.crosshair.id = 'crosshair';
    this.crosshair.hidden = true;
    document.body.append(this.crosshair);

    this.camera.position.set(SPAWN.x + 30, 330, SPAWN.z + 30);
    // Chunks wait for the aerial photo so every ground texture is painted with it.
    // Photo facades (AI-generated texture sheets) replace the painted ones when they arrive.
    Promise.all([world.loadImage('textures/facades-photo.jpg'), world.loadImage('textures/facades-photo-aux.png')]).then(
      ([color, aux]) => applyPhotoFacades({ map: mats.walls.map!, roughness: mats.walls.roughnessMap! }, color, aux),
      (err) => console.warn('Fotky fasád se nenačetly, zůstávají kreslené', err),
    );
    // Car and pedestrian models are needed before the first chunks (parked cars) and traffic.
    const models = world.loadModelsFile().then((buf) => loadModels(buf)).catch((err) => {
      console.error('Modely aut a postav se nenačetly, používám jednoduché tvary', err);
    }).finally(() => (this.modelsReady = true));
    Promise.all([world.loadGroundPhoto().catch(() => null), models]).then(([photo]) => {
      if (photo) this.chunks.painter.setPhoto(photo.bitmap, photo.step, photo.half);
      this.chunks.paused = false;
    });
    world.loadOverview().then((o) => {
      this.heights.setOverview(o);
      this.scene.add(buildOverviewMesh(world.manifest, o, mats.overview));
      const g = this.heights.sample(SPAWN.x, SPAWN.z);
      this.camera.position.set(SPAWN.x - 12 * Math.sin(SPAWN.yaw), g + 5, SPAWN.z - 12 * Math.cos(SPAWN.yaw));
      this.camera.lookAt(SPAWN.x, g + 1, SPAWN.z);
    });
    Promise.all([PhysicsWorld.create(world.manifest), world.loadGraphs(), models]).then(([p, graphs]) => {
      this.physics = p;
      this.traffic = new Traffic(new Graph(graphs.drive, true), p, this.heights);
      this.pedestrians = new Pedestrians(new Graph(graphs.walk, false), this.heights);
      if (this.touch) {
        this.traffic.maxCars = 12;
        this.pedestrians.maxPeds = 24;
      }
      this.police = new Police(new Graph(graphs.drive, true), p, this.heights);
      // Crimes raise the wanted level; police catching you ends the chase.
      this.pedestrians.onHit = () => {
        this.sound.thud();
        this.police?.report(1, 'pedestrian');
      };
      this.traffic.onRam = () => this.police?.report(0.25, 'ramming');
      this.police.onWanted = (level, reason) => {
        if (reason === 'lost') this.say(level ? `Policie tě ztrácí: ${'★'.repeat(level)}` : 'Policie tě ztratila');
        else this.say(`Hledanost ${'★'.repeat(level)}`);
      };
      this.police.onBusted = () => this.busted();
      this.weapon.onCrime = (amount, reason) => this.police?.report(amount, reason);
      this.weapon.onShot = () => this.sound.gunshot();
      this.weapon.onEmpty = () => {
        this.sound.click();
        this.say('Došly náboje – kup je v obchodě se zbraněmi');
      };
      this.pedestrians.onKilled = (pos) => this.pickups.drop(pos, 20 + Math.round(Math.random() * 18) * 10);
      const wrecked = (pos: THREE.Vector3) => {
        this.effects.explosion(pos);
        this.effects.addSource(pos, 0.9, true, 60);
        this.sound.explosion();
      };
      this.traffic.onWrecked = (pos) => {
        wrecked(pos);
        this.police?.report(0.5, 'wrecked a car');
      };
      this.police.onWrecked = wrecked;
      this.shops = new Shops(this.arsenal);
      this.shops.onMessage = (t) => this.say(t);
      this.garage.onMessage = (t) => this.say(t);
      this.interior = new Interior(p);
      this.scene.add(this.interior.group, this.pickups.group);
      this.minimap = new Minimap(graphs, world.manifest.halfExtent, this.touch ? 110 : 180);
      this.scene.add(this.traffic.group, this.pedestrians.group, this.police.group, this.weapon.group);
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

  /** A traffic car close enough to steal (on foot, when not next to your own car). */
  get canSteal(): boolean {
    return this.mode === 'foot' && !this.insideStore && !this.canEnterCar && !!this.player && !!this.traffic?.stealable(this.player.position);
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

  /** Takes the traffic car next to the player; the old car stays parked where it was. */
  private steal() {
    const c = this.traffic?.stealable(this.player!.position);
    if (!c || !this.car || !this.physics || !this.traffic) return;
    this.leaveCarBehind();
    const t = this.traffic.take(c);
    this.car.setLook(t.color, t.type);
    this.car.tuning = stockTuning(); // a stolen car comes without your tuning
    this.car.applyTuning();
    this.car.reset(t.position.clone().add(new THREE.Vector3(0, 0.2, 0)), t.yaw);
    this.enterCar();
    this.chase?.setYaw(t.yaw);
    this.pedestrians?.panicAround(t.position, 20);
    if (this.police?.units.some((u) => u.pos.distanceTo(t.position) < 60)) this.police.report(1, 'car theft');
    this.say('Ukradl jsi auto');
  }

  /** Loading progress for the start screen. */
  loadProgress(): { value: number; text: string; ready: boolean } {
    const near = Math.min(1, this.chunks.stats().lodCounts[0] / 6);
    const steps: [boolean | number, string][] = [
      [this.modelsReady, 'Načítám auta a postavy…'],
      [!this.chunks.paused, 'Načítám letecké snímky…'],
      [!!this.physics, 'Připravuji fyziku a silnice…'],
      [near, 'Stavím město kolem tebe…'],
      [!!this.car, 'Připravuji hráče…'],
      [this.ready, 'Připravuji grafiku…'],
    ];
    let value = 0;
    let text = 'Hotovo';
    for (const [done, label] of steps) {
      const v = typeof done === 'number' ? done : done ? 1 : 0;
      value += v / steps.length;
      if (v < 1 && text === 'Hotovo') text = label;
    }
    return { value, text, ready: this.ready };
  }

  /** Cheat codes typed in the cheat menu; returns a message for the player. */
  cheat(code: string): string {
    const [cmd, arg] = code.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/);
    const n = Number(arg);
    switch (cmd) {
      case 'penize':
      case 'money': {
        const amount = Number.isFinite(n) && n > 0 ? Math.min(n, 1e9) : 10000;
        this.arsenal.money += amount;
        return `Přidáno ${formatKc(amount)} (máš ${formatKc(this.arsenal.money)})`;
      }
      case 'zbrane':
        for (const w of ['pistol', 'smg', 'shotgun'] as const) {
          this.arsenal.owned.add(w);
          this.arsenal.ammo[w] += 500;
        }
        return 'Máš všechny zbraně a 500 nábojů do každé';
      case 'hvezdy': {
        const level = Math.max(0, Math.min(5, Number.isFinite(n) ? Math.round(n) : 0));
        if (!this.police) return 'Policie se ještě načítá';
        if (level === 0) this.police.clear();
        else {
          this.police.clear();
          this.police.report(level, 'cheat');
        }
        return `Hledanost: ${level ? '★'.repeat(level) : 'žádná'}`;
      }
      case 'tuning':
        if (!this.car) return 'Auto ještě není';
        Object.assign(this.car.tuning, { engine: 3, exhaust: 2, spoiler: true, lowered: true, neon: 0x2f7bff, rims: 0xc9a23a });
        this.car.applyTuning();
        return 'Plný tuning hotový';
      case 'oprava':
        if (!this.car) return 'Auto ještě není';
        this.car.setLook(this.car.look.color, this.car.look.type);
        this.car.applyTuning();
        return 'Auto je opravené';
      default:
        return 'Neznámý kód';
    }
  }

  /** Play pressed in the menu. */
  start() {
    if (this.mode === 'loading' && this.ready) this.setMode('foot');
  }

  /** Places on the map: gun shops (Z) and tuning garages (G). */
  private mapMarks(): MapMark[] {
    const marks: MapMark[] = this.chunks.entrancesNear(this.focus, 3000).map((e) => ({ pos: new THREE.Vector3(e.x, e.y, e.z), label: 'Z', color: '#f1c232' }));
    for (const e of this.chunks.entrancesNear(this.focus, 3000, 'garage')) marks.push({ pos: new THREE.Vector3(e.x, e.y, e.z), label: 'G', color: '#ff9a2e' });
    return marks;
  }

  /** A tuning garage close by (to show a hint while driving up to it). */
  get nearGarage(): boolean {
    return !!this.car && !this.garage.isOpen && this.chunks.entrancesNear(this.car.position, 14, 'garage').length > 0;
  }

  /** A store door within reach (on foot, outside). */
  get nearEntrance(): (StoreEntrance & { y: number }) | null {
    if (this.mode !== 'foot' || !this.player || this.insideStore) return null;
    return this.chunks.entrancesNear(this.player.position, 1.8)[0] ?? null;
  }

  private enterStore(e: StoreEntrance & { y: number }) {
    if (!this.interior || !this.player) return;
    this.insideStore = e;
    this.arsenal.current = null;
    this.interior.setName(e.name);
    this.player.teleport(this.interior.spawn.clone(), this.interior.spawnYaw);
    this.chase?.setYaw(this.interior.spawnYaw);
    this.say(`${e.name}: pult se zbraněmi je vzadu vpravo`, 4);
  }

  private leaveStore() {
    const e = this.insideStore;
    if (!e || !this.player) return;
    this.insideStore = null;
    this.shops?.close();
    const x = e.x + e.nx * 1.6, z = e.z + e.nz * 1.6;
    const yaw = Math.atan2(e.nx, e.nz);
    this.player.teleport(new THREE.Vector3(x, this.heights.sample(x, z) + 0.1, z), yaw);
    this.chase?.setYaw(yaw);
  }

  /** The nearest litter bin within reach (on foot). */
  get nearBin(): THREE.Vector3 | null {
    if (this.mode !== 'foot' || !this.player) return null;
    const bins = this.chunks.binsNear(this.player.position, 1.8);
    return bins[0] ?? null;
  }

  /** Searching a bin: sometimes money or a few bullets (each bin once every 2 minutes). */
  private searchBin() {
    const b = this.nearBin;
    if (!b) return;
    const key = `${b.x.toFixed(1)},${b.z.toFixed(1)}`;
    const now = performance.now() / 1000;
    if ((this.searchedBins.get(key) ?? 0) > now) {
      this.say('Tuhle popelnici už jsi prohledal');
      return;
    }
    this.searchedBins.set(key, now + 120);
    const r = Math.random();
    if (r < 0.45) {
      const amount = 10 + Math.round(Math.random() * 19) * 10;
      this.arsenal.money += amount;
      this.sound.pickup();
      this.say(`V popelnici: +${formatKc(amount)}`);
    } else if (r < 0.6) {
      this.arsenal.ammo.pistol += 12;
      this.say('V popelnici: 12 nábojů do pistole');
    } else this.say('Popelnice je prázdná');
  }

  /** Leaves a static copy of the current car (with a collider) where it stands. */
  private leaveCarBehind() {
    const car = this.car!, phys = this.physics!;
    const a = assets.cars?.[car.look.type];
    if (!a) return;
    const mesh = new THREE.InstancedMesh(a.hi, this.mats.parkedCars, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4().compose(car.position, car.quaternion, new THREE.Vector3(1, 1, 1)));
    mesh.setColorAt(0, new THREE.Color(car.look.color));
    mesh.computeBoundingSphere();
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    const q = car.quaternion;
    const collider = phys.world.createCollider(
      phys.R.ColliderDesc.cuboid(0.9, 0.45, a.halfLength - 0.05)
        .setTranslation(car.position.x, car.position.y + 0.1, car.position.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    this.leftCars.push({ mesh, collider });
    if (this.leftCars.length > 4) {
      const old = this.leftCars.shift()!;
      this.scene.remove(old.mesh);
      (old.mesh as THREE.InstancedMesh).dispose();
      phys.world.removeCollider(old.collider, false);
    }
  }

  /** Caught by the police: start again on foot at náměstí Republiky, the car beside you. */
  private busted() {
    if (!this.car || !this.player) return;
    const g = this.heights.sample(SPAWN.x, SPAWN.z);
    this.car.reset(new THREE.Vector3(SPAWN.x, g + 1.2, SPAWN.z), SPAWN.yaw);
    const door = new THREE.Vector3(2.2, 0, 0.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), SPAWN.yaw);
    const px = SPAWN.x + door.x, pz = SPAWN.z + door.z;
    this.player.teleport(new THREE.Vector3(px, this.heights.sample(px, pz) + 0.1, pz), SPAWN.yaw);
    this.player.setActive(true);
    this.chase?.setYaw(SPAWN.yaw);
    this.setMode('foot');
    // A fine, and the car comes back from the police repaired.
    const fine = Math.round(this.arsenal.money * 0.2);
    this.arsenal.money -= fine;
    this.arsenal.current = null;
    this.car.setLook(this.car.look.color, this.car.look.type);
    this.car.applyTuning();
    this.say(`ZATČEN! Pokuta ${formatKc(fine)}. Začínáš znovu na náměstí Republiky.`, 5);
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
    if (k.justPressed('KeyM') && !k.down('ShiftLeft', 'ShiftRight')) this.minimap?.toggle();
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
      else if (this.mode === 'foot' && this.canSteal) this.steal();
      else if (this.mode === 'foot' && this.nearEntrance) this.enterStore(this.nearEntrance);
      else if (this.mode === 'foot') this.searchBin();
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
    if (k.justPressed('KeyQ') && this.mode === 'foot') {
      const w = this.arsenal.cycle();
      this.say(w ? `${WEAPONS[w].name} (náboje ${this.arsenal.ammo[w]}) – střílej myší nebo E` : 'Zbraň schovaná');
    }
    if (k.justPressed('KeyU')) {
      settings.muted = !settings.muted;
      saveSettings();
      this.sound.setMuted(settings.muted);
      this.say(settings.muted ? 'Zvuk vypnut' : 'Zvuk zapnut');
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
      if (this.car && this.player && !this.paused) this.simulate(dt, ready);
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
    this.menu?.update();
    if (!this.paused) this.effects.update(dt);
    this.hud.update(dt);
    if (this.minimap && (this.mode === 'car' || this.mode === 'foot' || this.mode === 'fly')) {
      const yaw = this.mode === 'fly' ? this.fly.yaw + Math.PI : this.chase?.viewYaw ?? 0;
      this.minimap.update(this.focus, yaw, this.mode === 'foot' ? this.car?.position ?? null : null,
        this.police?.units.map((u) => u.pos) ?? [], this.police?.wanted ?? 0, this.mapMarks());
      this.minimap.canvas.hidden = !!this.insideStore;
    }
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
    // The town's AI pauses while the player is inside a store.
    if (groundReady && this.traffic && this.pedestrians && !this.insideStore) {
      const focus = this.focus;
      const obstacles = [{ x: car.position.x, z: car.position.z, radius: 2.2 }, ...this.pedestrians.obstacles()];
      if (player.isActive) obstacles.push({ x: player.position.x, z: player.position.z, radius: 0.6 });
      const pc = driving ? { position: car.position, yaw: car.yaw, speed: car.speed } : undefined;
      // A bug in the AI must never stop the whole game: log it and start the AI afresh.
      this.guard('traffic', () => this.traffic!.update(dt, focus, obstacles, pc), () => this.traffic!.reset());
      this.guard('pedestrians', () => this.pedestrians!.update(dt, focus, pc), () => this.pedestrians!.reset());
      const police = this.police;
      if (police) {
        const target = driving
          ? { position: car.position, speed: car.speed, inCar: true }
          : { position: player.position, speed: player.speed, inCar: false };
        this.guard('police', () => police.update(dt, target), () => police.clear());
      }
    }

    // Only simulate while the ground around the player exists.
    if (groundReady) {
      this.physics!.step(dt, (h) => {
        car.control(carInput, h);
        player.control(moveInput, h);
      });
    }
    const alpha = this.physics!.alpha;
    car.sync(dt, alpha);
    player.sync(dt, alpha);

    // Pistol: aim along the camera while on foot with the weapon out.
    const aiming = walking && this.weapon.equipped;
    player.aimYaw = aiming && this.chase ? this.chase.viewYaw : null;
    player.model.aiming = aiming;
    this.crosshair.hidden = !aiming;
    if (!walking) this.arsenal.current = null;
    this.weapon.update(dt, aiming && (this.mouseFire || k.down('KeyE')), {
      camera: this.camera, muzzle: aiming ? player.model.muzzle() : player.position, playerFeet: player.position,
      phys: this.physics!, exclude: player.body, pedestrians: this.pedestrians, traffic: this.traffic, police: this.police,
    });

    // Money on the ground, gun shops, smoke from a damaged car.
    const got = this.pickups.update(dt, driving ? car.position : player.position, driving ? 2.6 : 1.3, (x, z) => this.heights.sample(x, z));
    if (got) {
      this.arsenal.money += got;
      this.sound.pickup();
      this.say(`+${formatKc(got)}`);
    }
    // Tuning garage: stop in the orange ring in front of the door.
    const garageSpot = driving ? this.chunks.entrancesNear(car.position, 3.2, 'garage')[0] : undefined;
    if (garageSpot && Math.abs(car.speed) < 3) this.garage.open(garageSpot.name, car);
    else if (!garageSpot) this.garage.close();
    // Racing exhaust: pops and flames when you lift off the throttle at speed.
    if (driving && car.tuning.exhaust > 0 && this.lastThrottle > 0.5 && carInput.throttle < 0.1 && Math.abs(car.speed) > 12 && Math.random() < (car.tuning.exhaust === 2 ? 0.9 : 0.4)) {
      this.sound.backfire();
      if (car.tuning.exhaust === 2) this.effects.puff(new THREE.Vector3(0.45, -0.45, -car.model.halfLength - 0.1).applyQuaternion(car.quaternion).add(car.position));
    }
    this.lastThrottle = driving ? carInput.throttle : 0;

    // Inside a store: the gun counter opens the shop menu, the door ring takes you back out.
    const inside = this.interior && this.insideStore;
    if (inside && walking && this.interior!.near(player.position, this.interior!.counter, 1.4)) this.shops?.open(this.insideStore!.name);
    else this.shops?.close();
    if (inside && walking && this.interior!.near(player.position, this.interior!.exit, 1.0)) this.leaveStore();
    const dmg = car.model.damage;
    this.carSmoke.smoke = dmg > 0.45 ? Math.min(0.9, (dmg - 0.45) * 2) : 0;
    this.carSmoke.pos.set(0, 0.35, car.model.halfLength - 0.7).applyQuaternion(car.quaternion).add(car.position);

    // Sound: engine from throttle and speed, squeal from sideways slip.
    const lv = car.body.linvel();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(car.quaternion);
    this.sound.update(dt, {
      mode: this.mode, carSpeed: car.speed, throttle: carInput.throttle, slip: lv.x * right.x + lv.y * right.y + lv.z * right.z,
      footSpeed: walking ? player.speed : 0, exhaust: car.tuning.exhaust, grounded: player.physics.grounded, horn: driving && k.down('KeyK'),
      sirens: this.police?.sirens() ?? [], listener: this.camera,
    });

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
    // The menu's Play button starts the game once everything is compiled.
    this.warmUp().finally(() => (this.ready = true));
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
    for (const mat of [m.trees, m.props, m.jets, m.parkedCars, signMaterial()]) samples.add(new THREE.InstancedMesh(box, mat, 1));
    for (const mat of this.police?.warmMaterials ?? []) samples.add(new THREE.InstancedMesh(box, mat, 1), new THREE.Mesh(box, mat));
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
