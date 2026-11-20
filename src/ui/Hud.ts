// On-screen info: speedometer, controls help per mode, performance stats.
import type { Game, Mode } from '../game/Game.ts';
import { VIEWPOINTS } from '../game/viewpoints.ts';

const HELP: Record<Mode, [string, string][]> = {
  loading: [['', 'Načítám město a fyziku…']],
  foot: [
    ['W A S D', 'chůze (směr podle kamery)'],
    ['Shift', 'sprint'],
    ['Mezerník', 'skok'],
    ['F', 'nastoupit do auta (stůj u něj)'],
    ['Myš', 'rozhlížení (klik zamkne myš)'],
    ['P', 'volná kamera'],
  ],
  car: [
    ['W / S', 'plyn / brzda, couvání'],
    ['A / D', 'zatáčení'],
    ['Mezerník', 'ruční brzda'],
    ['R', 'postavit auto na kola'],
    ['F', 'vystoupit'],
    ['Myš', 'rozhlížení (klik zamkne myš)'],
    ['P', 'volná kamera'],
  ],
  fly: [
    ['W A S D', 'pohyb'],
    ['Mezerník / Q', 'nahoru / dolů'],
    ['Shift', 'rychleji'],
    ['Kolečko', 'základní rychlost'],
    ['Myš', 'rozhlížení (klik zamkne myš)'],
    ['P', 'vrátit se sem (pěšky i s autem)'],
    ...VIEWPOINTS.map((v, i): [string, string] => [String(i + 1), v.name]),
  ],
};

export class Hud {
  private stats: HTMLElement;
  private help: HTMLElement;
  private speedo: HTMLElement;
  private prompt: HTMLElement;
  private frames = 0;
  private acc = 0;
  private fps = 0;
  private shownMode?: Mode;

  constructor(private game: Game) {
    const el = document.getElementById('hud')!;
    el.innerHTML = `
      <h1>Blansko: Open World <small>fáze 4 · pěšky i autem</small></h1>
      <div id="stats"></div>
      <details id="help" open><summary>Ovládání</summary><div class="keys"></div>
        <div class="keys extra"><span>O</span><span>stíny zap/vyp</span><span>M</span><span>2D mapa dat</span><span>H</span><span>skrýt nápovědu</span></div>
      </details>`;
    this.stats = el.querySelector('#stats')!;
    this.help = el.querySelector('.keys')!;
    this.speedo = document.createElement('div');
    this.speedo.id = 'speedo';
    this.prompt = document.createElement('div');
    this.prompt.id = 'prompt';
    document.body.append(this.speedo, this.prompt);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') location.hash = 'mapa';
      if (e.code === 'KeyH') {
        const d = el.querySelector('#help') as HTMLDetailsElement;
        d.open = !d.open;
      }
    });
  }

  update(dt: number) {
    const g = this.game;
    if (this.shownMode !== g.mode) {
      this.shownMode = g.mode;
      this.help.innerHTML = HELP[g.mode].map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
    }
    const msg = g.notice || (g.canEnterCar ? 'F – nastoupit do auta' : '');
    if (this.prompt.textContent !== msg) this.prompt.textContent = msg;
    this.prompt.hidden = !msg;
    const driving = g.mode === 'car' && g.car;
    this.speedo.hidden = !driving;
    if (driving) {
      const kmh = Math.abs(g.car!.speed * 3.6);
      this.speedo.innerHTML = `<b>${kmh.toFixed(0)}</b><span>km/h</span>`;
    }

    this.frames++;
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    const p = g.focus;
    const s = g.chunks.stats();
    const info = g.renderer.info.render;
    this.stats.innerHTML =
      `<b>${this.fps.toFixed(0)} fps</b> · ${info.calls} draw calls · ${(info.triangles / 1e6).toFixed(2)} M trojúhelníků<br>` +
      `x ${p.x.toFixed(0)} z ${p.z.toFixed(0)} · ${p.y.toFixed(0)} m n. m.<br>` +
      `dlaždice ${s.loaded} (LOD ${s.lodCounts.join('/')})${s.queued ? ` · ve frontě ${s.queued}` : ''}`;
  }
}
