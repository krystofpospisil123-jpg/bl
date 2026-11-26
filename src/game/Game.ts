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
import { Club, TIP_PRICE } from './Club.ts';
import { BarMenu, type Drink } from './BarMenu.ts';
import { Bowling, GAME_PRICE } from './Bowling.ts';
import { Garage } from './Garage.ts';
import { stockTuning } from '../vehicle/Tuning.ts';
import { StartMenu } from '../ui/StartMenu.ts';
import type { StoreEntrance } from '../world/builders/signs.ts';
import { Minimap, type MapMark } from '../ui/Minimap.ts';
import { Navigation, nextTurn, routeLength } from '../ui/Navigation.ts';
import { Phone } from '../ui/Phone.ts';
import { assets } from '../assets/models.ts';
import { Account, type GarageCar } from '../net/Account.ts';
import { Multiplayer, type NetState } from '../net/Multiplayer.ts';
import { HomeGarage, HOME_GARAGE, carTitle } from './HomeGarage.ts';
import type RAPIER from '@dimforge/rapier3d-compat';

/** Car spawn on náměstí Republiky (on the street, heading along it). */
const SPAWN = { x: -15.7, z: 184.2, yaw: -2.79 };
/** The police station (PČR, Na Řadech): where you are let go after an arrest, your car outside. */
const PHONE_PRICES = { tow: 600, heal: 400, lawyer: 1500 };
/** Keys the open phone takes (quick dial, keypad, back, shutter). */
const PHONE_KEYS = [...Array.from({ length: 10 }, (_, i) => `Digit${i}`), ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`), 'NumpadMultiply', 'Backspace', 'Enter', 'NumpadEnter'];
const STATION = { x: -24.6, z: -704, yaw: Math.PI / 2, carX: -21.8, carZ: -709, carYaw: Math.PI };
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
  club?: Club;
  bowling?: Bowling;
  readonly garage = new Garage(this.arsenal);
  readonly barMenu = new BarMenu(this.arsenal);
  /** Alcohol: 0 sober .. ~1.3 very drunk; wears off slowly. */
  drunk = 0;
  private drunkShown = 0;
  /** Login and the saved game (Supabase); the game works offline without it. */
  readonly account = new Account();
  readonly mp = new Multiplayer();
  readonly homeGarage: HomeGarage;
  /** Id of the garage car you are driving (null for a stolen or the starting car). */
  garageCarId: string | null = null;
  private saveClock = 0;
  private loadedSaveFor: string | null = null;
  private lastSavedCar = '';
  private lastAttacker: { nick: string; at: number } | null = null;
  private ramCooldown = new Map<string, number>();
  private lastThrottle = 0;
  private tmpSize = new THREE.Vector2();
  /** The player's health (0-100); at zero they are taken to hospital (wasted). */
  health = 100;
  /** Red screen flash after a hit (0-1, fades out). */
  hurtFlash = 0;
  private lastHurt = -1e9;
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
  private nav?: Navigation;
  private navClock = 0;
  /** Purple light column standing at the GPS waypoint. */
  private beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, 160, 20, 1, true).translate(0, 80, 0),
    new THREE.MeshBasicMaterial({ color: 0xb45cff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
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
        clubAction: () => this.clubAction, bowlingAction: () => this.bowlingAction, canEnterCar: () => this.canEnterCar, canSteal: () => this.canSteal, armed: () => this.weapon.equipped, nearBin: () => !!this.nearBin && !this.nearEntrance, nearEntrance: () => !!this.nearEntrance,
      });
    }
    this.scene.add(this.chunks.root);
    this.phone = this.createPhone();
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
    this.barMenu.onOrder = (d) => this.drinkUp(d);
    this.homeGarage = new HomeGarage(this.account, {
      current: () => ({ type: this.car?.look.type ?? 'liftback', color: this.car?.look.color ?? 0, garageId: this.garageCarId }),
      park: () => this.parkInGarage(),
      takeOut: (c) => this.takeOutCar(c),
      remove: async (c) => {
        if (c.id === this.garageCarId) return 'Tímhle autem právě jedeš, nejdřív vyjeď s jiným.';
        await this.account.removeCar(c.id);
        return `${carTitle(c)} vyhozeno z garáže.`;
      },
    });
    this.scene.add(this.homeGarage.group, this.mp.group);
    this.mp.onHit = (dmg, from, kind) => {
      this.lastAttacker = { nick: from, at: performance.now() };
      if (kind === 'car' && this.mode === 'foot') this.say(`${from} tě srazil!`);
      this.hurt(dmg);
    };
    this.mp.onKill = (victim, killer) => {
      if (killer === this.mp.nick) {
        this.arsenal.money += 250;
        this.sound.pickup();
        this.say(`Zabil jsi hráče ${victim} (+${formatKc(250)})`, 4);
      } else this.say(`${killer} zabil hráče ${victim}`, 3);
    };
    this.mp.onJoin = (nick) => this.say(`${nick} se připojil do hry`);
    this.mp.onLeave = (nick) => this.say(`${nick} odešel ze hry`);
    // Save when the tab is hidden or closed.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.saveGame();
    });
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
        this.pedestrians.maxPeds = 12;
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
        else {
          this.say(`Hledanost ${'★'.repeat(level)}`);
          if (level >= 2 && !this.warnedWanted) {
            this.warnedWanted = true;
            setTimeout(() => this.phone.message('Petr', 'Kámo, fízlové tě hledaj po celým Blansku! Zavolej advokáta, ať to smaže.', { color: '#8a5cf6', replies: ['Jsi blázen 😂', 'Hlavně se nenech chytit!'] }), 4000);
          }
        }
      };
      this.police.onBusted = () => this.busted();
      // Officers on foot shoot at the player; the player can shoot back.
      // Officers on foot use tasers: a hit knocks the player down so they can be cuffed.
      this.police.onTase = () => this.tase();
      this.police.onZap = (pos) => this.sound.zap(THREE.MathUtils.clamp(1 - pos.distanceTo(this.focus) / 40, 0.2, 1));
      this.police.onCopKilled = (pos) => this.pickups.drop(pos, 150 + Math.round(Math.random() * 10) * 20);
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
      this.shops.onMessage = (t) => {
        this.say(t);
        this.saveSoon();
      };
      this.garage.onMessage = (t) => this.say(t);
      this.garage.onChange = () => this.saveSoon();
      this.mp.setPhysics(p);
      this.homeGarage.place(this.heights.sample(HOME_GARAGE.x, HOME_GARAGE.z));
      this.interior = new Interior(p);
      this.club = new Club(p);
      this.bowling = new Bowling(p);
      this.bowling.onThrow = () => this.player?.model.bowl();
      this.bowling.onPins = (n, strike, spare) => {
        this.sound.crash(3 + n * 0.8);
        this.say(strike ? 'STRIKE! 🎳' : spare ? 'SPARE!' : n ? `Shozeno: ${n}` : 'Vedle…', 2.5);
      };
      this.bowling.onMessage = (t) => this.say(t, 5);
      this.scene.add(this.interior.group, this.club.group, this.bowling.group, this.bowling.world, this.pickups.group);
      this.minimap = new Minimap(graphs, world.manifest.halfExtent, this.touch ? 104 : 165);
      this.nav = new Navigation(graphs.drive);
      for (const d of this.chunks.loadedData()) this.minimap.paintChunk(d);
      this.chunks.onChunkData = (d) => this.minimap?.paintChunk(d);
      this.minimap.onWaypoint = (p) => {
        this.navClock = 99;
        this.beacon.visible = !!p;
        if (p) {
          this.beacon.position.set(p.x, this.heights.sample(p.x, p.z), p.z);
          this.sound.tone([880, 1320], 0.12, 0.05);
        }
      };
      this.beacon.visible = false;
      this.beacon.frustumCulled = false;
      this.scene.add(this.beacon);
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

  /** Where the town is streamed around: the door outside while in an interior. */
  get streamFocus(): THREE.Vector3 {
    const e = this.insideStore;
    if (e && this.mode !== 'fly') return this.tmpFocus.set(e.x, e.y, e.z);
    return this.focus;
  }

  private tmpFocus = new THREE.Vector3();

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
    this.garageCarId = null;
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
      case 'zdravi':
      case 'heal':
        this.health = 100;
        return 'Zdraví doplněno';
      case 'oprava':
        if (!this.car) return 'Auto ještě není';
        this.car.setLook(this.car.look.color, this.car.look.type);
        this.car.applyTuning();
        return 'Auto je opravené';
      default:
        return 'Neznámý kód';
    }
  }

  /** Multiplayer chosen in the menu (otherwise the game runs offline). */
  multiplayer = false;

  /** Play pressed in the menu: offline, or together with other players. */
  start(multiplayer: boolean) {
    if (this.mode !== 'loading' || !this.ready) return;
    this.setMode('foot');
    if (!this.loadedSaveFor) {
      this.loadedSaveFor = this.account.profile.id;
      this.applySave();
    }
    this.setMultiplayer(multiplayer);
    setTimeout(() => this.phone.message('Blansko·Net', 'Vítejte v síti Blansko·Net 5G! Telefon otevřete klávesou Tab.', { color: '#2f7bff' }), 3000);
    setTimeout(() => this.phone.message('Mamka', 'Ahoj, dojeď se ukázat, ať vím, že jsi v pořádku. A jezdi opatrně!', { color: '#d0569a', replies: ['To ráda slyším ❤️', 'Tak jo, pa pa!'] }), 15000);
    setTimeout(() => this.phone.message('Petr', 'Čau, jsi ve městě? Zbraně mají v obchodech se žlutým Z na mapě, auto vyladíš v garáži s G.', { color: '#8a5cf6', replies: ['Pohoda, kdyžtak volej.', 'Jo a prohledávej popelnice 😄'] }), 40000);
  }

  /** Places on the map: gun shops (Z) and tuning garages (G). */
  private mapMarks(): MapMark[] {
    const marks: MapMark[] = this.chunks.entrancesNear(this.focus, 3000).map((e) => ({ pos: new THREE.Vector3(e.x, e.y, e.z), label: 'Z', color: '#f1c232', name: e.name }));
    for (const e of this.chunks.entrancesNear(this.focus, 3000, 'garage')) marks.push({ pos: new THREE.Vector3(e.x, e.y, e.z), label: 'G', color: '#ff9a2e', name: e.name });
    marks.push({ pos: new THREE.Vector3(HOME_GARAGE.x, 0, HOME_GARAGE.z), label: 'D', color: '#34d17a', name: 'Moje garáž' });
    for (const e of this.chunks.entrancesNear(this.focus, 3000, 'bowling')) marks.push({ pos: new THREE.Vector3(e.x, e.y, e.z), label: 'B', color: '#ff8a2e', name: e.name });
    for (const e of this.chunks.entrancesNear(this.focus, 3000, 'club')) marks.push({ pos: new THREE.Vector3(e.x, e.y, e.z), label: 'K', color: '#ff4fb8', name: e.name });
    return marks;
  }

  /** A tuning garage close by (to show a hint while driving up to it). */
  get nearGarage(): boolean {
    return !!this.car && !this.garage.isOpen && this.chunks.entrancesNear(this.car.position, 14, 'garage').length > 0;
  }

  /** A store door within reach (on foot, outside). */
  get nearEntrance(): (StoreEntrance & { y: number }) | null {
    if (this.mode !== 'foot' || !this.player || this.insideStore) return null;
    const p = this.player.position;
    return this.chunks.entrancesNear(p, 1.8)[0] ?? this.chunks.entrancesNear(p, 1.8, 'club')[0] ?? this.chunks.entrancesNear(p, 2.2, 'bowling')[0] ?? null;
  }

  /** In the bowling hall, at the approach of the free lane (F starts a game). */
  get bowlingAction(): 'start' | 'playing' | null {
    if (this.insideStore?.kind !== 'bowling' || this.mode !== 'foot' || !this.player || !this.bowling) return null;
    if (this.bowling.active) return 'playing';
    return this.bowling.near(this.player.position, this.bowling.start, 2.2) ? 'start' : null;
  }

  private bowlingDo() {
    const b = this.bowling!;
    if (b.active) {
      b.quit();
      this.say('Hra ukončena');
      return;
    }
    if (this.arsenal.money < GAME_PRICE) {
      this.say(`Hra stojí ${formatKc(GAME_PRICE)}, tolik nemáš`);
      return;
    }
    this.arsenal.money -= GAME_PRICE;
    b.begin();
    this.say(`Hra za ${formatKc(GAME_PRICE)} (i s půjčením bot). Hodně štěstí!`, 3);
  }

  private enterBowling(e: StoreEntrance & { y: number }) {
    if (!this.bowling || !this.player) return;
    this.insideStore = e;
    this.arsenal.current = null;
    this.player.teleport(this.bowling.spawn.clone(), this.bowling.spawnYaw);
    this.chase?.setYaw(this.bowling.spawnYaw);
    this.say('Bowling Blansko: volná je dráha 6 – dojdi k ní a zmáčkni F', 5);
  }

  /** Inside the club: what F does here (order at the bar / tip at the stage). */
  get clubAction(): 'bar' | 'stage' | null {
    if (this.insideStore?.kind !== 'club' || this.mode !== 'foot' || !this.player || !this.club) return null;
    if (this.club.atBar(this.player.position)) return 'bar';
    if (this.club.atStage(this.player.position)) return 'stage';
    return null;
  }

  /** Ordered at the bar: the drinking animation, then the alcohol kicks in. */
  private drinkUp(d: Drink): string {
    this.player?.model.drink(d.color, d.glass);
    this.sound.pickup();
    this.say(`${d.name} – na zdraví!`, 3);
    setTimeout(() => {
      this.drunk = Math.min(1.4, this.drunk + d.strength);
      this.health = Math.min(100, this.health + 5);
      const msg = this.drunk > 1.05 ? 'Jsi úplně na mol!' : this.drunk > 0.7 ? 'Jsi pěkně opilý, svět se houpe' : this.drunk > 0.35 ? 'Trochu se ti točí hlava' : '';
      if (msg && d.strength) this.say(msg, 3);
      this.saveSoon();
    }, 2600);
    return '';
  }

  /** Drunk effects on the camera and the screen (every frame). */
  private drunkEffects(dt: number) {
    this.drunk = Math.max(0, this.drunk - dt * 0.0045);
    if (this.player) this.player.model.drunk = this.drunk;
    const d = this.drunk, t = timeUniform.value;
    if (d > 0.02 && (this.mode === 'foot' || this.mode === 'car')) {
      this.camera.rotateZ(Math.sin(t * 0.7) * 0.07 * d);
      this.camera.rotateX(Math.sin(t * 0.53 + 1) * 0.025 * d);
      this.camera.rotateY(Math.sin(t * 0.41) * 0.03 * d);
    }
    // Blur and a little colour shift (only touched when the level changes noticeably).
    const shown = Math.round(d * 20) / 20;
    if (shown !== this.drunkShown) {
      this.drunkShown = shown;
      this.canvas.style.filter = shown > 0.05 ? `blur(${(shown * 1.6).toFixed(2)}px) saturate(${(1 + shown * 0.5).toFixed(2)}) hue-rotate(${Math.round(shown * 12)}deg)` : '';
    }
  }

  private clubDo(a: 'bar' | 'stage') {
    if (a === 'bar') {
      if (this.player?.model.drinking) return;
      this.barMenu.open();
      return;
    }
    const price = TIP_PRICE;
    if (this.arsenal.money < price) {
      this.say(`Nemáš dost peněz (${formatKc(price)})`);
      return;
    }
    this.arsenal.money -= price;
    this.club!.tip(this.player!.position);
    this.sound.pickup();
    this.say(`Spropitné ${formatKc(price)} – tanečnice ti zamávala`, 3);
  }

  private enterClub(e: StoreEntrance & { y: number }) {
    if (!this.club || !this.player) return;
    this.insideStore = e;
    this.arsenal.current = null;
    this.player.teleport(this.club.spawn.clone(), this.club.spawnYaw);
    this.chase?.setYaw(this.club.spawnYaw);
    this.sound.setClubMusic(true);
    this.say(`${e.name}: bar je vpravo, pódium vepředu`, 4);
  }

  private enterStore(e: StoreEntrance & { y: number }) {
    if (e.kind === 'club') return this.enterClub(e);
    if (e.kind === 'bowling') return this.enterBowling(e);
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
    if (this.bowling?.active) this.bowling.quit();
    this.sound.setClubMusic(false);
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

  /** Caught by the police: driven to the police station, fined, your car parked outside. */
  private busted() {
    this.fadeTo('ZATČEN', 'Policie tě odváží na služebnu…', () =>
      this.respawn(0.2, STATION, (fine) => `Propuštěn ze služebny PČR na Řadech. Pokuta ${formatKc(fine)}, auto stojí venku.`));
    setTimeout(() => this.phone.message('Mamka', 'Volali mi z policie?! Co zase vyvádíš?? Okamžitě mi zavolej!', { color: '#d0569a', replies: ['No to si piš, že si promluvíme.', 'Já se z tebe zblázním.'] }), 7000);
  }

  /** Health ran out: wake up at náměstí Republiky, a bit poorer. */
  private wasted() {
    const a = this.lastAttacker;
    if (a && performance.now() - a.at < 5000) {
      this.mp.announceKill(a.nick);
      this.lastAttacker = null;
      setTimeout(() => this.say(`Zabil tě hráč ${a.nick}`, 4), 2600);
    }
    this.police?.clear();
    this.fadeTo('ZRANĚN', 'Záchranka tě veze do nemocnice…', () =>
      this.respawn(0.1, null, (fine) => `Propuštěn z nemocnice. Léčení stálo ${formatKc(fine)}.`));
    setTimeout(() => this.phone.message('Mamka', 'Pane bože, ty jsi byl v nemocnici?! Jsi v pořádku?', { color: '#d0569a', replies: ['Tak buď opatrnej, prosím tě.', 'Přinesu ti vývar.'] }), 7000);
  }

  /** Taser hit: the player drops (out of the car is impossible: officers never tase cars). */
  private tase() {
    if (this.mode !== 'foot' || this.stun > 0) return;
    this.stun = 4.5;
    this.arsenal.current = null;
    this.hurtFlash = 0.6;
    this.say('Zásah taserem! Nemůžeš se hýbat…', 3);
  }

  readonly phone: Phone;
  private carCalledAt = -1e9;
  private warnedWanted = false;

  /** Switches between offline and multiplayer (also after a nickname change). */
  setMultiplayer(on: boolean) {
    this.multiplayer = on;
    if (!on) {
      if (this.mp.id) this.say('Hraješ offline');
      this.mp.leave();
      return;
    }
    if (this.mode === 'loading') return;
    const id = this.account.netId, nick = this.account.netNick;
    if (this.mp.id !== id || this.mp.nick !== nick || !this.mp.online) {
      this.mp.join(id, nick);
      this.say(`Multiplayer: hraješ jako ${nick}`, 3);
    }
  }

  /** Puts the saved money, weapons, health, car and position into the game. */
  private applySave() {
    const p = this.account.profile, car = this.car!, player = this.player!;
    this.arsenal.money = p.money;
    this.arsenal.owned = new Set((p.weapons as string[]).filter((w): w is keyof typeof WEAPONS => w in WEAPONS));
    for (const w of Object.keys(this.arsenal.ammo) as (keyof typeof WEAPONS)[]) this.arsenal.ammo[w] = Math.max(0, Number(p.ammo?.[w]) || 0);
    this.arsenal.current = null;
    this.health = p.health > 5 ? p.health : 100;
    const saved = this.account.cars.find((c) => c.id === p.active_car);
    if (saved) this.useGarageCar(saved);
    this.lastSavedCar = this.carKey();
    if (p.pos) {
      const { x, z, yaw } = p.pos;
      const g = this.heights.sample(x, z);
      if (p.pos.inCar) {
        car.reset(new THREE.Vector3(x, Math.max(g, p.pos.y - 0.5) + 1.2, z), yaw);
        player.setActive(false);
        this.setMode('car');
      } else {
        player.teleport(new THREE.Vector3(x, Math.max(g, p.pos.y) + 0.1, z), yaw);
        const side = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw)).multiplyScalar(4);
        car.reset(new THREE.Vector3(x + side.x, this.heights.sample(x + side.x, z + side.z) + 1.2, z + side.z), yaw);
      }
      this.chase?.setYaw(yaw);
    }
    if (this.account.returning) setTimeout(() => this.say('Hra načtena, pokračuješ tam, kde jsi skončil.', 4), 3000);
  }

  /** Changes the car to one from the garage (look and tuning). */
  private useGarageCar(c: GarageCar) {
    const car = this.car!;
    car.setLook(c.color, c.type);
    car.tuning = { ...stockTuning(), ...c.tuning };
    car.applyTuning();
    this.garageCarId = c.id;
  }

  private carKey() {
    const c = this.car;
    return c ? JSON.stringify([c.look, c.tuning]) : '';
  }

  /** The current game state as stored in the profile. */
  private saveState() {
    const a = this.arsenal, onFoot = this.mode !== 'car';
    const e = this.insideStore;
    const src = this.mode === 'car' ? this.car! : this.player!;
    const pos = e ? { x: e.x + e.nx * 1.6, y: e.y, z: e.z + e.nz * 1.6, yaw: Math.atan2(e.nx, e.nz), inCar: false }
      : { x: src.position.x, y: src.position.y, z: src.position.z, yaw: src.yaw, inCar: !onFoot };
    return { money: Math.round(a.money), weapons: [...a.owned], ammo: { ...a.ammo }, health: Math.round(this.health), pos };
  }

  /** Saves the profile (and the tuning of the garage car you drive). */
  async saveGame() {
    this.saveClock = 0;
    if (!this.player || !this.car || this.mode === 'loading' || this.fading) return;
    const jobs: Promise<unknown>[] = [this.account.save({ ...this.saveState(), active_car: this.garageCarId })];
    const key = this.carKey();
    if (this.garageCarId && key !== this.lastSavedCar) {
      this.lastSavedCar = key;
      jobs.push(this.account.updateCar(this.garageCarId, { color: this.car.look.color, type: this.car.look.type, tuning: { ...this.car.tuning } }));
    }
    await Promise.all(jobs);
  }

  /** Save in a moment (after a purchase or tuning). */
  saveSoon() {
    this.saveClock = Math.max(this.saveClock, 18);
  }

  private async parkInGarage(): Promise<string> {
    const car = this.car!;
    const res = await this.account.addCar({ name: carTitle(car.look), type: car.look.type, color: car.look.color, tuning: { ...car.tuning } });
    if (typeof res === 'string') return res;
    this.garageCarId = res.id;
    this.lastSavedCar = this.carKey();
    await this.saveGame();
    return `${res.name} je zaparkované v garáži. Teď je tvoje.`;
  }

  private takeOutCar(c: GarageCar): string {
    if (!this.car) return '';
    const lost = !this.garageCarId;
    this.useGarageCar(c);
    this.lastSavedCar = this.carKey();
    this.saveSoon();
    return `Vyjíždíš s: ${carTitle(c)}.${lost ? ' Neuložené auto jsi nechal odtáhnout.' : ''}`;
  }

  /** Phone: a car from your garage is brought to the nearest road. */
  private deliverGarageCar(id: string): string {
    const c = this.account.cars.find((x) => x.id === id);
    if (!c || !this.car) return 'Auto nenalezeno.';
    if (this.mode === 'car') return 'Nejdřív vystup z auta.';
    if (this.insideStore) return 'Nejdřív vyjdi z obchodu.';
    if (this.police?.wanted) return 'Teď ne – hledá tě policie.';
    const before = { look: { ...this.car.look }, tuning: { ...this.car.tuning }, id: this.garageCarId };
    this.useGarageCar(c);
    const msg = this.callCar(false, true);
    if (!msg.startsWith('Auto přijelo')) {
      // Delivery failed: keep the car you had.
      this.car.setLook(before.look.color, before.look.type);
      this.car.tuning = before.tuning;
      this.car.applyTuning();
      this.garageCarId = before.id;
      return msg;
    }
    this.saveSoon();
    return `${carTitle(c)} přijelo kousek od tebe (je na mapě).`;
  }

  /** GPS: recompute the route now and then, show the next turn, detect arrival. */
  private updateNavigation(dt: number) {
    const mm = this.minimap, wp = mm?.waypoint;
    if (!mm || !wp || !this.nav) return;
    const p = this.focus;
    const left = Math.hypot(wp.x - p.x, wp.z - p.z);
    if (left < 18 && (this.mode === 'foot' || this.mode === 'car')) {
      mm.setWaypoint(null);
      this.say('Jsi v cíli 🏁', 3);
      this.sound.tone([660, 990], 0.18, 0.06);
      this.sound.tone([1320], 0.25, 0.05, 0.18);
      return;
    }
    this.navClock += dt;
    if (this.navClock < 1.2) return;
    this.navClock = 0;
    const r = this.nav.route(p.x, p.z, wp.x, wp.z, this.mode === 'car');
    mm.route = r;
    if (!r) {
      mm.gps = 'Cesta nenalezena';
      return;
    }
    const total = routeLength(r), turn = nextTurn(r);
    const fmt = (d: number) => (d < 1000 ? `${Math.max(10, Math.round(d / 10) * 10)} m` : `${(d / 1000).toFixed(1).replace('.', ',')} km`);
    mm.gps = turn.dir === 'arrive' || turn.dist > total - 25
      ? `Cíl za ${fmt(total)}`
      : `${turn.dir === 'left' ? '↰ vlevo' : '↱ vpravo'} za ${fmt(turn.dist)} · ${fmt(total)}`;
  }

  private otherPlayers(): THREE.Vector3[] {
    return [...this.mp.players.values()].map((p) => p.position);
  }

  /** What other players see of us. */
  private netState(): NetState | null {
    const car = this.car, pl = this.player;
    if (!car || !pl || this.insideStore || (this.mode !== 'foot' && this.mode !== 'car')) return null;
    if (this.mode === 'car') {
      const q = car.quaternion, t = car.tuning;
      return { m: 'car', p: [car.position.x, car.position.y, car.position.z], q: [q.x, q.y, q.z, q.w], s: car.speed, h: this.health, a: false,
        c: [car.look.type, car.look.color, t.rims, t.neon, t.spoiler, t.lowered] };
    }
    const q = pl.model.root.quaternion;
    return { m: 'foot', p: [pl.position.x, pl.position.y, pl.position.z], q: [q.x, q.y, q.z, q.w], s: pl.speed, h: this.health, a: pl.model.aiming };
  }

  private createPhone(): Phone {
    const lawyerInfo = () => (this.police?.wanted ? `smaže hledanost · ${formatKc(PHONE_PRICES.lawyer * this.police.wanted)}` : `smaže hledanost · ${formatKc(PHONE_PRICES.lawyer)} za hvězdu`);
    const pick = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)];
    return new Phone({
      contacts: [
        { name: 'Moje auto', number: '+420 604 118 302', letter: 'A', color: '#2f7bff', info: () => 'přijede na nejbližší silnici · zdarma', call: () => this.callCar(false) },
        { name: 'Odtahovka Blansko', number: '+420 516 412 600', letter: 'O', color: '#f2a530', info: () => `opraví auto a přiveze ho · ${formatKc(PHONE_PRICES.tow)}`, call: () => this.callCar(true) },
        { name: 'Záchranka', number: '155', letter: 'Z', color: '#e0453a', info: () => `doplní zdraví · ${formatKc(PHONE_PRICES.heal)}`, call: () => this.callAmbulance() },
        { name: 'Advokát JUDr. Novák', number: '+420 516 410 155', letter: '§', color: '#5b6573', info: lawyerInfo, call: () => this.callLawyer() },
        { name: 'Mamka', number: '+420 737 205 914', letter: 'M', color: '#d0569a', info: () => 'mobil',
          call: () => pick(['Ahoj, zlatíčko! Jíš pořádně?', 'Nemám teď čas, jsem v Kauflandu. Zavolám ti.', 'Hlavně ať tě zase nehledá policie, jo?', this.health < 60 ? 'Ty zníš nějak špatně. Zavolej si záchranku!' : 'Přijď v neděli na oběd, bude svíčková.']) },
        { name: 'Petr', number: '+420 721 664 087', letter: 'P', color: '#8a5cf6', info: () => 'kámoš · ví, kde co je',
          call: () => pick(['Čau! Zbraně koupíš v obchodech se žlutým Z na mapě.', 'Brácho, v garáži s oranžovým G ti vyladí auto.', 'Prohledej popelnice, lidi tam vyhazujou prachy.', 'Když tě honěj fízlové, zmiz jim z dohledu a ztratí tě.', 'Z rozhledny na Hořici je nejlepší výhled na celý Blansko.']) },
      ],
      numbers: {
        '155': { name: 'Záchranka', letter: 'Z', color: '#e0453a', call: () => this.callAmbulance() },
        '112': { name: 'Tísňová linka 112', letter: '!', color: '#e0453a', call: () => `Přepojuji na záchranku… ${this.callAmbulance()}` },
        '158': { name: 'Policie ČR', letter: 'P', color: '#2a4fa8', call: () => (this.police?.wanted ? 'Policie, prosím? … Počkejte, vy jste ten hledaný! Zůstaňte, kde jste.' : 'Policie ČR, Blansko. Nic nehlásíte? Tak neblokujte linku.') },
        '150': { name: 'Hasiči', letter: 'H', color: '#d9480f', call: () => 'Hasiči Blansko. Nic nehoří? Tak na shledanou.' },
        '156': { name: 'Městská policie', letter: 'M', color: '#2a4fa8', call: () => 'Městská policie Blansko, co potřebujete? Aha, nic. Dobře.' },
      },
      settings: [
        { label: 'Zvuk', value: () => !settings.muted, change: () => this.toggleSound() },
        { label: 'Provoz a chodci', value: () => this.traffic?.enabled ?? true, change: () => this.toggleTraffic() },
        { label: 'Stíny', value: () => this.env.sun.castShadow, change: () => (this.env.sun.castShadow = !this.env.sun.castShadow) },
        { label: 'Kvalita grafiky', value: () => QUALITY_LABEL[this.pipeline.quality], change: () => this.cycleQuality() },
        { label: 'Skutečné názvy obchodů', value: () => settings.realNames, change: () => this.toggleNames() },
      ],
      money: () => this.arsenal.money,
      charging: () => this.mode === 'car',
      weakSignal: () => !!this.insideStore,
      map: () => {
        if (!this.player || (this.mode !== 'foot' && this.mode !== 'car')) return null;
        return {
          pos: this.focus, yaw: this.chase?.viewYaw ?? 0, car: this.mode === 'foot' ? this.car?.position ?? null : null,
          police: this.police?.units.map((u) => u.pos) ?? [], wanted: this.police?.wanted ?? 0, marks: this.mapMarks(),
        };
      },
      setWaypoint: (p) => this.minimap?.setWaypoint(p),
      mapTap: (cv, x, y, range) => {
        if (!this.minimap) return;
        this.minimap.setWaypoint(Minimap.rectToWorld(cv, x, y, this.focus, range));
      },
      drawMap: (c, st, range) => this.minimap?.drawRect(c, st.pos, st.yaw, range, st.car, st.police, st.wanted, st.marks, this.otherPlayers()),
      garage: () => ({
        spaces: 5,
        cars: this.account.cars.map((c) => ({ id: c.id, title: carTitle(c), color: c.color, active: c.id === this.garageCarId })),
      }),
      deliverCar: (id) => this.deliverGarageCar(id),
      players: () => ({
        multiplayer: this.multiplayer, online: this.mp.online, me: this.mp.nick || this.account.netNick,
        list: [...this.mp.players.values()].map((p) => ({ nick: p.nick, dist: p.position.distanceTo(this.focus), inCar: p.mode === 'car', health: p.health })),
      }),
      view: this.canvas,
      tone: (f, sec, vol, delay) => this.sound.tone(f, sec, vol, delay),
      onToggle: (open) => {
        if (open) document.exitPointerLock?.();
      },
    });
  }

  private toggleSound() {
    settings.muted = !settings.muted;
    saveSettings();
    this.sound.setMuted(settings.muted);
    this.say(settings.muted ? 'Zvuk vypnut' : 'Zvuk zapnut');
  }

  private toggleTraffic() {
    if (!this.traffic || !this.pedestrians) return;
    this.traffic.enabled = this.pedestrians.enabled = !this.traffic.enabled;
    this.say(this.traffic.enabled ? 'Provoz zapnut' : 'Provoz vypnut');
  }

  private cycleQuality() {
    this.pipeline.cycle();
    this.pipeline.resetAuto(false);
  }

  private toggleNames() {
    settings.realNames = !settings.realNames;
    saveSettings();
    this.chunks.rebuildSigns();
    this.say(settings.realNames ? 'Skutečné názvy obchodů' : 'Obecné názvy obchodů');
  }

  /** Phone: brings your car to the nearest road around you (the tow truck also repairs it). */
  private callCar(tow: boolean, force = false): string {
    const car = this.car, player = this.player, graph = this.traffic?.graph;
    if (!car || !player || !graph) return 'Není signál…';
    if (this.mode === 'car') return 'Už sedíš v autě.';
    if (this.insideStore) return 'Nejdřív vyjdi z obchodu.';
    if (this.police?.wanted) return tow ? 'Odtahovka nepřijede, hledá tě policie.' : 'Teď ne – hledá tě policie.';
    if (tow) {
      if (this.arsenal.money < PHONE_PRICES.tow) return `Nemáš dost peněz (${formatKc(PHONE_PRICES.tow)}).`;
    } else if (!force) {
      if (car.position.distanceTo(player.position) < 30 && !car.flipped) return 'Auto stojí kousek od tebe.';
      if (performance.now() - this.carCalledAt < 20000) return 'Auto už je na cestě, počkej chvíli.';
    }
    // The road point 14-45 m away closest to 25 m, away from other cars.
    const p = player.position, t = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };
    let best: { x: number; y: number; z: number; yaw: number } | null = null, bestScore = Infinity;
    graph.edges.forEach((e, i) => {
      if (e.kind === 'track') return;
      const len = graph.length(i);
      const lane = { edge: i, dir: e.oneway && e.reverse ? -1 : 1 } as const;
      for (let s = 2; s < len - 2; s += 6) {
        graph.sample(lane, s, t);
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        if (d < 14 || d > 45) continue;
        const score = Math.abs(d - 25);
        if (score >= bestScore) continue;
        if (this.traffic!.cars.some((c) => Math.hypot(c.pos.x - t.x, c.pos.z - t.z) < 7)) continue;
        const x = t.x - t.dz * 1.6, z = t.z + t.dx * 1.6;
        const ground = this.heights.sample(x, z);
        best = { x, y: (t.y > ground + 1.5 ? t.y : ground) + 1.2, z, yaw: Math.atan2(t.dx, t.dz) };
        bestScore = score;
      }
    });
    if (!best) return 'Poblíž není žádná silnice, kam by auto mohlo přijet.';
    const b = best as { x: number; y: number; z: number; yaw: number };
    car.reset(new THREE.Vector3(b.x, b.y, b.z), b.yaw);
    this.carCalledAt = performance.now();
    if (tow) {
      this.arsenal.money -= PHONE_PRICES.tow;
      car.setLook(car.look.color, car.look.type);
      car.applyTuning();
      return `Odtahovka přivezla opravené auto (je na mapě). −${formatKc(PHONE_PRICES.tow)}`;
    }
    return 'Auto přijelo na silnici kousek od tebe (je na mapě).';
  }

  private callAmbulance(): string {
    if (this.health >= 100) return 'Jsi zdravý, záchranka nepřijede.';
    if (this.police?.wanted) return 'Záchranka nepřijede, dokud tě hledá policie.';
    if (this.arsenal.money < PHONE_PRICES.heal) return `Nemáš dost peněz (${formatKc(PHONE_PRICES.heal)}).`;
    this.arsenal.money -= PHONE_PRICES.heal;
    this.health = 100;
    return `Záchranka tě ošetřila. −${formatKc(PHONE_PRICES.heal)}`;
  }

  private callLawyer(): string {
    const w = this.police?.wanted ?? 0;
    if (!w) return 'Nic na tebe nemají.';
    const price = PHONE_PRICES.lawyer * w;
    if (this.arsenal.money < price) return `Advokát chce ${formatKc(price)}, tolik nemáš.`;
    this.arsenal.money -= price;
    this.police!.clear();
    return `Advokát to vyřídil, hledanost smazána. −${formatKc(price)}`;
  }

  /** Seconds the player lies on the ground after a taser hit. */
  stun = 0;
  private fading = false;

  /** Black screen with a title, runs `then` while it is dark, then fades back. */
  private fadeTo(title: string, text: string, then: () => void) {
    if (this.fading) return;
    this.fading = true;
    const el = document.getElementById('fade') ?? Object.assign(document.createElement('div'), { id: 'fade' });
    if (!el.parentElement) document.body.append(el);
    el.innerHTML = `<b>${title}</b><span>${text}</span>`;
    el.classList.add('on');
    setTimeout(() => {
      then();
      setTimeout(() => {
        el.classList.remove('on');
        this.fading = false;
      }, 1400);
    }, 1100);
  }

  /** Damages the player (shot, crash). Not while loading, flying or inside a store. */
  hurt(amount: number) {
    if (this.mode === 'loading' || this.mode === 'fly' || this.insideStore || this.health <= 0 || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.lastHurt = performance.now();
    this.hurtFlash = Math.min(1, this.hurtFlash + 0.25 + amount / 25);
    if (this.health <= 0) this.wasted();
  }

  private respawn(fineFraction: number, at: typeof STATION | null, text: (fine: number) => string) {
    if (!this.car || !this.player) return;
    this.stun = 0;
    this.player.stunned = false;
    let px: number, pz: number, yaw: number;
    if (at) {
      this.car.reset(new THREE.Vector3(at.carX, this.heights.sample(at.carX, at.carZ) + 1.2, at.carZ), at.carYaw);
      px = at.x; pz = at.z; yaw = at.yaw;
    } else {
      const g = this.heights.sample(SPAWN.x, SPAWN.z);
      this.car.reset(new THREE.Vector3(SPAWN.x, g + 1.2, SPAWN.z), SPAWN.yaw);
      const door = new THREE.Vector3(2.2, 0, 0.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), SPAWN.yaw);
      px = SPAWN.x + door.x; pz = SPAWN.z + door.z; yaw = SPAWN.yaw;
    }
    this.player.teleport(new THREE.Vector3(px, this.heights.sample(px, pz) + 0.1, pz), yaw);
    this.player.setActive(true);
    this.chase?.setYaw(yaw);
    this.setMode('foot');
    this.health = 100;
    this.hurtFlash = 0;
    // A fine, and the car comes back from the police repaired.
    const fine = Math.round(this.arsenal.money * fineFraction);
    this.arsenal.money -= fine;
    this.arsenal.current = null;
    this.car.setLook(this.car.look.color, this.car.look.type);
    this.car.applyTuning();
    this.say(text(fine), 5);
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
    if (k.justPressed('Tab') && (this.mode === 'foot' || this.mode === 'car')) this.phone.toggle();
    if (this.phone.isOpen) {
      // Digits, Enter and Backspace go to the phone (quick dial, keypad, back) instead of viewpoints.
      for (const code of PHONE_KEYS) if (k.justPressed(code)) this.phone.key(code);
      if (this.mode !== 'foot' && this.mode !== 'car') this.phone.toggle(false);
    } else VIEWPOINTS.forEach((v, i) => k.justPressed(v.key) && this.goTo(i));
    if (k.justPressed('KeyO')) this.env.sun.castShadow = !this.env.sun.castShadow;
    if (k.justPressed('KeyM') && !k.down('ShiftLeft', 'ShiftRight')) this.minimap?.toggle();
    if (k.justPressed('KeyP') && this.car) {
      if (this.mode === 'fly') this.landHere();
      else if (this.mode !== 'loading') {
        this.camera.fov = 60;
        this.setMode('fly');
      }
    }
    if (k.justPressed('KeyF') && this.stun <= 0) {
      if (this.mode === 'car') this.exitCar();
      else if (this.canEnterCar) this.enterCar();
      else if (this.bowlingAction) this.bowlingDo();
      else if (this.clubAction) this.clubDo(this.clubAction);
      else if (this.mode === 'foot' && this.canSteal) this.steal();
      else if (this.mode === 'foot' && this.nearEntrance) this.enterStore(this.nearEntrance);
      else if (this.mode === 'foot') this.searchBin();
    }
    if (k.justPressed('KeyR') && this.car && this.mode === 'car') this.car.reset(undefined, this.car.yaw);
    if (k.justPressed('KeyG')) this.cycleQuality();
    if (k.justPressed('KeyN')) this.toggleNames();
    if (k.justPressed('KeyQ') && this.mode === 'foot' && !this.bowling?.active) {
      const w = this.arsenal.cycle();
      this.say(w ? `${WEAPONS[w].name} (náboje ${this.arsenal.ammo[w]}) – střílej myší nebo E` : 'Zbraň schovaná');
    }
    if (k.justPressed('KeyU')) this.toggleSound();
    if (k.justPressed('KeyT')) this.toggleTraffic();
  }

  private frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    if (this.notice && performance.now() > this.noticeUntil) this.notice = '';
    this.handleKeys();

    // Inside a store, the club or the bowling the town streams around the door outside: the
    // halls stand on chunk borders, and following the player there would rebuild colliders and
    // pause physics every time they crossed one (the character stuttered).
    const focus = this.streamFocus;
    this.chunks.update(focus);

    if (this.physics) {
      // Colliders follow the player; the parked car keeps its own ground while nearby.
      const streamed = this.physics.updateStreaming(focus.x, focus.z, (cx, cz) => this.chunks.physicsSource(cx, cz));
      // Interior halls have their own permanent colliders.
      const ready = streamed || !!this.insideStore;
      if (!this.car && streamed && this.mode === 'loading') this.spawn();
      if (this.car && this.player && !this.paused) this.simulate(dt, ready);
    }

    if ((this.mode === 'car' || this.mode === 'foot') && this.chase) {
      const t = this.mode === 'car'
        ? { position: this.car!.position, yaw: this.car!.yaw, speed: this.car!.speed }
        : { position: this.player!.position, yaw: this.player!.yaw, speed: this.player!.speed };
      this.chase.update(t, dt);
      if (this.bowling?.active && this.mode === 'foot') this.bowling.placeCamera(this.camera);
    } else if (this.mode === 'fly') {
      this.fly.update(dt);
    } else {
      this.mouse.take();
    }

    this.drunkEffects(dt);
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
    this.phone.update();
    this.homeGarage.update(timeUniform.value);
    this.mp.update(dt, this.netState());
    if ((this.mode === 'foot' || this.mode === 'car') && (this.saveClock += dt) > 20) void this.saveGame();
    if (!this.paused) this.effects.update(dt, this.renderer.getDrawingBufferSize(this.tmpSize).y);
    this.hud.update(dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.4);
    // Slow recovery when nobody has hurt the player for a while.
    if (!this.paused && this.health > 0 && this.health < 100 && performance.now() - this.lastHurt > 8000) this.health = Math.min(100, this.health + dt * 2);
    if (this.minimap && (this.mode === 'car' || this.mode === 'foot' || this.mode === 'fly')) {
      const yaw = this.mode === 'fly' ? this.fly.yaw + Math.PI : this.chase?.viewYaw ?? 0;
      this.minimap.update(this.focus, yaw, this.mode === 'foot' ? this.car?.position ?? null : null,
        this.police?.units.map((u) => u.pos) ?? [], this.police?.wanted ?? 0, this.mapMarks(), this.otherPlayers());
      this.minimap.canvas.hidden = !!this.insideStore;
      this.minimap.health = this.health;
      this.updateNavigation(dt);
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
      steer: driving ? THREE.MathUtils.clamp((k.down('KeyA', 'ArrowLeft') ? 1 : 0) - (k.down('KeyD', 'ArrowRight') ? 1 : 0) - k.stick.x + Math.sin(timeUniform.value * 0.8) * 0.35 * Math.min(1.2, this.drunk), -1, 1) : 0,
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
      // Drunk: the walk veers from side to side.
      if (this.drunk > 0.05 && len > 0.1) {
        const tt = timeUniform.value, w = Math.sin(tt * 1.15 + Math.sin(tt * 0.37) * 2) * Math.min(1.2, this.drunk) * 0.75;
        const nx = mx - mz * w, nz = mz + mx * w, nl = Math.hypot(nx, nz) || 1;
        const keep = Math.min(1, Math.hypot(mx, mz));
        mx = (nx / nl) * keep;
        mz = (nz / nl) * keep;
      }
    }
    // Tased: lying on the ground, no control until they get up.
    this.stun = Math.max(0, this.stun - dt);
    player.stunned = this.stun > 0;
    if (player.stunned) mx = mz = 0;
    // Bowling: the player stands at the approach while aiming and throwing.
    const bowlingNow = this.insideStore?.kind === 'bowling' && this.bowling;
    if (bowlingNow) {
      this.bowling!.update(dt, {
        left: k.down('KeyA', 'ArrowLeft'), right: k.down('KeyD', 'ArrowRight'), aimL: k.down('KeyQ'), aimR: k.down('KeyE'), throwHeld: k.down('Space'),
      });
      if (this.bowling!.active) {
        mx = mz = 0;
        const s = this.bowling!.playerSpot();
        if (player.position.distanceTo(s.pos) > 0.05) player.teleport(s.pos, s.yaw);
        player.yaw = s.yaw;
      }
    }
    const playingBowling = !!bowlingNow && this.bowling!.active;
    const moveInput = { x: mx, z: mz, sprint: walking && !player.stunned && k.down('ShiftLeft', 'ShiftRight'), jump: walking && !player.stunned && !playingBowling && k.down('Space') };

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
          ? { position: car.position, speed: car.speed, inCar: true, stunned: false }
          : { position: player.position, speed: player.speed, inCar: false, stunned: player.stunned };
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
    const aiming = walking && this.weapon.equipped && !player.stunned;
    player.aimYaw = aiming && this.chase ? this.chase.viewYaw : null;
    player.model.aiming = aiming;
    this.crosshair.hidden = !aiming;
    if (!walking) this.arsenal.current = null;
    this.weapon.update(dt, aiming && (this.mouseFire || k.down('KeyE')), {
      camera: this.camera, muzzle: aiming ? player.model.muzzle() : player.position, playerFeet: player.position,
      phys: this.physics!, exclude: player.body, pedestrians: this.pedestrians, traffic: this.traffic, police: this.police,
      players: [...this.mp.players.values()].map((p) => ({
        pos: p.position, inCar: p.mode === 'car', hit: (dmg: number) => this.mp.hit(p.id, p.mode === 'car' ? dmg * 0.5 : dmg, 'shot'),
      })),
    });
    // Traffic signs have no collider: the car knocks them over (they stand up again later).
    if (driving && Math.abs(car.speed) > 2) {
      const lv2 = car.body.linvel();
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion);
      let fell = 0;
      for (const k of [-1.2, 0.3, 1.6]) {
        fell += this.chunks.knockSigns(car.position.x + fwd.x * k, car.position.z + fwd.z * k, 1.15, lv2.x, lv2.z);
      }
      if (fell) this.sound.crash(4);
    }
    this.chunks.updateSigns(dt);
    // Running over another player on foot.
    if (driving && Math.abs(car.speed) > 5) {
      const now = performance.now();
      for (const p of this.mp.players.values()) {
        if (p.mode !== 'foot' || (this.ramCooldown.get(p.id) ?? 0) > now) continue;
        if (Math.hypot(p.position.x - car.position.x, p.position.z - car.position.z) < 2.4 && Math.abs(p.position.y - car.position.y) < 2.5) {
          this.ramCooldown.set(p.id, now + 1200);
          this.mp.hit(p.id, Math.abs(car.speed) * 3.5, 'car');
        }
      }
    }
    // Home garage: stop in the green ring.
    if (driving && this.homeGarage.inRing(car.position)) {
      if (Math.abs(car.speed) < 3) this.homeGarage.open();
    } else this.homeGarage.leave();

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
    const inClub = this.insideStore?.kind === 'club' && this.club;
    const inside = this.interior && this.insideStore && !inClub && this.insideStore.kind !== 'bowling';
    if (inside && walking && this.interior!.near(player.position, this.interior!.counter, 1.4)) this.shops?.open(this.insideStore!.name);
    else this.shops?.close();
    if (inside && walking && this.interior!.near(player.position, this.interior!.exit, 1.0)) this.leaveStore();
    if (!inClub || !this.club!.atBar(player.position)) this.barMenu.close();
    if (this.insideStore?.kind === 'bowling' && walking && this.bowling!.near(player.position, this.bowling!.exit, 0.9)) this.leaveStore();
    if (inClub) {
      this.club!.update(dt);
      if (walking && this.club!.near(player.position, this.club!.exit, 0.9)) this.leaveStore();
    }
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
    // A hard crash hurts the driver.
    this.car.onCrash = (strength) => {
      if (this.mode === 'car') this.hurt(Math.min(60, Math.max(0, strength - 7) * 2.2));
    };
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
