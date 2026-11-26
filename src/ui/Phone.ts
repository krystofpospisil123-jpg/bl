// The player's smartphone (Tab, or the Telefon button). A home screen with apps:
//   Telefon    – contacts, recent calls and a keypad (155, 158, 112 work); calls ring, connect
//                and run a game action (bring your car, tow truck, ambulance, lawyer...)
//   Zprávy     – text messages from people in town (the game sends them on events)
//   Banka      – balance and a statement built from every change of your money
//   Mapa       – north-up map with your car, police and the nearest shops/garages
//   Fotoaparát – takes screenshots of the game; Galerie shows and downloads them
//   Počasí     – forecast for Blansko; Nastavení – game settings and wallpaper
// The phone only knows the game through the `PhoneHost` interface.
import type * as THREE from 'three';
import type { MapMark } from './Minimap.ts';

export interface PhoneContact {
  name: string;
  number: string;
  /** Avatar colour and initials. */
  color: string;
  letter: string;
  /** Short line under the name (price, what it does). */
  info: () => string;
  /** Runs when the other side picks up; returns what they say. */
  call: () => string;
}

export interface PhoneSetting {
  label: string;
  /** true/false shows a switch, a string shows a value that changes on tap. */
  value: () => boolean | string;
  change: () => void;
}

export interface PhoneMapState {
  pos: THREE.Vector3;
  yaw: number;
  car: THREE.Vector3 | null;
  police: THREE.Vector3[];
  wanted: number;
  marks: MapMark[];
}

export interface PhoneHost {
  contacts: PhoneContact[];
  /** Extra numbers for the keypad (emergency lines) -> what happens when you call them. */
  numbers: Record<string, { name: string; color: string; letter: string; call: () => string }>;
  settings: PhoneSetting[];
  money: () => number;
  /** Phone charging (in the car). */
  charging: () => boolean;
  /** Bad signal (inside a building). */
  weakSignal: () => boolean;
  map: () => PhoneMapState | null;
  drawMap: (canvas: HTMLCanvasElement, state: PhoneMapState, range: number) => void;
  /** The game's canvas (camera app). Read right after rendering. */
  view: HTMLCanvasElement;
  /** Plays sine tones together (ringback, keypad, notifications). */
  tone: (freqs: number[], seconds: number, volume?: number, delay?: number) => void;
  onToggle: (open: boolean) => void;
  /** Your garage (logged-in players). */
  garage: () => { spaces: number; cars: { id: string; title: string; color: number; active: boolean }[] };
  /** Has a garage car brought to the nearest road; returns the answer. */
  deliverCar: (id: string) => string;
  /** Other players online. */
  players: () => { multiplayer: boolean; online: boolean; me: string; list: { nick: string; dist: number; inCar: boolean; health: number }[] };
}

type Screen = 'home' | 'garage' | 'players' | 'phone' | 'call' | 'messages' | 'thread' | 'bank' | 'map' | 'camera' | 'gallery' | 'photo' | 'weather' | 'settings';

interface Message { text: string; time: Date; mine?: boolean }
interface Thread { name: string; color: string; msgs: Message[]; unread: number; replies?: string[] }
interface Call {
  name: string; number: string; color: string; letter: string;
  run: (() => string) | null;
  phase: 'dialing' | 'talking' | 'ended';
  start: number; connectAt: number; endAt: number; answer: string;
}

const WALLPAPERS = [
  'radial-gradient(circle at 20% 15%, #ff9f5a 0%, transparent 45%), radial-gradient(circle at 85% 80%, #3b6cff 0%, transparent 50%), linear-gradient(160deg, #2a1b4a, #0c1630)',
  'radial-gradient(circle at 70% 20%, #57e3c1 0%, transparent 45%), linear-gradient(170deg, #0b3a4a, #06121c)',
  'linear-gradient(180deg, #ffb36b 0%, #e2566b 40%, #45306f 75%, #141530 100%)',
  'radial-gradient(circle at 30% 30%, #3d5a3a, transparent 60%), linear-gradient(160deg, #1d2b1c, #0b100b)',
  'linear-gradient(160deg, #3a3f47, #121417)',
];
const WALL_KEY = 'blansko-phone-wallpaper';

const ICONS: Record<string, string> = {
  phone: '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/>',
  messages: '<path d="M12 3C6.5 3 2 6.6 2 11c0 2.4 1.3 4.6 3.4 6.1L4.5 21l4.3-2.3c1 .2 2.1.3 3.2.3 5.5 0 10-3.6 10-8s-4.5-8-10-8z"/>',
  bank: '<path d="M12 2 2 7v2h20V7zM4 11h3v7H4zm6.5 0h3v7h-3zM17 11h3v7h-3zM2 20h20v2H2z"/>',
  map: '<path fill-rule="evenodd" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"/>',
  camera: '<path fill-rule="evenodd" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3zm3 4.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z"/><circle cx="12" cy="13" r="3.4"/>',
  gallery: '<path fill-rule="evenodd" d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm1 13h14l-4.5-6-3.5 4.5-2.5-3z"/><circle cx="8" cy="8.5" r="1.8"/>',
  weather: '<circle cx="9" cy="8" r="4.2"/><path d="M8 20a4 4 0 0 1-.6-7.95A6 6 0 0 1 18.6 12 4 4 0 0 1 18 20z" stroke="#fff3" stroke-width=".8"/>',
  garage: '<path d="M12 2.5 1.5 9.5V22h21V9.5zM5 12h14v10h-2.2v-2.3H7.2V22H5zm2.2 2v1.4h9.6V14zm0 2.9v1.4h9.6v-1.4z"/>',
  players: '<circle cx="9" cy="7.5" r="3.6"/><path d="M1.8 20.5c0-4.1 3.2-7.4 7.2-7.4s7.2 3.3 7.2 7.4z"/><circle cx="17.2" cy="8.6" r="2.9"/><path d="M15.7 13.4a6 6 0 0 1 6.6 6v1.1h-4.6c0-2.8-.7-5.2-2-7.1z"/>',
  settings: '<circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="2.9 2.75"/><circle cx="12" cy="12" r="5.6" fill="none" stroke="currentColor" stroke-width="2.6"/>',
};

const APPS: { id: Screen; name: string; bg: string; icon: string }[] = [
  { id: 'garage', name: 'Garáž', bg: 'linear-gradient(160deg, #3fe08a, #15834a)', icon: 'garage' },
  { id: 'players', name: 'Hráči', bg: 'linear-gradient(160deg, #ffb347, #e8590c)', icon: 'players' },
  { id: 'bank', name: 'Banka', bg: 'linear-gradient(160deg, #19c37d, #0b7a52)', icon: 'bank' },
  { id: 'gallery', name: 'Galerie', bg: 'linear-gradient(160deg, #ffd34e, #ff7a59 60%, #c44bd6)', icon: 'gallery' },
  { id: 'weather', name: 'Počasí', bg: 'linear-gradient(170deg, #5cb4ff, #2765d8)', icon: 'weather' },
  { id: 'settings', name: 'Nastavení', bg: 'linear-gradient(160deg, #9aa3ae, #5b636d)', icon: 'settings' },
];
const DOCK: { id: Screen; name: string; bg: string; icon: string }[] = [
  { id: 'phone', name: 'Telefon', bg: 'linear-gradient(170deg, #5ef27a, #19b13d)', icon: 'phone' },
  { id: 'messages', name: 'Zprávy', bg: 'linear-gradient(170deg, #67e07f, #1fa83e)', icon: 'messages' },
  { id: 'map', name: 'Mapa', bg: 'linear-gradient(160deg, #ff6a5c, #d7263d)', icon: 'map' },
  { id: 'camera', name: 'Fotoaparát', bg: 'linear-gradient(170deg, #4a4f57, #1d2026)', icon: 'camera' },
];

const DAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
const DAYS_SHORT = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
const MONTHS = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
const MAP_RANGES = [120, 250, 500, 1000];
/** CZ ringback: 425 Hz, 1 s on, 4 s off. */
const RINGBACK = 425;
const DTMF: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477], '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477], '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[name]}</svg>`;
const hhmm = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
const kc = (n: number) => `${Math.round(n).toLocaleString('cs-CZ')} Kč`;

export class Phone {
  readonly el = document.createElement('div');
  isOpen = false;
  private screenEl = document.createElement('div');
  private view = document.createElement('div');
  private statusTime = document.createElement('span');
  private statusRight = document.createElement('span');
  private banner = document.createElement('div');
  private toast = document.createElement('div');
  private screen: Screen = 'home';
  private closedAt = 0;
  private phoneTab: 'fav' | 'recent' | 'keypad' = 'fav';
  private dialed = '';
  private call: Call | null = null;
  private callReturn: Screen = 'phone';
  private recents: { name: string; number: string; time: Date; ok: boolean; color: string; letter: string }[] = [];
  private threads: Thread[] = [];
  private thread: Thread | null = null;
  private bank: { label: string; amount: number; time: Date }[] = [];
  private lastMoney: number | null = null;
  private payLabel: { label: string; until: number } | null = null;
  private photos: { url: string; time: Date }[] = [];
  private photoIndex = 0;
  private shotPending = false;
  private mapRange = 1;
  private frame = 0;
  private battery = 64 + Math.floor(Math.random() * 30);
  private batteryClock = performance.now();
  private wallpaper = 0;
  private bannerUntil = 0;
  private toastUntil = 0;
  private statusKey = '';

  constructor(private host: PhoneHost) {
    try {
      this.wallpaper = Math.min(WALLPAPERS.length - 1, Number(localStorage.getItem(WALL_KEY)) || 0);
    } catch { /* storage unavailable */ }
    this.el.id = 'phone';
    this.el.innerHTML = '<div class="side" title="Zavřít (Tab)"></div>';
    this.screenEl.className = 'screen';
    const status = document.createElement('div');
    status.className = 'status';
    const island = document.createElement('i');
    island.className = 'island';
    this.statusRight.className = 'icons';
    status.append(this.statusTime, island, this.statusRight);
    this.view.className = 'view';
    this.banner.className = 'banner';
    const home = document.createElement('button');
    home.className = 'homebar';
    home.title = 'Domů (Backspace)';
    home.addEventListener('click', () => (this.screen === 'home' ? this.toggle(false) : this.go('home')));
    this.screenEl.append(this.view, status, this.banner, home);
    this.el.append(this.screenEl);
    this.el.querySelector('.side')!.addEventListener('click', () => this.toggle(false));
    this.toast.id = 'phone-toast';
    document.body.append(this.el, this.toast);
    // All taps inside the screen go through data-* attributes.
    this.view.addEventListener('click', (e) => this.onClick(e));
    this.banner.addEventListener('click', () => {
      this.banner.classList.remove('on');
      const t = this.threads[0];
      if (t) this.openThread(t);
    });
    this.toast.addEventListener('click', () => {
      this.toggle(true);
      const t = this.threads[0];
      if (t?.unread) this.openThread(t);
    });
    const fit = () => {
      const h = window.innerHeight, w = window.innerWidth;
      const s = Math.min(1, (h - 24) / 600, (w - 24) / 292);
      this.el.style.setProperty('--s', String(Math.max(0.5, s)));
    };
    window.addEventListener('resize', fit);
    fit();
    this.render();
  }

  // ---------------------------------------------------------------- public API

  toggle(open = !this.isOpen) {
    if (open === this.isOpen) return;
    this.isOpen = open;
    this.el.classList.toggle('open', open);
    if (open) {
      this.toast.classList.remove('on');
      // Back on the home screen after a while, like a real phone; a call stays on screen.
      if (!this.call && performance.now() - this.closedAt > 30000) this.screen = 'home';
      this.render();
    } else this.closedAt = performance.now();
    this.host.onToggle(open);
  }

  /** Quick dial: keys 1–4 call the first contacts (not while typing on the keypad). */
  press(i: number) {
    const c = this.host.contacts[i];
    if (!c || !this.isOpen || this.call) return;
    this.startCall(c.name, c.number, c.color, c.letter, c.call);
  }

  /** A key pressed while the phone is open. Returns true when the phone used it. */
  key(code: string): boolean {
    if (!this.isOpen) return false;
    const digit = /^(Digit|Numpad)(\d)$/.exec(code)?.[2];
    if (this.screen === 'phone' && this.phoneTab === 'keypad') {
      if (digit) return this.dial(digit), true;
      if (code === 'NumpadMultiply') return this.dial('*'), true;
      if (code === 'Enter' || code === 'NumpadEnter') return this.dialCall(), true;
      if (code === 'Backspace') {
        if (!this.dialed) return this.back(), true;
        this.dialed = this.dialed.slice(0, -1);
        this.render();
        return true;
      }
    }
    if (code === 'Backspace') return this.back(), true;
    if (code === 'Enter' && this.screen === 'camera') return (this.shotPending = true), true;
    if (digit && +digit >= 1 && +digit <= 4) return this.press(+digit - 1), true;
    return false;
  }

  /** A text message from someone in town. */
  message(from: string, text: string, opts: { color?: string; replies?: string[] } = {}) {
    let t = this.threads.find((x) => x.name === from);
    if (!t) {
      t = { name: from, color: opts.color ?? '#7a8594', msgs: [], unread: 0 };
    } else this.threads.splice(this.threads.indexOf(t), 1);
    if (opts.replies) t.replies = opts.replies;
    this.threads.unshift(t);
    t.msgs.push({ text, time: new Date() });
    const reading = this.isOpen && this.screen === 'thread' && this.thread === t;
    if (!reading) t.unread++;
    this.notify('Zprávy', from, text);
    // Only screens that show messages (or the unread badge) change; others keep running.
    if (this.isOpen && (this.screen === 'home' || this.screen === 'messages' || reading)) this.render();
  }

  /** Called every frame, right after the game has rendered. */
  update() {
    const now = performance.now();
    this.trackMoney(now);
    this.updateBattery(now);
    if (!this.isOpen) {
      if (this.toast.classList.contains('on') && now > this.toastUntil) this.toast.classList.remove('on');
      return;
    }
    this.frame++;
    this.updateStatus();
    if (this.banner.classList.contains('on') && now > this.bannerUntil) this.banner.classList.remove('on');
    if (this.call) this.updateCall(now);
    if (this.screen === 'map' && this.frame % 3 === 0) this.drawMap();
    if (this.screen === 'players' && this.frame % 60 === 0) this.render();
    if (this.screen === 'camera') this.drawViewfinder();
  }

  // ---------------------------------------------------------------- navigation

  private go(s: Screen) {
    if (this.call && this.call.phase !== 'ended' && s !== 'call') return;
    if (s === 'messages') this.thread = null;
    this.screen = s;
    this.render();
  }

  private back() {
    if (this.screen === 'call') return;
    if (this.screen === 'thread') return this.go('messages');
    if (this.screen === 'photo') return this.go('gallery');
    if (this.screen === 'home') return this.toggle(false);
    this.go('home');
  }

  private openThread(t: Thread) {
    this.thread = t;
    t.unread = 0;
    this.screen = 'thread';
    this.render();
  }

  private onClick(e: Event) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!t) return;
    const a = t.dataset.a!, v = t.dataset.v ?? '';
    switch (a) {
      case 'app': return this.go(v as Screen);
      case 'back': return this.back();
      case 'tab':
        this.phoneTab = v as typeof this.phoneTab;
        return this.render();
      case 'contact': {
        const c = this.host.contacts[+v];
        if (c) this.startCall(c.name, c.number, c.color, c.letter, c.call);
        return;
      }
      case 'redial': {
        const r = this.recents[+v];
        if (r) this.callNumber(r.number);
        return;
      }
      case 'key': return this.dial(v);
      case 'del':
        this.dialed = this.dialed.slice(0, -1);
        return this.render();
      case 'dial': return this.dialCall();
      case 'hangup': return this.hangUp();
      case 'thread': {
        const th = this.threads[+v];
        if (th) this.openThread(th);
        return;
      }
      case 'reply': return this.reply(v);
      case 'zoom':
        this.mapRange = Math.max(0, Math.min(MAP_RANGES.length - 1, this.mapRange + +v));
        return this.render();
      case 'shoot':
        this.shotPending = true;
        return;
      case 'photo':
        this.photoIndex = +v;
        return this.go('photo');
      case 'save': return this.savePhoto();
      case 'delete':
        this.photos.splice(this.photoIndex, 1);
        return this.go('gallery');
      case 'setting': {
        const s = this.host.settings[+v];
        s?.change();
        return this.render();
      }
      case 'deliver': {
        const answer = this.host.deliverCar(v);
        this.banner.innerHTML = `<b>Garáž</b><span>${esc(answer)}</span>`;
        this.banner.classList.add('on');
        this.bannerUntil = performance.now() + 4000;
        return this.render();
      }
      case 'wallpaper':
        this.wallpaper = (this.wallpaper + 1) % WALLPAPERS.length;
        try { localStorage.setItem(WALL_KEY, String(this.wallpaper)); } catch { /* ignore */ }
        return this.render();
    }
  }

  // ---------------------------------------------------------------- calls

  private dial(d: string) {
    if (this.dialed.length >= 13) return;
    this.dialed += d;
    const f = DTMF[d];
    if (f) this.host.tone(f, 0.12, 0.05);
    this.render();
  }

  private dialCall() {
    if (!this.dialed) {
      // Empty keypad: the green button fills in the last number, like on a real phone.
      if (this.recents[0]) this.dialed = this.recents[0].number.replace(/\s/g, '');
      return this.render();
    }
    this.callNumber(this.dialed);
    this.dialed = '';
  }

  private callNumber(raw: string) {
    const n = raw.replace(/[^\d*#+]/g, '');
    const contact = this.host.contacts.find((c) => c.number.replace(/[^\d+]/g, '').endsWith(n.replace(/^\+420/, '')) && n.length >= 9);
    if (contact) return this.startCall(contact.name, contact.number, contact.color, contact.letter, contact.call);
    const special = this.host.numbers[n];
    if (special) return this.startCall(special.name, n, special.color, special.letter, special.call);
    this.startCall(raw, raw, '#59616c', '#', () => 'Volané číslo neexistuje. The number you have dialled does not exist.');
  }

  private startCall(name: string, number: string, color: string, letter: string, run: () => string) {
    if (this.call && this.call.phase !== 'ended') return;
    const now = performance.now();
    if (this.screen !== 'call') this.callReturn = this.screen === 'home' ? 'phone' : this.screen;
    this.call = { name, number, color, letter, run, phase: 'dialing', start: now, connectAt: now + 1500 + Math.random() * 1200, endAt: 0, answer: '' };
    this.host.tone([RINGBACK], 1, 0.06, 0.15);
    this.screen = 'call';
    this.render();
  }

  private updateCall(now: number) {
    const c = this.call!;
    if (c.phase === 'dialing' && now >= c.connectAt) {
      c.phase = 'talking';
      c.answer = c.run ? c.run() : '';
      c.endAt = now + Math.max(3500, c.answer.length * 55);
      this.host.tone([660], 0.08, 0.05);
      this.logCall(c, true);
      this.render();
    } else if (c.phase === 'talking' && now >= c.endAt) {
      this.endCall();
    } else if (c.phase === 'ended' && now >= c.endAt) {
      this.call = null;
      if (this.screen === 'call') {
        this.screen = this.callReturn;
        this.render();
      }
    } else if (this.screen === 'call') {
      const timer = this.view.querySelector('.call-state');
      const text = c.phase === 'dialing' ? 'Vytáčím…' : this.callTime(now);
      if (timer && timer.textContent !== text) timer.textContent = text;
    }
  }

  private callTime(now: number) {
    const s = Math.floor((now - this.call!.connectAt) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  private hangUp() {
    const c = this.call;
    if (!c || c.phase === 'ended') return;
    if (c.phase === 'dialing') this.logCall(c, false);
    this.endCall();
  }

  private endCall() {
    const c = this.call!;
    c.phase = 'ended';
    c.endAt = performance.now() + 1300;
    this.host.tone([480, 620], 0.12, 0.04);
    this.render();
  }

  private logCall(c: Call, ok: boolean) {
    this.recents.unshift({ name: c.name, number: c.number, time: new Date(), ok, color: c.color, letter: c.letter });
    this.recents.length = Math.min(this.recents.length, 20);
    // A paid call shows up in the bank statement under the contact's name.
    if (ok) this.payLabel = { label: c.name, until: performance.now() + 1500 };
  }

  // ---------------------------------------------------------------- messages, bank, notifications

  private reply(text: string) {
    const t = this.thread;
    if (!t) return;
    t.msgs.push({ text, time: new Date(), mine: true });
    this.host.tone([1200], 0.06, 0.04);
    const answers = t.replies;
    t.replies = undefined;
    this.render();
    if (answers?.length) {
      // Some people answer back after a moment.
      const answer = answers[Math.floor(Math.random() * answers.length)];
      setTimeout(() => this.message(t.name, answer), 2500 + Math.random() * 2500);
    }
  }

  private notify(app: string, from: string, text: string) {
    this.host.tone([1046], 0.09, 0.05);
    this.host.tone([1568], 0.14, 0.05, 0.1);
    const html = `<b>${esc(app)} · ${esc(from)}</b><span>${esc(text)}</span>`;
    if (this.isOpen) {
      if (this.screen === 'thread' && this.thread?.name === from) return;
      this.banner.innerHTML = html;
      this.banner.classList.add('on');
      this.bannerUntil = performance.now() + 4000;
    } else {
      this.toast.innerHTML = `<i>${icon(app === 'Banka' ? 'bank' : 'messages')}</i><div>${html}</div>`;
      this.toast.classList.toggle('bank', app === 'Banka');
      this.toast.classList.add('on');
      this.toastUntil = performance.now() + 4500;
    }
  }

  /** Every change of the player's money becomes a line in the bank statement. */
  private trackMoney(now: number) {
    const m = this.host.money();
    if (this.lastMoney === null) {
      this.lastMoney = m;
      return;
    }
    const d = m - this.lastMoney;
    if (!d) return;
    this.lastMoney = m;
    const label = this.payLabel && now < this.payLabel.until ? this.payLabel.label : d > 0 ? 'Vklad hotovosti' : 'Platba kartou';
    this.payLabel = null;
    const last = this.bank[0];
    // Coins picked up one after another make a single deposit.
    if (last && d > 0 && last.amount > 0 && last.label === label && now - last.time.getTime() < 5000) last.amount += d;
    else this.bank.unshift({ label, amount: d, time: new Date() });
    this.bank.length = Math.min(this.bank.length, 40);
    if (d < 0 && -d >= 50) this.notify('Banka', label, `${kc(d)} · zůstatek ${kc(m)}`);
    if (this.isOpen && this.screen === 'bank') this.render();
  }

  private updateBattery(now: number) {
    const dt = (now - this.batteryClock) / 1000;
    if (dt < 1) return;
    this.batteryClock = now;
    if (this.host.charging()) this.battery = Math.min(100, this.battery + dt / 6);
    else this.battery = Math.max(9, this.battery - dt / (this.isOpen ? 45 : 120));
  }

  private updateStatus() {
    const d = new Date();
    const charging = this.host.charging();
    const bars = this.host.weakSignal() ? 1 : 4;
    const pct = Math.round(this.battery);
    const key = `${hhmm(d)}|${bars}|${pct}|${charging}`;
    if (key === this.statusKey) return;
    this.statusKey = key;
    this.statusTime.textContent = hhmm(d);
    const sig = [0, 1, 2, 3].map((i) => `<rect x="${i * 4.5}" y="${9 - i * 3}" width="3" height="${3 + i * 3}" rx="1" opacity="${i < bars ? 1 : 0.3}"/>`).join('');
    this.statusRight.innerHTML =
      `<svg class="sig" viewBox="0 0 17 12" fill="currentColor">${sig}</svg><small>${bars > 1 ? '5G' : 'E'}</small>` +
      `<span class="batt${pct <= 20 && !charging ? ' low' : ''}${charging ? ' chg' : ''}"><i style="width:${pct}%"></i><em>${pct}</em></span>`;
  }

  // ---------------------------------------------------------------- map, camera, gallery

  private drawMap() {
    const canvas = this.view.querySelector<HTMLCanvasElement>('canvas.map');
    const state = this.host.map();
    if (!canvas || !state) return;
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    this.host.drawMap(canvas, state, MAP_RANGES[this.mapRange]);
    if (this.frame % 30 === 0 || !this.view.querySelector('.places li')) this.listPlaces(state);
  }

  private listPlaces(state: PhoneMapState) {
    const ul = this.view.querySelector('.places');
    if (!ul) return;
    const dirs = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];
    const item = (color: string, label: string, name: string, p: THREE.Vector3) => {
      const dx = p.x - state.pos.x, dz = p.z - state.pos.z;
      const dist = Math.hypot(dx, dz);
      const dir = dirs[Math.round(((Math.atan2(dx, -dz) / (Math.PI * 2)) * 8 + 8)) % 8];
      return { dist, html: `<li><i style="background:${color}">${esc(label)}</i><span>${esc(name)}</span><b>${dist < 1000 ? `${Math.round(dist / 10) * 10} m` : `${(dist / 1000).toFixed(1)} km`} ${dir}</b></li>` };
    };
    const rows = state.marks.map((m) => item(m.color, m.label, m.name ?? '', m.pos));
    rows.sort((a, b) => a.dist - b.dist);
    if (state.car && state.car.distanceTo(state.pos) > 8) rows.unshift(item('#fff', '🚗', 'Moje auto', state.car));
    ul.innerHTML = rows.slice(0, 5).map((r) => r.html).join('') || '<li><span>Nic v okolí</span></li>';
  }

  private drawViewfinder() {
    const vf = this.view.querySelector<HTMLCanvasElement>('canvas.vf');
    const src = this.host.view;
    if (this.shotPending) {
      this.shotPending = false;
      this.takePhoto(src);
    }
    if (!vf || this.frame % 2) return;
    const w = vf.clientWidth, h = vf.clientHeight;
    if (vf.width !== w) { vf.width = w; vf.height = h; }
    const g = vf.getContext('2d')!;
    // The whole game view, letterboxed: what you see is what the photo gets.
    const s = Math.min(w / src.width, h / src.height);
    const dw = src.width * s, dh = src.height * s;
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    try {
      g.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } catch { /* canvas not readable this frame */ }
  }

  private takePhoto(src: HTMLCanvasElement) {
    const scale = Math.min(1, 1600 / src.width);
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * scale);
    c.height = Math.round(src.height * scale);
    const g = c.getContext('2d')!;
    try {
      g.drawImage(src, 0, 0, c.width, c.height);
    } catch {
      return;
    }
    // A small date stamp in the corner, like an old phone camera.
    const d = new Date();
    g.font = `600 ${Math.round(c.height / 34)}px system-ui, sans-serif`;
    g.fillStyle = 'rgba(255, 200, 80, 0.85)';
    g.textAlign = 'right';
    g.fillText(`Blansko · ${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} ${hhmm(d)}`, c.width - c.height / 40, c.height - c.height / 40);
    this.photos.unshift({ url: c.toDataURL('image/jpeg', 0.88), time: d });
    this.photos.length = Math.min(this.photos.length, 30);
    this.host.tone([2400], 0.03, 0.08);
    this.host.tone([1800], 0.05, 0.08, 0.07);
    const flash = this.view.querySelector('.flash');
    flash?.classList.remove('go');
    void (flash as HTMLElement | null)?.offsetWidth;
    flash?.classList.add('go');
    const thumb = this.view.querySelector<HTMLImageElement>('.last');
    if (thumb) {
      thumb.src = this.photos[0].url;
      thumb.hidden = false;
    }
  }

  private savePhoto() {
    const p = this.photos[this.photoIndex];
    if (!p) return;
    const a = document.createElement('a');
    const t = p.time;
    a.href = p.url;
    a.download = `blansko-${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}.jpg`;
    a.click();
  }

  // ---------------------------------------------------------------- rendering

  private render() {
    this.screenEl.style.setProperty('--wall', WALLPAPERS[this.wallpaper]);
    this.screenEl.dataset.screen = this.screen;
    this.view.innerHTML = this.html();
    this.statusKey = '';
    this.updateStatus();
    if (this.screen === 'map') {
      this.frame = 0;
      this.drawMap();
    }
    if (this.screen === 'thread') {
      const list = this.view.querySelector('.bubbles');
      if (list) list.scrollTop = list.scrollHeight;
    }
  }

  private header(title: string, back = 'Domů') {
    return `<header><button data-a="back">‹ ${back}</button><h2>${title}</h2></header>`;
  }

  private html(): string {
    switch (this.screen) {
      case 'home': return this.homeHtml();
      case 'phone': return this.phoneHtml();
      case 'call': return this.callHtml();
      case 'messages': return this.messagesHtml();
      case 'thread': return this.threadHtml();
      case 'bank': return this.bankHtml();
      case 'map':
        return `${this.header('Mapa')}<div class="mapwrap"><canvas class="map"></canvas><div class="zoom"><button data-a="zoom" data-v="-1">+</button><button data-a="zoom" data-v="1">−</button></div><span class="scale">${MAP_RANGES[this.mapRange] * 2 >= 1000 ? `${(MAP_RANGES[this.mapRange] * 2) / 1000} km` : `${MAP_RANGES[this.mapRange] * 2} m`}</span></div>` +
          '<h3>V okolí</h3><ul class="places"></ul>';
      case 'camera':
        return `<div class="cam"><canvas class="vf"></canvas><div class="grid"></div><div class="flash"></div>
          <div class="cam-bar"><button data-a="app" data-v="gallery" class="thumb"><img class="last" ${this.photos[0] ? `src="${this.photos[0].url}"` : 'hidden'} alt=""></button>
          <button class="shutter" data-a="shoot" title="Vyfotit (Enter)"></button><button data-a="back" class="cam-x">Hotovo</button></div></div>`;
      case 'gallery':
        return `${this.header('Galerie')}${this.photos.length
          ? `<div class="photos">${this.photos.map((p, i) => `<button data-a="photo" data-v="${i}"><img src="${p.url}" alt=""></button>`).join('')}</div>`
          : '<p class="empty">Zatím žádné fotky.<br>Vyfoť něco aplikací Fotoaparát.</p>'}`;
      case 'photo': {
        const p = this.photos[this.photoIndex];
        if (!p) return this.header('Fotka', 'Galerie');
        return `${this.header(`${p.time.getDate()}. ${p.time.getMonth() + 1}. ${hhmm(p.time)}`, 'Galerie')}<div class="photo"><img src="${p.url}" alt=""></div>
          <div class="photo-bar"><button data-a="save">Uložit do počítače</button><button data-a="delete" class="danger">Smazat</button></div>`;
      }
      case 'weather': return this.weatherHtml();
      case 'garage': return this.garageHtml();
      case 'players': return this.playersHtml();
      case 'settings': return this.settingsHtml();
    }
  }

  private appIcon(a: { id: Screen; name: string; bg: string; icon: string }, label: boolean) {
    const unread = a.id === 'messages' ? this.threads.reduce((n, t) => n + t.unread, 0) : 0;
    return `<button class="ic" data-a="app" data-v="${a.id}"><i style="background:${a.bg}">${icon(a.icon)}${unread ? `<em>${unread}</em>` : ''}</i>${label ? `<span>${a.name}</span>` : ''}</button>`;
  }

  private homeHtml() {
    const d = new Date();
    const w = forecast(d)[0];
    return `<div class="home">
      <div class="widget clock"><b>${hhmm(d)}</b><span>${DAYS[d.getDay()]} ${d.getDate()}. ${MONTHS[d.getMonth()]}</span></div>
      <button class="widget wx" data-a="app" data-v="weather"><span>Blansko</span><b>${w.temp}°</b><small>${w.icon} ${w.text}</small></button>
      <button class="widget money" data-a="app" data-v="bank"><span>Účet</span><b>${kc(this.host.money())}</b><small>Banka</small></button>
      <div class="grid">${APPS.map((a) => this.appIcon(a, true)).join('')}</div>
      <div class="dock">${DOCK.map((a) => this.appIcon(a, false)).join('')}</div>
    </div>`;
  }

  private phoneHtml() {
    let body = '';
    if (this.phoneTab === 'fav') {
      body = `<ul class="list">${this.host.contacts.map((c, i) => `<li><button data-a="contact" data-v="${i}">
        <i class="av" style="background:${c.color}">${esc(c.letter)}</i><span><b>${esc(c.name)}</b><small>${esc(c.info())}</small></span>
        ${i < 4 ? `<kbd>${i + 1}</kbd>` : ''}</button></li>`).join('')}</ul>`;
    } else if (this.phoneTab === 'recent') {
      body = this.recents.length
        ? `<ul class="list">${this.recents.map((r, i) => `<li><button data-a="redial" data-v="${i}">
          <i class="av" style="background:${r.color}">${esc(r.letter)}</i><span><b class="${r.ok ? '' : 'missed'}">${esc(r.name)}</b><small>${r.ok ? 'odchozí' : 'zrušený'} · ${esc(r.number)}</small></span><time>${hhmm(r.time)}</time></button></li>`).join('')}</ul>`
        : '<p class="empty">Žádné hovory</p>';
    } else {
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
      const sub: Record<string, string> = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ', 0: '+' };
      body = `<div class="keypad"><div class="dialed">${esc(this.dialed) || '<small>155 záchranka · 158 policie · 112</small>'}</div>
        <div class="keys">${keys.map((k) => `<button data-a="key" data-v="${k}"><b>${k}</b><small>${sub[k] ?? '&nbsp;'}</small></button>`).join('')}</div>
        <div class="keyrow"><span></span><button class="green" data-a="dial">${icon('phone')}</button>${this.dialed ? '<button class="del" data-a="del">⌫</button>' : '<span></span>'}</div></div>`;
    }
    const tab = (id: string, label: string) => `<button data-a="tab" data-v="${id}" class="${this.phoneTab === id ? 'on' : ''}">${label}</button>`;
    return `${this.header(this.phoneTab === 'fav' ? 'Kontakty' : this.phoneTab === 'recent' ? 'Nedávné' : 'Klávesnice')}<div class="body">${body}</div>
      <nav class="tabs">${tab('fav', 'Kontakty')}${tab('recent', 'Nedávné')}${tab('keypad', 'Klávesnice')}</nav>`;
  }

  private callHtml() {
    const c = this.call;
    if (!c) return '';
    const state = c.phase === 'dialing' ? 'Vytáčím…' : c.phase === 'talking' ? this.callTime(performance.now()) : 'Hovor ukončen';
    return `<div class="call ${c.phase}" style="--c:${c.color}">
      <i class="av big" style="background:${c.color}">${esc(c.letter)}</i>
      <h2>${esc(c.name)}</h2><p class="num">${esc(c.number)}</p><p class="call-state">${state}</p>
      ${c.answer ? `<div class="said">„${esc(c.answer)}“</div>` : ''}
      <div class="call-btns"><span><i>🔇</i>ztlumit</span><span><i>⌨︎</i>klávesnice</span><span><i>🔊</i>reproduktor</span></div>
      <button class="hang" data-a="hangup" ${c.phase === 'ended' ? 'disabled' : ''}>${icon('phone')}</button></div>`;
  }

  private messagesHtml() {
    if (!this.threads.length) return `${this.header('Zprávy')}<p class="empty">Žádné zprávy</p>`;
    return `${this.header('Zprávy')}<ul class="list threads">${this.threads.map((t, i) => {
      const m = t.msgs[t.msgs.length - 1];
      return `<li><button data-a="thread" data-v="${i}"><i class="av" style="background:${t.color}">${esc(t.name[0])}</i>
        <span><b>${esc(t.name)}</b><small>${m.mine ? 'Ty: ' : ''}${esc(m.text)}</small></span><time>${hhmm(m.time)}${t.unread ? '<em></em>' : ''}</time></button></li>`;
    }).join('')}</ul>`;
  }

  private threadHtml() {
    const t = this.thread;
    if (!t) return '';
    const quick = t.replies ? ['Jasně 👍', 'Teď nemůžu', 'Zavolám ti'] : ['👍', 'Díky'];
    return `${this.header(esc(t.name), 'Zprávy')}<div class="bubbles">${t.msgs.map((m) => `<p class="${m.mine ? 'me' : ''}">${esc(m.text)}<time>${hhmm(m.time)}</time></p>`).join('')}</div>
      <div class="quick">${quick.map((q) => `<button data-a="reply" data-v="${esc(q)}">${esc(q)}</button>`).join('')}</div>`;
  }

  private bankHtml() {
    const money = this.host.money();
    const out = this.bank.filter((b) => b.amount < 0).reduce((s, b) => s - b.amount, 0);
    return `${this.header('Banka')}<div class="card"><small>Běžný účet · Blanenská spořitelna</small><b>${kc(money)}</b><span>•••• 4218</span><em>VISA</em></div>
      <p class="spent">Dnes utraceno <b>${kc(out)}</b></p><h3>Pohyby na účtu</h3>
      ${this.bank.length ? `<ul class="list tx">${this.bank.map((b) => `<li><div><i class="av" style="background:${b.amount > 0 ? '#1fa463' : '#5b6573'}">${b.amount > 0 ? '+' : '−'}</i>
        <span><b>${esc(b.label)}</b><small>${hhmm(b.time)}</small></span><b class="${b.amount > 0 ? 'plus' : ''}">${b.amount > 0 ? '+' : ''}${kc(b.amount)}</b></div></li>`).join('')}</ul>` : '<p class="empty">Zatím žádné pohyby</p>'}`;
  }

  private garageHtml() {
    const g = this.host.garage();
    const rows = g.cars.map((c) => `<li><div><i class="av" style="background:#${c.color.toString(16).padStart(6, '0')}">🚗</i>
      <span><b>${esc(c.title)}</b><small>${c.active ? 'tohle auto máš venku' : 'v garáži'}</small></span>
      <button class="pill" data-a="deliver" data-v="${c.id}">Přistavit</button></div></li>`).join('');
    return `${this.header('Garáž')}<div class="body"><p class="garage-sum">${g.cars.length} / ${g.spaces} míst obsazeno</p>
      ${g.cars.length ? `<ul class="list">${rows}</ul>` : '<p class="empty">Garáž je prázdná.</p>'}
      <p class="empty small">Auto zaparkuješ v zeleném kroužku u své garáže (D na mapě). Přistavení je zdarma.</p></div>`;
  }

  private playersHtml() {
    const p = this.host.players();
    if (!p.multiplayer) return `${this.header('Hráči')}<p class="empty">Hraješ offline.<br>Multiplayer zapneš v menu (Esc).</p>`;
    const list = [...p.list].sort((a, b) => a.dist - b.dist);
    const dist = (d: number) => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`);
    return `${this.header('Hráči')}<div class="body"><p class="garage-sum"><span class="dot${p.online ? ' on' : ''}"></span>${p.online ? `Online · ${list.length + 1} ve hře` : 'Připojuji…'}</p>
      <ul class="list"><li><div><i class="av" style="background:#0a84ff">${esc(p.me[0] ?? '?')}</i><span><b>${esc(p.me)} (ty)</b><small>tady</small></span></div></li>
      ${list.map((o) => `<li><div><i class="av" style="background:#34c759">${esc(o.nick[0] ?? '?')}</i><span><b>${esc(o.nick)}</b><small>${o.inCar ? 'v autě' : 'pěšky'} · zdraví ${Math.round(o.health)}</small></span><time>${dist(o.dist)}</time></div></li>`).join('')}</ul>
      ${list.length ? '' : '<p class="empty small">Nikdo další zrovna nehraje.</p>'}
      <p class="empty small">Ostatní hráči jsou na mapě zeleně. Můžete se střílet i srazit autem. Přezdívku změníš v menu (Esc).</p></div>`;
  }

  private weatherHtml() {
    const days = forecast(new Date());
    const now = days[0];
    return `<div class="weather">${this.header('Počasí')}<p class="city">Blansko</p><p class="temp">${now.temp}°</p><p class="cond">${now.text}</p>
      <p class="hl">Max. ${now.max}° · Min. ${now.min}°</p><div class="hours">${now.hours.map((h) => `<span><small>${h.h}</small><i>${h.icon}</i><b>${h.t}°</b></span>`).join('')}</div>
      <ul class="days">${days.map((d, i) => `<li><span>${i ? DAYS_SHORT[d.day] : 'Dnes'}</span><i>${d.icon}</i><small>${d.min}°</small><em><u style="left:${(d.min + 10) * 2.5}%;right:${100 - (d.max + 10) * 2.5}%"></u></em><b>${d.max}°</b></li>`).join('')}</ul></div>`;
  }

  private settingsHtml() {
    const rows = this.host.settings.map((s, i) => {
      const v = s.value();
      const right = typeof v === 'boolean' ? `<span class="sw${v ? ' on' : ''}"></span>` : `<span class="val">${esc(v)} ›</span>`;
      return `<li><button data-a="setting" data-v="${i}"><span>${esc(s.label)}</span>${right}</button></li>`;
    }).join('');
    return `${this.header('Nastavení')}<div class="body"><h3>Hra</h3><ul class="list set">${rows}</ul>
      <h3>Telefon</h3><ul class="list set"><li><button data-a="wallpaper"><span>Tapeta</span><span class="val"><i class="wall" style="background:${WALLPAPERS[this.wallpaper]}"></i> ${this.wallpaper + 1}/${WALLPAPERS.length} ›</span></button></li>
      <li><div><span>Baterie</span><span class="val">${Math.round(this.battery)} %${this.host.charging() ? ' · nabíjí se v autě' : ''}</span></div></li>
      <li><div><span>Model</span><span class="val">Blansko Phone 3</span></div></li><li><div><span>Operátor</span><span class="val">Blansko·Net 5G</span></div></li></ul>
      <p class="empty small">Tab zavřít · Backspace zpět · 1–4 rychlá volba</p></div>`;
  }
}

/** A made-up but steady forecast: the same day always gives the same weather. */
function forecast(today: Date) {
  const base = [-1, 1, 5, 11, 16, 19, 21, 21, 16, 10, 5, 0];
  const rand = (seed: number) => {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  const out = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const seed = d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate();
    const max = Math.round(base[d.getMonth()] + 2 + rand(seed) * 6 - 2);
    const min = max - 4 - Math.round(rand(seed + 1) * 5);
    const r = rand(seed + 2);
    const [icon, text] = r < 0.25 ? ['☀️', 'Jasno'] : r < 0.5 ? ['⛅', 'Polojasno'] : r < 0.72 ? ['☁️', 'Zataženo'] : max < 3 ? ['🌨️', 'Sněžení'] : ['🌧️', 'Déšť'];
    const hour = today.getHours();
    const hours = Array.from({ length: 6 }, (_, k) => {
      const h = (hour + k * 2) % 24;
      const t = Math.round(min + (max - min) * Math.max(0, Math.sin(((h - 6) / 24) * Math.PI * 2) * 0.5 + 0.5));
      const night = h < 6 || h > 19;
      return { h: k ? `${h}` : 'Teď', icon: night && icon === '☀️' ? '🌙' : icon, t };
    });
    const temp = i === 0 ? hours[0].t : max;
    out.push({ day: d.getDay(), max, min, icon, text, temp, hours });
  }
  return out;
}
