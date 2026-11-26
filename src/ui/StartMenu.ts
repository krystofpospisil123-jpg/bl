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
  private shown: 'loading' | 'main' | 'settings' | 'keys' | 'about' | 'cheats' | 'login' | null = 'loading';
  private loginNote = '';
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
    // Refresh the account line when the login state changes (e.g. after the magic link).
    const prev = game.account.onChange;
    game.account.onChange = () => {
      prev?.();
      if (this.game.account.loggedIn) this.loginNote = '';
      if (this.shown === 'main' || this.shown === 'login') this.show(this.game.account.loggedIn ? 'main' : this.shown);
    };
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

  private accountHtml(): string {
    const acc = this.game.account;
    const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    if (!acc.ready) return '<p class="account">Ověřuji přihlášení…</p>';
    if (!acc.loggedIn) return '<button data-go="login">Přihlásit se</button><p class="note">Uložení hry, vlastní garáž a hra s ostatními</p>';
    if (!acc.profile) {
      return `<h3>Vyber si přezdívku</h3><input class="field nick" type="text" maxlength="16" placeholder="přezdívka (2–16 znaků)" autocomplete="nickname" spellcheck="false" />
        <button data-nick>Uložit přezdívku</button><p class="note ${this.loginNote.startsWith('!') ? 'err' : ''}">${esc(this.loginNote.replace(/^!/, '')) || esc(acc.email)}</p>`;
    }
    return `<p class="account">Hraješ jako <b>${esc(acc.profile.nickname)}</b> · <a data-logout>Odhlásit</a></p>`;
  }

  private show(view: 'main' | 'settings' | 'keys' | 'about' | 'cheats' | 'login') {
    this.shown = view;
    this.el.classList.add('ready');
    const back = '<button data-go="main" class="ghost">Zpět</button>';
    if (view === 'main') {
      this.body.innerHTML = `
        <button data-go="play" class="primary">${this.started ? 'Pokračovat' : 'Hrát'}</button>
        <button data-go="settings">Nastavení</button>
        <button data-go="keys">Ovládání</button>
        <button data-go="about">O hře</button>
        ${this.started ? '<button data-go="cheats">Cheaty</button>' : ''}
        ${this.accountHtml()}`;
    } else if (view === 'login') {
      const n = this.loginNote;
      this.body.innerHTML = `
        <h3>Přihlášení</h3>
        <p class="text small">Zadej e-mail, pošleme ti odkaz. Klikni na něj v tomhle prohlížeči a jsi přihlášený, žádné heslo.</p>
        <input class="field email" type="email" placeholder="tvuj@email.cz" autocomplete="email" spellcheck="false" />
        <button data-send class="primary">Poslat odkaz</button>
        <p class="note ${n.startsWith('!') ? 'err' : n ? 'ok' : ''}">${n.replace(/^!/, '').replace(/[<>&]/g, '')}</p>
        ${back}`;
      const input = this.body.querySelector<HTMLInputElement>('input.email')!;
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') void this.sendLink(input.value);
      });
      setTimeout(() => input.focus(), 50);
    } else if (view === 'cheats') {
      this.body.innerHTML = `
        <h3>Cheaty</h3>
        <input class="cheat" type="text" placeholder="napiš kód a Enter" autocomplete="off" spellcheck="false" />
        <p class="text small">
          <b>penize 50000</b> – přidá peníze (číslo si zvol)<br>
          <b>zbrane</b> – všechny zbraně a 500 nábojů do každé<br>
          <b>hvezdy 0–5</b> – nastaví hledanost (0 = policie tě nechá)<br>
          <b>tuning</b> – plný tuning auta (motor, výfuk, křídlo, neon…)<br>
          <b>oprava</b> – opraví auto
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
    this.body.querySelector('[data-logout]')?.addEventListener('click', () => {
      void this.game.saveGame().finally(() => this.game.account.signOut());
    });
    const nick = this.body.querySelector<HTMLInputElement>('input.nick');
    nick?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void this.saveNick(nick.value);
    });
  }

  private async sendLink(raw: string) {
    const email = raw.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.loginNote = '!Tohle nevypadá jako e-mail.';
      return this.show('login');
    }
    this.loginNote = 'Posílám…';
    this.show('login');
    const err = await this.game.account.sendLink(email);
    this.loginNote = err ? `!${err}` : `Odkaz je na cestě na ${email}. Otevři ho v tomhle prohlížeči (mrkni i do spamu).`;
    if (this.shown === 'login') this.show('login');
  }

  private async saveNick(raw: string) {
    const nick = raw.trim();
    if (nick.length < 2 || nick.length > 16) {
      this.loginNote = '!Přezdívka musí mít 2 až 16 znaků.';
      return this.show('main');
    }
    this.loginNote = '';
    const err = await this.game.createProfile(nick);
    this.loginNote = err ? `!${err}` : '';
    this.show('main');
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
    if (d.send !== undefined) return void this.sendLink(this.body.querySelector<HTMLInputElement>('input.email')?.value ?? '');
    if (d.nick !== undefined) return void this.saveNick(this.body.querySelector<HTMLInputElement>('input.nick')?.value ?? '');
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
