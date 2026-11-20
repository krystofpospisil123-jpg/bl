// Rendering pipeline with quality presets:
//  low    – no shadows, no post-processing, 1x resolution
//  medium – shadows, bloom, SMAA
//  high   – larger shadow map, ambient occlusion (GTAO), bloom, SMAA
// Starts at the saved preset and steps down automatically when the frame rate is too low.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import type { Environment } from './Environment.ts';
import { settings, saveSettings, type Quality } from '../config.ts';

export const QUALITY_LABEL: Record<Quality, string> = { low: 'nízká', medium: 'střední', high: 'vysoká' };
const ORDER: Quality[] = ['low', 'medium', 'high'];

export class Pipeline {
  quality: Quality;
  private composer?: EffectComposer;
  private gtao?: GTAOPass;
  private bloom?: UnrealBloomPass;
  private fpsSamples: number[] = [];
  private autoAdjusted = true; // enabled by the game once the world has loaded
  onQualityChange?: (q: Quality, auto: boolean) => void;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private env: Environment) {
    this.quality = settings.quality;
    this.apply();
  }

  cycle() {
    this.set(ORDER[(ORDER.indexOf(this.quality) + 1) % ORDER.length], false);
  }

  set(q: Quality, auto: boolean) {
    this.quality = q;
    settings.quality = q;
    saveSettings();
    this.apply();
    this.onQualityChange?.(q, auto);
  }

  private apply() {
    const r = this.renderer;
    const q = this.quality;
    const dpr = window.devicePixelRatio || 1;
    r.setPixelRatio(q === 'low' ? 1 : Math.min(dpr, q === 'high' ? 1.5 : 1.25));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.85;
    r.shadowMap.enabled = q !== 'low';
    this.env.sun.castShadow = q !== 'low';
    this.env.setShadowQuality(q === 'high' ? 4096 : 2048, q === 'high' ? 200 : 150);
    // Materials must recompile when shadows are toggled.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });

    this.composer?.dispose();
    this.composer = undefined;
    this.gtao = undefined;
    if (q === 'low') return;

    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const composer = new EffectComposer(r);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (q === 'high') {
      this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      this.gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.0, samples: 12 });
      this.gtao.blendIntensity = 0.85;
      composer.addPass(this.gtao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.15, 0.45, 1.0);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    composer.addPass(new SMAAPass());
    this.composer = composer;
    this.resize();
  }

  resize() {
    const r = this.renderer;
    const w = r.domElement.clientWidth, h = r.domElement.clientHeight;
    r.setSize(w, h, false);
    this.composer?.setPixelRatio(r.getPixelRatio());
    this.composer?.setSize(w, h);
  }

  render(dt: number) {
    // Count all passes of a frame in renderer.info (shown in the HUD).
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.watchFps(dt);
  }

  /** Steps the quality down once if the first seconds after loading run too slowly. */
  private watchFps(dt: number) {
    if (this.autoAdjusted || dt <= 0) return;
    this.fpsSamples.push(1 / dt);
    if (this.fpsSamples.length < 240) return;
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.fpsSamples = [];
    const idx = ORDER.indexOf(this.quality);
    if (avg < 32 && idx > 0) this.set(ORDER[idx - 1], true);
    else this.autoAdjusted = true; // fast enough: stop watching
  }

  /** Allows the automatic step-down to run again (e.g. after the player picks a preset). */
  resetAuto(enabled: boolean) {
    this.autoAdjusted = !enabled;
    this.fpsSamples = [];
  }
}
