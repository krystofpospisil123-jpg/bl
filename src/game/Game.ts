// Phase 2: 3D world with chunk streaming and a free-flying camera.
import * as THREE from 'three';
import type { WorldData } from '../world/WorldData.ts';
import { HeightField } from '../world/HeightField.ts';
import { ChunkManager } from '../world/ChunkManager.ts';
import { Materials } from '../render/materials.ts';
import { Environment, buildOverviewMesh } from '../render/Environment.ts';
import { FlyCamera } from '../controls/FlyCamera.ts';
import { Hud } from '../ui/Hud.ts';

/** Named viewpoints (world x, z, height above terrain, look-at x, z). */
export const VIEWPOINTS: { name: string; key: string; pos: [number, number, number]; look: [number, number] }[] = [
  { name: 'Náměstí Republiky', key: 'Digit1', pos: [70, 330, 40], look: [-70, 150] },
  { name: 'Zámek', key: 'Digit2', pos: [200, 40, 45], look: [50, -60] },
  { name: 'Nádraží', key: 'Digit3', pos: [360, 960, 45], look: [170, 1140] },
  { name: 'Nad městem', key: 'Digit4', pos: [800, -1150, 380], look: [0, 200] },
];

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.5, 6000);
  readonly heights: HeightField;
  readonly chunks: ChunkManager;
  readonly env: Environment;
  readonly controls: FlyCamera;
  private hud: Hud;
  private timer = new THREE.Timer();

  constructor(private canvas: HTMLCanvasElement, world: WorldData) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.heights = new HeightField(world.manifest);
    const mats = new Materials();
    this.env = new Environment(this.scene);
    this.chunks = new ChunkManager(world, this.heights, mats);
    this.scene.add(this.chunks.root);
    this.controls = new FlyCamera(this.camera, canvas, (x, z) => this.heights.sample(x, z));
    this.hud = new Hud(this);

    world.loadOverview().then((o) => {
      this.heights.setOverview(o);
      this.scene.add(buildOverviewMesh(world.manifest, o, mats.overview));
      this.goTo(0);
    });

    window.addEventListener('keydown', (e) => {
      const vp = VIEWPOINTS.findIndex((v) => v.key === e.code);
      if (vp >= 0) this.goTo(vp);
      if (e.code === 'KeyO') {
        this.env.sun.castShadow = !this.env.sun.castShadow;
      }
    });
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  goTo(i: number) {
    const v = VIEWPOINTS[i];
    const [x, z, above] = v.pos;
    this.camera.position.set(x, this.heights.sample(x, z) + above, z);
    this.controls.lookAt(new THREE.Vector3(v.look[0], this.heights.sample(v.look[0], v.look[1]) + 10, v.look[1]));
  }

  private resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.controls.update(dt);
    this.chunks.update(this.camera.position);
    this.env.update(this.camera, this.camera.position.y - this.heights.sample(this.camera.position.x, this.camera.position.z));
    this.renderer.render(this.scene, this.camera);
    this.hud.update(dt);
  }
}
