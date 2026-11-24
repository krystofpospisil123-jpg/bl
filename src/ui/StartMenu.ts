// Loading screen and main/pause menu: a progress bar while the town loads, then Play,
// Settings (graphics quality, sound, shop names), Controls and About. Esc pauses the game.
import type { Game } from '../game/Game.ts';
import { settings, saveSettings, type Quality } from '../config.ts';

const TIPS = [
  'Ukradni auto z provozu klávesou F a odvez ho do tuningové garáže (G na mapě).',
  'Zbraně a náboje prodávají vzadu v Kauflandu, Lidlu a Penny (Z na mapě).',
  'V popelnicích se občas najdou peníze nebo náboje.',
  'Policie tě ztratí, když jí na chvíli zmizíš z dohledu.',
  'M zvětší mapu, kliknutím na minimapu taky.',
  'Silný náraz auto promáčkne. Nový lak v garáži ho opraví.',
];

const KEYS: [string, string][] = [
  ['W A S D', 'chůze / jízda'], ['Myš', 'rozhlížení (klikni pro zachycení)'], ['Mezerník', 'skok / ruční brzda'],
  ['Shift', 'sprint'], ['F', 'nastoupit, ukrást auto, vstoupit, prohledat'], ['Q', 'zbraň (přepínání)'],
  ['Myš / E', 'střelba'], ['K', 'klakson'], ['R', 'postavit auto na kola'], ['M', 'velká mapa'],
  ['P', 'volná kamera'], ['G', 'kvalita grafiky'], ['U', 'zvuk'], ['Esc', 'pauza'],
];

export class StartMenu {
  readonly el = document.createElement('div');
  private bar: HTMLElement;
  private label: HTMLElement;
  private body: HTMLElement;
  private tip: HTMLElement;
  private shown: 'loading' | 'main' | 'settings' | 'keys' | 'about' | null = 'loading';
  private started = false;
  private tipIndex = Math.floor(Math.random() * TIPS.length);

  constructor(private game: Game) {
    this.el.id = 'start';
    this.el.innerHTML = `
      <div class="panel">
        <div class="logo"><span class="l1">BLANSKO</span><span class="l2">OPEN WORLD</span></div>
        <div class="loading"><div class="track"><div class="fill"></div></div><div class="label">Načítám…</div></div>
        <div class="body"></div>
        <p class="tip"></p>
      </div>
      <div class="credits">© přispěvatelé OpenStreetMap · Výškopis a ortofoto © ČÚZK</div>`;
    this.bar = this.el.querySelector('.fill')!;
    this.label = this.el.querySelector('.loading .label')!;
    this.body = this.el.querySelector('.body')!;
    this.tip = this.el.querySelector('.tip')!;
    this.tip.textContent = `Tip: ${TIPS[this.tipIndex]}`;
    document.body.append(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || !this.started) return;
      if (this.el.hidden) this.pause();
      else this.resume();
    });
  }

  get visible() {
    return !this.el.hidden;
  }

  /** Called every frame: progress while loading, the main menu once the town is ready. */
  update() {
    document.body.classList.toggle('menu-open', !this.el.hidden);
    if (this.shown === 'loading') {
      const p = this.game.loadProgress();
      this.bar.style.width = `${Math.round(p.value * 100)}%`;
      this.label.textContent = p.text;
      if (p.ready) this.show('main');
    }
  }

  pause() {
    this.game.paused = true;
    document.exitPointerLock?.();
    this.el.hidden = false;
    this.show('main');
  }

  resume() {
    this.game.paused = false;
    this.el.hidden = true;
    this.shown = null;
  }

  private show(view: 'main' | 'settings' | 'keys' | 'about') {
    this.shown = view;
    this.el.classList.add('ready');
    const back = '<button data-go="main" class="ghost">Zpět</button>';
    if (view === 'main') {
      this.body.innerHTML = `
        <button data-go="play" class="primary">${this.started ? 'Pokračovat' : 'Hrát'}</button>
        <button data-go="settings">Nastavení</button>
        <button data-go="keys">Ovládání</button>
        <button data-go="about">O hře</button>`;
    } else if (view === 'settings') {
      const q = (v: Quality, n: string) => `<button data-q="${v}" class="${settings.quality === v ? 'on' : ''}">${n}</button>`;
      this.body.innerHTML = `
        <h3>Grafika</h3><div class="row">${q('low', 'Nízká')}${q('medium', 'Střední')}${q('high', 'Vysoká')}</div>
        <h3>Zvuk</h3><div class="row"><button data-sound class="${settings.muted ? '' : 'on'}">${settings.muted ? 'Vypnutý' : 'Zapnutý'}</button></div>
        <h3>Názvy obchodů</h3><div class="row"><button data-names class="${settings.realNames ? 'on' : ''}">${settings.realNames ? 'Skutečné' : 'Obecné'}</button></div>
        ${back}`;
    } else if (view === 'keys') {
      this.body.innerHTML = this.game.touch
        ? `<p class="text">Vlevo joystick pro pohyb, tažením prstem se rozhlížíš. Tlačítka vpravo se mění podle situace
            (nastoupit, ukrást auto, vstoupit, střílet…). Menu vpravo nahoře, mapa se zvětší klepnutím.</p>${back}`
        : `<div class="keys">${KEYS.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('')}</div>${back}`;
    } else {
      this.body.innerHTML = `
        <p class="text">Hra v otevřeném světě skutečného Blanska, postavená z veřejných dat: budovy, silnice a řeka
        z OpenStreetMap, terén a letecké snímky z ČÚZK. Auta a postavy jsou vlastní modely z Blenderu,
        zvuky se syntetizují v prohlížeči. Všechna jména obchodů jsou jen popisky bez log.</p>${back}`;
    }
    this.body.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => this.click(b)));
  }

  private click(b: HTMLButtonElement) {
    const d = b.dataset;
    if (d.go === 'play') {
      this.el.hidden = true;
      this.shown = null;
      if (!this.started) {
        this.started = true;
        this.game.start();
      } else this.resume();
      return;
    }
    if (d.go) return this.show(d.go as 'main');
    if (d.q) this.game.pipeline.set(d.q as Quality, false);
    if (d.sound !== undefined) {
      settings.muted = !settings.muted;
      saveSettings();
      this.game.sound.setMuted(settings.muted);
    }
    if (d.names !== undefined) {
      settings.realNames = !settings.realNames;
      saveSettings();
      this.game.chunks.rebuildSigns();
    }
    this.show('settings');
  }
}
