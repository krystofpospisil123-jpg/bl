// Game loop: streamed 3D world, Rapier physics, drivable car and a free camera.
import * as THREE from 'three';
import type { WorldData } from '../world/WorldData.ts';
import { HeightField } from '../world/HeightField.ts';
import { ChunkManager } from '../world/ChunkManager.ts';
import { Materials } from '../render/materials.ts';
import { Environment, buildOverviewMesh } from '../render/Environment.ts';
import { FlyCamera } from '../controls/FlyCamera.ts';
import { ChaseCamera } from '../controls/ChaseCamera.ts';
import { Input, MouseLook } from '../controls/Input.ts';
import { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { Car } from '../vehicle/Car.ts';
import { Hud } from '../ui/Hud.ts';
import { VIEWPOINTS } from './viewpoints.ts';


/** Car spawn on náměstí Republiky (on the street, heading along it). */
const SPAWN = { x: -15.7, z: 184.2, yaw: -2.79 };

export type Mode = 'loading' | 'car' | 'fly';

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
  mode: Mode = 'loading';
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
    this.hud = new Hud(this);

    // Start above the spawn point so the right chunks stream in while physics loads.
    this.camera.position.set(SPAWN.x + 30, 330, SPAWN.z + 30);
    world.loadOverview().then((o) => {
      this.heights.setOverview(o);
      this.scene.add(buildOverviewMesh(world.manifest, o, mats.overview));
      const g = this.heights.sample(SPAWN.x, SPAWN.z);
      this.camera.position.set(SPAWN.x - 12 * Math.sin(SPAWN.yaw), g + 5, SPAWN.z - 12 * Math.cos(SPAWN.yaw));
      this.fly.lookAt(new THREE.Vector3(SPAWN.x, g + 1, SPAWN.z));
    });
    PhysicsWorld.create(world.manifest).then((p) => {
      this.physics = p;
      this.chase = new ChaseCamera(this.camera, this.mouse, (x, z) => this.heights.sample(x, z), (o, d, max) =>
        p.castRay(o, d, max, this.car?.body),
      );
    });

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
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
    if (mode === 'car') this.chase?.snap();
  }

  /** Places the car on the terrain below (x, z), e.g. under the free camera. */
  dropCarAt(x: number, z: number, yaw: number) {
    if (!this.car) return;
    this.car.reset(new THREE.Vector3(x, this.heights.sample(x, z) + 1.5, z), yaw);
    this.setMode('car');
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
      if (this.mode === 'fly') {
        // Leaving the free camera drops the car where the camera is looking from.
        this.dropCarAt(this.camera.position.x, this.camera.position.z, this.fly.yaw + Math.PI);
      } else if (this.mode === 'car') this.setMode('fly');
    }
    if (k.justPressed('KeyR') && this.car && this.mode === 'car') this.car.reset(undefined, this.car.yaw);
  }

  private frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.handleKeys();

    const focus = this.mode === 'car' && this.car ? this.car.position : this.camera.position;
    this.chunks.update(focus);

    if (this.physics) {
      const ready = this.physics.updateStreaming(focus.x, focus.z, (cx, cz) => this.chunks.physicsSource(cx, cz));
      if (!this.car && ready && this.mode === 'loading') this.spawnCar();
      if (this.car) {
        const k = this.input;
        const driving = this.mode === 'car';
        const input = {
          throttle: driving && k.down('KeyW', 'ArrowUp') ? 1 : 0,
          brake: driving && k.down('KeyS', 'ArrowDown') ? 1 : 0,
          steer: driving ? (k.down('KeyA', 'ArrowLeft') ? 1 : 0) - (k.down('KeyD', 'ArrowRight') ? 1 : 0) : 0,
          handbrake: driving ? k.down('Space') : true,
        };
        // Only simulate while the ground under the car exists.
        if (ready) this.physics.step(dt, (h) => this.car!.control(input, h));
        this.car.sync(dt);
        // Safety net: fell through the world.
        if (this.car.position.y < this.heights.sample(this.car.position.x, this.car.position.z) - 10) {
          this.car.reset(new THREE.Vector3(this.car.position.x, this.heights.sample(this.car.position.x, this.car.position.z) + 2, this.car.position.z), this.car.yaw);
        }
      }
    }

    if (this.mode === 'car' && this.car && this.chase) {
      this.chase.update({ position: this.car.position, yaw: this.car.yaw, speed: this.car.speed }, dt);
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

  private spawnCar() {
    const g = this.heights.sample(SPAWN.x, SPAWN.z);
    this.car = new Car(this.physics!, new THREE.Vector3(SPAWN.x, g + 1.2, SPAWN.z), SPAWN.yaw);
    this.scene.add(this.car.model.root);
    this.setMode('car');
  }
}
