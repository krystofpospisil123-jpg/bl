// On-screen controls for phones and tablets: a virtual joystick on the left, context
// buttons on the right and a small settings menu. Buttons drive virtual keys in Input,
// so the game logic is the same as with a keyboard.
import type { Input } from './Input.ts';

export const isTouchDevice = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window) &&
  !window.matchMedia?.('(pointer: fine)').matches;

type Mode = 'loading' | 'foot' | 'car' | 'fly';

interface Btn {
  el: HTMLButtonElement;
  modes: Mode[];
  /** Only shown when this returns true (e.g. near the car). */
  when?: () => boolean;
}

export class TouchControls {
  readonly root = document.createElement('div');
  private knob = document.createElement('div');
  private base = document.createElement('div');
  private buttons: Btn[] = [];
  private menu = document.createElement('div');
  private stickId: number | null = null;
  private center = { x: 0, y: 0 };
  private radius = 56;

  constructor(private input: Input, private extra: { canEnterCar: () => boolean; canSteal: () => boolean; armed: () => boolean }) {
    this.root.id = 'touch';
    // --- Joystick (left)
    const zone = document.createElement('div');
    zone.className = 'stick-zone';
    this.base.className = 'stick-base';
    this.knob.className = 'stick-knob';
    this.base.append(this.knob);
    zone.append(this.base);
    zone.addEventListener('pointerdown', (e) => this.stickStart(e, zone));
    zone.addEventListener('pointermove', (e) => this.stickMove(e));
    zone.addEventListener('pointerup', (e) => this.stickEnd(e));
    zone.addEventListener('pointercancel', (e) => this.stickEnd(e));

    // --- Context buttons (right)
    const pad = document.createElement('div');
    pad.className = 'btn-pad';
    const hold = (label: string, code: string, modes: Mode[], cls = '') => this.add(pad, label, modes, { hold: code, cls });
    const tap = (label: string, code: string, modes: Mode[], when?: () => boolean, cls = '') => this.add(pad, label, modes, { tap: code, when, cls });
    tap('Nastoupit', 'KeyF', ['foot'], () => this.extra.canEnterCar(), 'accent');
    tap('Ukrást auto', 'KeyF', ['foot'], () => this.extra.canSteal(), 'accent');
    tap('Zbraň', 'KeyQ', ['foot']);
    this.add(pad, 'Střílet', ['foot'], { hold: 'KeyE', when: () => this.extra.armed(), cls: 'big' });
    hold('Sprint', 'ShiftLeft', ['foot']);
    hold('Skok', 'Space', ['foot'], 'big');
    tap('Vystoupit', 'KeyF', ['car'], undefined, 'accent');
    tap('Na kola', 'KeyR', ['car']);
    hold('Klakson', 'KeyK', ['car']);
    hold('Ruční brzda', 'Space', ['car'], 'big');
    hold('Nahoru', 'Space', ['fly']);
    hold('Dolů', 'KeyQ', ['fly']);
    tap('Sem', 'KeyP', ['fly'], undefined, 'accent');

    // --- Menu (top right)
    const menuBtn = document.createElement('button');
    menuBtn.className = 'menu-btn';
    menuBtn.textContent = 'Menu';
    menuBtn.setAttribute('aria-expanded', 'false');
    this.menu.className = 'touch-menu';
    this.menu.hidden = true;
    const item = (label: string, code: string) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => {
        this.input.tap(code);
        this.toggleMenu(menuBtn, false);
      });
      this.menu.append(b);
    };
    item('Kvalita grafiky', 'KeyG');
    item('Volná kamera', 'KeyP');
    item('Provoz zap/vyp', 'KeyT');
    item('Názvy obchodů', 'KeyN');
    item('2D mapa', 'KeyM');
    item('Zvuk zap/vyp', 'KeyU');
    menuBtn.addEventListener("click", () => this.toggleMenu(menuBtn, this.menu.hidden === true));

    this.root.append(zone, pad, menuBtn, this.menu);
    document.body.append(this.root);
    document.body.classList.add('touch');
  }

  private toggleMenu(btn: HTMLButtonElement, open: boolean) {
    this.menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }

  private add(parent: HTMLElement, label: string, modes: Mode[], o: { hold?: string; tap?: string; when?: () => boolean; cls?: string }) {
    const el = document.createElement('button');
    el.textContent = label;
    el.className = 'tbtn ' + (o.cls ?? '');
    if (o.hold) {
      const code = o.hold;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        capture(el, e.pointerId);
        el.classList.add('down');
        this.input.setVirtual(code, true);
      });
      const up = () => {
        el.classList.remove('down');
        this.input.setVirtual(code, false);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    } else if (o.tap) {
      const code = o.tap;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.input.tap(code);
      });
    }
    parent.append(el);
    this.buttons.push({ el, modes, when: o.when });
  }

  private stickStart(e: PointerEvent, zone: HTMLElement) {
    if (this.stickId !== null) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    capture(zone, e.pointerId);
    // The stick appears where the thumb lands.
    const r = zone.getBoundingClientRect();
    this.center = { x: e.clientX, y: e.clientY };
    this.base.style.left = `${e.clientX - r.left}px`;
    this.base.style.top = `${e.clientY - r.top}px`;
    this.base.classList.add('active');
    this.stickMove(e);
  }

  private stickMove(e: PointerEvent) {
    if (e.pointerId !== this.stickId) return;
    let dx = e.clientX - this.center.x, dy = e.clientY - this.center.y;
    const len = Math.hypot(dx, dy);
    if (len > this.radius) {
      dx *= this.radius / len;
      dy *= this.radius / len;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // Small dead zone in the middle.
    const nx = dx / this.radius, ny = -dy / this.radius;
    const dead = (v: number) => (Math.abs(v) < 0.12 ? 0 : v);
    this.input.stick.x = dead(nx);
    this.input.stick.y = dead(ny);
  }

  private stickEnd(e: PointerEvent) {
    if (e.pointerId !== this.stickId) return;
    this.stickId = null;
    this.input.stick.x = this.input.stick.y = 0;
    this.knob.style.transform = '';
    this.base.classList.remove('active');
    this.base.style.left = this.base.style.top = '';
  }

  update(mode: Mode) {
    this.root.dataset.mode = mode;
    for (const b of this.buttons) {
      const show = b.modes.includes(mode) && (!b.when || b.when());
      if (b.el.hidden === show) b.el.hidden = !show;
    }
  }
}

/** Pointer capture keeps a drag on its control; it is optional (may throw for synthetic events). */
function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* ignore */
  }
}
