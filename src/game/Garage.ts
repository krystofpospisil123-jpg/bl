// Tuning garage menu: drive into the orange ring in front of a garage door, stop, and buy
// looks (paint, rims, lowering, rear wing, neon) and performance (engine stage, exhaust).
import type { Car } from '../vehicle/Car.ts';
import type { Arsenal } from '../combat/Arsenal.ts';
import { formatKc } from '../combat/Arsenal.ts';
import { ENGINE, EXHAUST, NEONS, PAINTS, PRICES, RIMS } from '../vehicle/Tuning.ts';

export class Garage {
  private panel = document.createElement('div');
  private name: string | null = null;
  private car: Car | null = null;
  onMessage?: (text: string) => void;
  /** Called after a change so the game can refresh effects/sound for the new parts. */
  onChange?: () => void;

  constructor(private wallet: Arsenal) {
    this.panel.id = 'garage';
    this.panel.hidden = true;
    document.body.append(this.panel);
  }

  get isOpen() {
    return this.name !== null;
  }

  open(name: string, car: Car) {
    if (this.name === name) return;
    this.name = name;
    this.car = car;
    this.panel.hidden = false;
    document.exitPointerLock?.();
    this.render();
  }

  close() {
    if (this.name === null) return;
    this.name = null;
    this.car = null;
    this.panel.hidden = true;
  }

  private pay(price: number): boolean {
    if (this.wallet.money < price) {
      this.onMessage?.('Nemáš dost peněz');
      return false;
    }
    this.wallet.money -= price;
    return true;
  }

  private render() {
    const car = this.car;
    if (!car || this.name === null) return;
    const t = car.tuning;
    const swatches = (list: [string, number][], cur: number | null, kind: string, price: number) =>
      list.map(([n, c]) => `<button class="sw${cur === c ? ' on' : ''}" title="${n} · ${formatKc(price)}" data-${kind}="${c}" style="background:#${c.toString(16).padStart(6, '0')}"></button>`).join('');
    this.panel.innerHTML = `
      <h2>${this.name}</h2><p>Peníze: <b>${formatKc(this.wallet.money)}</b></p>
      <section><h3>Vzhled</h3>
        <div class="line"><span>Lak · ${formatKc(PRICES.paint)}</span><div class="sws">${swatches(PAINTS, car.look.color, 'paint', PRICES.paint)}</div></div>
        <div class="line"><span>Disky · ${formatKc(PRICES.rims)}</span><div class="sws">${swatches(RIMS, t.rims, 'rims', PRICES.rims)}</div></div>
        <div class="line"><span>Neon pod autem · ${formatKc(PRICES.neon)}</span><div class="sws">${swatches(NEONS, t.neon, 'neon', PRICES.neon)}<button class="sw off${t.neon === null ? ' on' : ''}" data-neon="none" title="Bez neonu">✕</button></div></div>
        <div class="line"><span>Snížený podvozek · ${formatKc(PRICES.lowered)}</span><button data-toggle="lowered" class="${t.lowered ? 'on' : ''}">${t.lowered ? 'Snížený ✓' : 'Snížit'}</button></div>
        <div class="line"><span>Zadní křídlo · ${formatKc(PRICES.spoiler)}</span><button data-toggle="spoiler" class="${t.spoiler ? 'on' : ''}">${t.spoiler ? 'Namontované ✓' : 'Namontovat'}</button></div>
      </section>
      <section><h3>Výkon</h3>
        ${ENGINE.map((e, i) => `<button class="opt${t.engine === i ? ' on' : ''}" data-engine="${i}">Motor: ${e.name}${i ? ` · ${formatKc(e.price)}` : ''}</button>`).join('')}
        ${EXHAUST.map((e, i) => `<button class="opt${t.exhaust === i ? ' on' : ''}" data-exhaust="${i}">Výfuk: ${e.name}${i ? ` · ${formatKc(e.price)}` : ''}</button>`).join('')}
      </section>
      <p class="hint">Vyjeď z kruhu pro zavření. Úpravy platí pro tohle auto.</p>`;
    this.panel.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => this.click(b)));
  }

  private click(b: HTMLButtonElement) {
    const car = this.car!, t = car.tuning, d = b.dataset;
    if (d.paint) {
      const c = Number(d.paint);
      if (c === car.look.color || !this.pay(PRICES.paint)) return;
      const dmg = car.model.damage;
      car.setLook(c, car.look.type); // fresh paint also fixes the dents
      car.applyTuning();
      this.onMessage?.(dmg > 0 ? 'Nový lak, karoserie opravená' : 'Nový lak');
    } else if (d.rims) {
      const c = Number(d.rims);
      if (c === t.rims || !this.pay(PRICES.rims)) return;
      t.rims = c;
    } else if (d.neon) {
      const c = d.neon === 'none' ? null : Number(d.neon);
      if (c === t.neon || (c !== null && !this.pay(PRICES.neon))) return;
      t.neon = c;
    } else if (d.toggle === 'lowered') {
      if (!t.lowered && !this.pay(PRICES.lowered)) return;
      t.lowered = !t.lowered;
    } else if (d.toggle === 'spoiler') {
      if (!t.spoiler && !this.pay(PRICES.spoiler)) return;
      t.spoiler = !t.spoiler;
    } else if (d.engine) {
      const i = Number(d.engine);
      if (i === t.engine || (i > t.engine && !this.pay(ENGINE[i].price))) return;
      t.engine = i;
    } else if (d.exhaust) {
      const i = Number(d.exhaust);
      if (i === t.exhaust || (i > t.exhaust && !this.pay(EXHAUST[i].price))) return;
      t.exhaust = i;
    }
    car.applyTuning();
    this.onChange?.();
    this.render();
  }
}
