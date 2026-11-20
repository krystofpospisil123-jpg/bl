// On-screen info: FPS, position, streaming stats, controls help.
import type { Game } from '../game/Game.ts';
import { VIEWPOINTS } from '../game/Game.ts';

export class Hud {
  private el: HTMLElement;
  private stats: HTMLElement;
  private frames = 0;
  private acc = 0;
  private fps = 0;

  constructor(private game: Game) {
    this.el = document.getElementById('hud')!;
    this.el.innerHTML = `
      <h1>Blansko: Open World <small>fáze 2 · prohlídka města</small></h1>
      <div id="stats"></div>
      <details id="help" open>
        <summary>Ovládání</summary>
        <div class="keys">
          <span>Klik</span><span>zamknout myš (Esc uvolní), nebo táhni myší</span>
          <span>W A S D</span><span>pohyb</span>
          <span>Mezerník / Q</span><span>nahoru / dolů</span>
          <span>Shift</span><span>rychleji</span>
          <span>Kolečko</span><span>základní rychlost</span>
          ${VIEWPOINTS.map((v, i) => `<span>${i + 1}</span><span>${v.name}</span>`).join('')}
          <span>O</span><span>stíny zap/vyp</span>
          <span>M</span><span>2D mapa dat</span>
        </div>
      </details>`;
    this.stats = this.el.querySelector('#stats')!;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') location.hash = 'mapa';
      if (e.code === 'KeyH') (this.el.querySelector('#help') as HTMLDetailsElement).open = !(this.el.querySelector('#help') as HTMLDetailsElement).open;
    });
  }

  update(dt: number) {
    this.frames++;
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    const g = this.game;
    const p = g.camera.position;
    const ground = g.heights.sample(p.x, p.z);
    const s = g.chunks.stats();
    const info = g.renderer.info.render;
    this.stats.innerHTML =
      `<b>${this.fps.toFixed(0)} fps</b> · ${info.calls} draw calls · ${(info.triangles / 1e6).toFixed(2)} M trojúhelníků<br>` +
      `x ${p.x.toFixed(0)} z ${p.z.toFixed(0)} · ${p.y.toFixed(0)} m n. m. (${(p.y - ground).toFixed(0)} m nad terénem) · rychlost ${g.controls.speed.toFixed(0)} m/s<br>` +
      `dlaždice ${s.loaded} (LOD ${s.lodCounts.join('/')})${s.queued ? ` · ve frontě ${s.queued}` : ''}`;
  }
}
