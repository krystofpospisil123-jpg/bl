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
  private shown: 'loading' | 'main' | 'settings' | 'keys' | 'about' | 'cheats' | 'nick' | null = 'loading';
  private nickNote = '';
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
      <aside class="news"><h4>NOVINKY</h4><ul>
        <li><i style="background:linear-gradient(135deg,#ff4fb8,#7a3cff)">♪</i><div><b>Velvet Club</b><span>Noční klub kousek od náměstí (K na mapě): bar, pódia a hudba.</span></div></li>
        <li><i style="background:linear-gradient(135deg,#ffb347,#ff6a1a)">☺</i><div><b>Nové postavy</b><span>Obličeje, účesy, oblečení a plynulé animace chůze i běhu.</span></div></li>
        <li><i style="background:linear-gradient(135deg,#63b3ff,#3a4fe8)">⇄</i><div><b>Multiplayer</b><span>Hraj s kamarády bez přihlašování.</span></div></li>
        <li><i style="background:linear-gradient(135deg,#4cd964,#1f8a4c)">⚠</i><div><b>Značky</b><span>Přejetá značka spadne a za chvíli ji zase postaví.</span></div></li>
      </ul></aside>
      <div class="credits">© přispěvatelé OpenStreetMap · Výškopis a ortofoto © ČÚZK</div>`;
    this.bar = this.el.querySelector('.fill')!;
    this.label = this.el.querySelector('.loading .label')!;
    this.body = this.el.querySelector('.body')!;
    this.tip = this.el.querySelector('.tip')!;
    this.tip.textContent = `Tip: ${TIPS[this.tipIndex]}`;
    document.body.append(this.el);
    // Phones have no Esc key: a "Pauza a cheaty" item in the touch menu opens this menu.
    const touchMenu = document.querySelector('.touch-menu');
    if (touchMenu) {
      const b = document.createElement('button');
      b.textContent = 'Pauza a cheaty';
      b.addEventListener('click', () => {
        (touchMenu as HTMLElement).hidden = true;
        if (this.started) this.pause();
      });
      touchMenu.append(b);
    }
    window.addEventListener('keydown', (e) => {
      // F2 or ; (the key left of 1 on a Czech keyboard) opens the cheat menu.
      if ((e.code === 'F2' || e.code === 'Backquote') && this.started && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.pause();
        this.show('cheats');
        return;
      }
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

  /** Nickname line (used in multiplayer). */
  private nickHtml(): string {
    const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    return `<p class="account">Přezdívka: <b>${esc(this.game.account.guestNick)}</b> · <a data-rename>změnit</a></p>`;
  }

  private static icon(name: 'gear' | 'keys' | 'info' | 'code' | 'solo' | 'mp'): string {
    const paths = {
      gear: '<circle cx="12" cy="12" r="6.2" fill="none" stroke="currentColor" stroke-width="3.4" stroke-dasharray="2.5 2.4"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>',
      keys: '<rect x="2" y="6" width="20" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 10h2M10 10h2M14 10h2M18 10h0M7 15h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      info: '<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v6M12 7.5v.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
      code: '<path d="M8 7 3 12l5 5M16 7l5 5-5 5M14 4l-4 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      solo: '<circle cx="12" cy="7.5" r="4" fill="currentColor"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z" fill="currentColor"/>',
      mp: '<circle cx="8.5" cy="7.5" r="3.6" fill="currentColor"/><path d="M1.5 20.5c0-4 3.1-7.2 7-7.2s7 3.2 7 7.2z" fill="currentColor"/><circle cx="17" cy="8.5" r="2.9" fill="currentColor" opacity=".75"/><path d="M15.6 13.4a6 6 0 0 1 6.9 5.9v1.2h-5c0-2.8-.6-5.2-1.9-7.1z" fill="currentColor" opacity=".75"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
  }

  private show(view: 'main' | 'settings' | 'keys' | 'about' | 'cheats' | 'nick') {
    this.shown = view;
    this.el.classList.add('ready');
    this.el.classList.toggle('home', view === 'main' && !this.started);
    const back = '<button data-go="main" class="ghost">Zpět</button>';
    if (view === 'main') {
      const mp = this.game.multiplayer;
      const play = this.started
        ? `<button data-go="play" class="primary">Pokračovat</button>
          <button data-switch class="mode-switch">${mp ? 'Přepnout na offline' : 'Přepnout na multiplayer'}</button>
          <p class="note">${mp ? `Hraješ v multiplayeru${this.game.mp.online ? ` · ${this.game.mp.players.size + 1} ve hře` : ' · připojuji…'}` : 'Hraješ offline'}</p>`
        : `<div class="modes"><button data-go="play" data-mp="0" class="primary mode">${StartMenu.icon('solo')}Offline<small>Hraješ sám, svým tempem</small></button>
          <button data-go="play" data-mp="1" class="primary mode mp">${StartMenu.icon('mp')}Multiplayer<small>Ve městě s ostatními hráči</small></button></div>`;
      const nav = (go: string, icon: Parameters<typeof StartMenu.icon>[0], label: string) => `<button data-go="${go}" class="nav"><i>${StartMenu.icon(icon)}</i>${label}<span>›</span></button>`;
      this.body.innerHTML = `
        ${play}
        ${this.nickHtml()}
        ${nav('settings', 'gear', 'Nastavení')}
        ${nav('keys', 'keys', 'Ovládání')}
        ${nav('about', 'info', 'O hře')}
        ${this.started ? nav('cheats', 'code', 'Cheaty') : ''}`;
    } else if (view === 'nick') {
      this.body.innerHTML = `
        <h3>Přezdívka</h3>
        <p class="text small">Pod tímhle jménem tě uvidí ostatní hráči v multiplayeru.</p>
        <input class="field nick" type="text" maxlength="16" value="${this.game.account.guestNick.replace(/"/g, '&quot;')}" autocomplete="nickname" spellcheck="false" />
        <button data-nick class="primary">Uložit</button>
        <p class="note err">${this.nickNote.replace(/[<>&]/g, '')}</p>
        ${back}`;
      setTimeout(() => this.body.querySelector<HTMLInputElement>('input.nick')?.select(), 50);
    } else if (view === 'cheats') {
      this.body.innerHTML = `
        <h3>Cheaty</h3>
        <input class="cheat" type="text" placeholder="napiš kód a Enter" autocomplete="off" spellcheck="false" />
        <p class="text small">
          <b>penize 50000</b> – přidá peníze (číslo si zvol)<br>
          <b>zbrane</b> – všechny zbraně a 500 nábojů do každé<br>
          <b>hvezdy 0–5</b> – nastaví hledanost (0 = policie tě nechá)<br>
          <b>tuning</b> – plný tuning auta (motor, výfuk, křídlo, neon…)<br>
          <b>oprava</b> – opraví auto<br>
          <b>rosso</b> / <b>gt</b> – sportovní auto
        </p>
        <p class="cheat-msg"></p>
        ${back}`;
      const input = this.body.querySelector<HTMLInputElement>('input.cheat')!;
      const msg = this.body.querySelector<HTMLElement>('.cheat-msg')!;
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key !== 'Enter') return;
        msg.textContent = this.game.cheat(input.value);
        input.value = '';
      });
      setTimeout(() => input.focus(), 50);
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
    this.body.querySelector('[data-rename]')?.addEventListener('click', () => {
      this.nickNote = '';
      this.show('nick');
    });
    const nick = this.body.querySelector<HTMLInputElement>('input.nick');
    nick?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.saveNick(nick.value);
    });
  }

  private saveNick(raw: string) {
    const nick = raw.trim().replace(/\s+/g, ' ');
    if (nick.length < 2 || nick.length > 16) {
      this.nickNote = 'Přezdívka musí mít 2 až 16 znaků.';
      return this.show('nick');
    }
    this.nickNote = '';
    this.game.account.setNick(nick);
    // Already playing online: rejoin under the new name.
    if (this.game.multiplayer && this.started) this.game.setMultiplayer(true);
    this.show('main');
  }

  private click(b: HTMLButtonElement) {
    const d = b.dataset;
    if (d.go === 'play') {
      this.el.hidden = true;
      this.shown = null;
      if (!this.started) {
        this.started = true;
        this.game.start(d.mp === '1');
      } else this.resume();
      return;
    }
    if (d.go) return this.show(d.go as 'main');
    if (d.nick !== undefined) return this.saveNick(this.body.querySelector<HTMLInputElement>('input.nick')?.value ?? '');
    if (d.switch !== undefined) {
      this.game.setMultiplayer(!this.game.multiplayer);
      return this.show('main');
    }
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
