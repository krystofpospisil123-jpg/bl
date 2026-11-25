// Game sound, synthesised with the Web Audio API (no recorded samples, so nothing to license):
// engine with gears, tyre squeal, crashes, horn, police sirens with distance and stereo
// position, footsteps and a quiet town ambience. Browsers only allow sound after the first
// key press or tap, so the audio context starts then.
import * as THREE from 'three';

export interface SoundState {
  mode: string;
  /** Player car: signed speed (m/s), throttle 0..1, sideways slip (m/s). */
  carSpeed: number;
  throttle: number;
  slip: number;
  /** On foot: walking speed (m/s) and whether the feet touch the ground. */
  footSpeed: number;
  /** Exhaust tuning: 0 stock, 1 sport, 2 racing (louder, deeper). */
  exhaust: number;
  grounded: boolean;
  horn: boolean;
  /** Police cars with sirens on. */
  sirens: THREE.Vector3[];
  listener: THREE.Camera;
}

export class Sound {
  muted = false;
  private ctx?: AudioContext;
  private master?: GainNode;
  private engine?: { osc: OscillatorNode; sub: OscillatorNode; filter: BiquadFilterNode; gain: GainNode };
  private squeal?: { gain: GainNode; filter: BiquadFilterNode };
  private ambience?: GainNode;
  private horn?: { gain: GainNode };
  private sirens: { osc: OscillatorNode; gain: GainNode; pan: StereoPannerNode }[] = [];
  private noise?: AudioBuffer;
  private stepClock = 0;
  private lastSpeed = 0;
  private sirenClock = 0;

  constructor(muted: boolean) {
    this.muted = muted;
    const start = () => {
      this.start();
      window.removeEventListener('keydown', start);
      window.removeEventListener('pointerdown', start);
    };
    window.addEventListener('keydown', start);
    window.addEventListener('pointerdown', start);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  private start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    void ctx.resume();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // White noise buffer shared by squeal, crashes, footsteps and ambience.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Engine: a sawtooth with a square sub-octave through a low-pass filter.
    const osc = ctx.createOscillator(), sub = ctx.createOscillator();
    osc.type = 'sawtooth';
    sub.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    osc.connect(filter);
    sub.connect(subGain).connect(filter);
    filter.connect(gain).connect(this.master);
    osc.start();
    sub.start();
    this.engine = { osc, sub, filter, gain };

    // Tyre squeal: band-passed noise.
    const sq = this.loopNoise();
    const sqf = ctx.createBiquadFilter();
    sqf.type = 'bandpass';
    sqf.frequency.value = 1900;
    sqf.Q.value = 9;
    const sqg = ctx.createGain();
    sqg.gain.value = 0;
    sq.connect(sqf).connect(sqg).connect(this.master);
    this.squeal = { gain: sqg, filter: sqf };

    // Town ambience: low rumble of distant traffic.
    const amb = this.loopNoise();
    const ambf = ctx.createBiquadFilter();
    ambf.type = 'lowpass';
    ambf.frequency.value = 320;
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.05;
    amb.connect(ambf).connect(this.ambience).connect(this.master);

    // Horn: two detuned square waves (a typical car horn chord).
    const hg = ctx.createGain();
    hg.gain.value = 0;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 2200;
    for (const f of [415, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(hf);
      o.start();
    }
    hf.connect(hg).connect(this.master);
    this.horn = { gain: hg };
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise!;
    src.loop = true;
    src.start(0, Math.random() * 1.5);
    return src;
  }

  /** Short filtered noise burst (crash, footstep). */
  private burst(volume: number, freq: number, length: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + length);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random());
    src.stop(t + length + 0.05);
  }

  /** A crash of the given strength (change of speed in m/s). */
  crash(strength: number) {
    if (!this.ctx) return;
    this.burst(Math.min(1, strength / 12), 900, 0.35 + Math.min(0.4, strength / 30));
    this.burst(Math.min(0.6, strength / 20), 3500, 0.12);
  }

  /** Pistol shot: a sharp crack and a lower boom. */
  gunshot(volume = 1) {
    if (!this.ctx) return;
    this.burst(0.9 * volume, 6000, 0.09);
    this.burst(0.7 * volume, 700, 0.3);
  }

  /** Car explosion: a deep boom with a long rumble. */
  explosion() {
    if (!this.ctx) return;
    this.burst(1, 250, 1.6);
    this.burst(0.8, 1800, 0.4);
  }

  /** Exhaust backfire: a sharp pop. */
  backfire() {
    if (!this.ctx) return;
    this.burst(0.7, 1200, 0.12);
    this.burst(0.4, 300, 0.2);
  }

  /** Picking up money: two quick rising beeps. */
  pickup() {
    const ctx = this.ctx;
    if (!ctx) return;
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.08;
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 0.15);
    });
  }

  /** Empty gun: a dry click. */
  click() {
    if (this.ctx) this.burst(0.25, 3000, 0.03);
  }

  /** Dull thud when a pedestrian is hit. */
  thud() {
    if (this.ctx) this.burst(0.7, 400, 0.25);
  }

  update(dt: number, s: SoundState) {
    const ctx = this.ctx;
    if (!ctx || !this.engine || !this.squeal || !this.horn) return;
    const t = ctx.currentTime;
    const driving = s.mode === 'car';

    // --- Engine: rpm from speed within the current gear.
    const v = Math.abs(s.carSpeed);
    const gears = [0, 7, 13, 20, 28, 37, 60];
    let gear = 1;
    while (gear < gears.length - 1 && v > gears[gear]) gear++;
    const lo = gears[gear - 1], hi = gears[gear];
    const rpm = 900 + (Math.min(1, (v - lo) / (hi - lo)) * 4800 + s.throttle * 600) * (gear === 1 ? 1 : 0.8);
    const f0 = rpm / 60 * 2; // four-stroke, four cylinders: two firings per turn
    this.engine.osc.frequency.setTargetAtTime(f0, t, 0.05);
    this.engine.sub.frequency.setTargetAtTime(f0 / 2, t, 0.05);
    this.engine.filter.frequency.setTargetAtTime(300 + s.throttle * 1400 + rpm * 0.12, t, 0.08);
    const loud = 1 + s.exhaust * 0.55;
    this.engine.gain.gain.setTargetAtTime(driving ? (0.07 + s.throttle * 0.08) * loud : 0, t, 0.1);
    this.engine.sub.frequency.setTargetAtTime(f0 / (s.exhaust ? 2.02 : 2), t, 0.05);

    // --- Tyre squeal when sliding sideways.
    const slip = driving ? Math.max(0, Math.abs(s.slip) - 2.5) : 0;
    this.squeal.gain.gain.setTargetAtTime(Math.min(0.25, slip * 0.04), t, 0.05);
    this.squeal.filter.frequency.setTargetAtTime(1600 + Math.min(800, v * 20), t, 0.1);

    // --- Crashes: a sudden loss of speed.
    if (driving) {
      const dv = this.lastSpeed - v;
      if (dv > 4) this.crash(dv);
    }
    this.lastSpeed = v;

    // --- Horn
    this.horn.gain.gain.setTargetAtTime(driving && s.horn ? 0.12 : 0, t, 0.02);

    // --- Footsteps
    if (s.mode === 'foot' && s.grounded && s.footSpeed > 0.5) {
      this.stepClock += dt * (s.footSpeed > 5 ? 3.2 : 1.9);
      if (this.stepClock >= 1) {
        this.stepClock = 0;
        this.burst(0.12 + Math.min(0.12, s.footSpeed * 0.02), 1400, 0.07);
      }
    } else this.stepClock = 0.6;

    // --- Police sirens: up to two, a rising and falling wail, louder when close, panned.
    this.sirenClock += dt;
    const cam = s.listener.position;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(s.listener.quaternion);
    const near = [...s.sirens].sort((a, b) => a.distanceTo(cam) - b.distanceTo(cam)).slice(0, 2);
    while (this.sirens.length < near.length) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      osc.connect(gain).connect(pan).connect(this.master!);
      osc.start();
      this.sirens.push({ osc, gain, pan });
    }
    this.sirens.forEach((sr, i) => {
      const p = near[i];
      if (!p) {
        sr.gain.gain.setTargetAtTime(0, t, 0.2);
        return;
      }
      const d = p.distanceTo(cam);
      const wail = 0.5 - 0.5 * Math.cos(((this.sirenClock + i * 0.7) / 2.2) * Math.PI * 2);
      sr.osc.frequency.setTargetAtTime(650 + wail * 700, t, 0.03);
      sr.gain.gain.setTargetAtTime(Math.min(0.14, 6 / (d + 10)), t, 0.1);
      const dir = p.clone().sub(cam).normalize();
      sr.pan.pan.setTargetAtTime(THREE.MathUtils.clamp(dir.dot(right), -0.9, 0.9), t, 0.1);
    });

    if (this.ambience) this.ambience.gain.setTargetAtTime(s.mode === 'fly' ? 0.02 : 0.05, t, 0.5);
  }
}
