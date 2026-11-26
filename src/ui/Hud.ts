// On-screen info: speedometer, controls help per mode, performance stats.
import { TIP_PRICE } from '../game/Club.ts';
import type { Game, Mode } from '../game/Game.ts';
import { VIEWPOINTS } from '../game/viewpoints.ts';
import { QUALITY_LABEL } from '../render/Pipeline.ts';
import { WEAPONS, formatKc } from '../combat/Arsenal.ts';

const HELP: Record<Mode, [string, string][]> = {
  loading: [['', 'Načítám město a fyziku…']],
  foot: [
    ['W A S D', 'chůze (směr podle kamery)'],
    ['Shift', 'sprint'],
    ['Mezerník', 'skok'],
    ['F', 'nastoupit do auta / ukrást auto z provozu'],
    ['Q', 'zbraň: vytáhnout / další / schovat'],
    ['Myš / E', 'střelba'],
    ['F u popelnice', 'prohledat (peníze, náboje)'],
    ['Myš', 'rozhlížení (klik zamkne myš)'],
    ['Tab', 'telefon (hovory, zprávy, mapa, foťák…)'],
    ['P', 'volná kamera'],
  ],
  car: [
    ['W / S', 'plyn / brzda, couvání'],
    ['A / D', 'zatáčení'],
    ['Mezerník', 'ruční brzda'],
    ['R', 'postavit auto na kola'],
    ['K', 'klakson'],
    ['F', 'vystoupit'],
    ['Tab', 'telefon'],
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
  private wanted: HTMLElement;
  private money: HTMLElement;
  private ammo: HTMLElement;
  private health: HTMLElement;
  private healthFill: HTMLElement;
  private hurt: HTMLElement;
  private shownWanted = '';
  private frames = 0;
  private acc = 0;
  private fps = 0;
  private shownMode?: Mode;

  constructor(private game: Game) {
    const el = document.getElementById('hud')!;
    el.innerHTML = `
      <h1>Blansko: Open World <small>grafika a známá místa</small></h1>
      <div id="stats"></div>
      <details id="help" open><summary>Ovládání</summary><div class="keys"></div>
        <div class="keys extra"><span>G</span><span>kvalita grafiky</span><span>N</span><span>skutečné / obecné názvy obchodů</span><span>T</span><span>provoz a chodci zap/vyp</span><span>O</span><span>stíny zap/vyp</span><span>M</span><span>velká mapa (nebo klik na minimapu)</span><span>Shift+M</span><span>2D mapa dat</span><span>U</span><span>zvuk zap/vyp</span><span>H</span><span>skrýt nápovědu</span></div>
      </details>`;
    this.stats = el.querySelector('#stats')!;
    this.help = el.querySelector('.keys')!;
    this.speedo = document.createElement('div');
    this.speedo.id = 'speedo';
    this.prompt = document.createElement('div');
    this.prompt.id = 'prompt';
    this.wanted = document.createElement('div');
    this.wanted.id = 'wanted';
    this.money = document.createElement('div');
    this.money.id = 'money';
    this.ammo = document.createElement('div');
    this.ammo.id = 'ammo';
    this.health = document.createElement('div');
    this.health.id = 'health';
    this.health.innerHTML = '<div class="fill"></div><span></span>';
    this.healthFill = this.health.querySelector('.fill')!;
    this.hurt = document.createElement('div');
    this.hurt.id = 'hurt';
    document.body.append(this.speedo, this.prompt, this.wanted, this.money, this.ammo, this.health, this.hurt);
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'KeyM' && e.shiftKey) location.hash = 'mapa';
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
    const msg = g.notice || (g.mode === 'loading' ? g.loadingText : '') || (g.canEnterCar && !g.touch ? 'F – nastoupit do auta' : '') || (g.canSteal && !g.touch ? 'F – ukrást auto' : '') || (g.mode === 'car' && g.car && !g.homeGarage.isOpen && g.homeGarage.near(g.car.position) ? 'Zastav v zeleném kruhu – tvoje garáž' : '') || (g.mode === 'car' && g.nearGarage ? 'Zastav v oranžovém kruhu – tuning' : '') || (g.clubAction === 'bar' && !g.touch && !g.barMenu.isOpen ? 'F – bar: vybrat si drink' : '') || (g.clubAction === 'stage' && !g.touch ? `F – dát tanečnici spropitné (${TIP_PRICE} Kč)` : '') || (g.nearEntrance ? (g.touch ? `${g.nearEntrance.name} – tlačítko Vstoupit` : `F – vstoupit: ${g.nearEntrance.name}`) : '') || (g.nearBin ? (g.touch ? 'Popelnice – tlačítko Prohledat' : 'F – prohledat popelnici') : '');
    if (this.prompt.textContent !== msg) this.prompt.textContent = msg;
    this.prompt.hidden = !msg || !!g.menu?.visible;
    // Wanted stars (police chase), flashing while a police car sees you.
    const pol = g.police;
    const level = pol?.wanted ?? 0;
    const arrest = pol && pol.arrest > 0.2 ? `<span class="arrest">Zatýkání ${Math.min(100, (pol.arrest / pol.arrestTime) * 100).toFixed(0)} %</span>` : '';
    const html = level ? `${'★'.repeat(level)}<span class="off">${'★'.repeat(5 - level)}</span>${arrest}` : '';
    if (html !== this.shownWanted) {
      this.shownWanted = html;
      this.wanted.innerHTML = html;
    }
    this.wanted.hidden = !level;
    this.wanted.classList.toggle('flash', !!pol?.seen && level > 0);
    const money = formatKc(g.arsenal.money);
    if (this.money.textContent !== money) this.money.textContent = money;
    this.money.hidden = g.mode === 'loading';
    const hp = Math.ceil(g.health);
    this.health.hidden = g.mode !== 'foot' && g.mode !== 'car';
    this.healthFill.style.width = `${hp}%`;
    this.health.classList.toggle('low', hp <= 30);
    const label = this.health.querySelector('span')!;
    if (label.textContent !== String(hp)) label.textContent = String(hp);
    this.hurt.style.opacity = String(g.hurtFlash);
    const w = g.arsenal.current;
    this.ammo.hidden = g.mode !== 'foot' || !w;
    if (w) {
      const html = `<b>${g.arsenal.ammo[w]}</b><span>${WEAPONS[w].name}</span>`;
      if (this.ammo.innerHTML !== html) this.ammo.innerHTML = html;
    }
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
    if (g.touch) {
      // Phones: one compact line so the view stays clear.
      this.stats.innerHTML = `<b>${this.fps.toFixed(0)} fps</b> · ${QUALITY_LABEL[g.pipeline.quality]}`;
      return;
    }
    this.stats.innerHTML =
      `<b>${this.fps.toFixed(0)} fps</b> · kvalita ${QUALITY_LABEL[g.pipeline.quality]} · ${info.calls} draw calls · ${(info.triangles / 1e6).toFixed(2)} M trojúhelníků<br>` +
      `x ${p.x.toFixed(0)} z ${p.z.toFixed(0)} · ${p.y.toFixed(0)} m n. m.<br>` +
      `dlaždice ${s.loaded} (LOD ${s.lodCounts.join('/')})${s.queued ? ` · ve frontě ${s.queued}` : ''}` +
      (g.traffic ? ` · aut ${g.traffic.cars.length}, chodců ${g.pedestrians?.peds.length ?? 0}` : '');
  }
}
