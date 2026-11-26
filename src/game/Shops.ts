// Gun counter menu inside the walk-in stores (see Interior): buy weapons and ammo.
import { WEAPONS, WEAPON_ORDER, formatKc, type Arsenal } from '../combat/Arsenal.ts';

export class Shops {
  private panel = document.createElement('div');
  private name: string | null = null;
  onMessage?: (text: string) => void;

  constructor(private arsenal: Arsenal) {
    this.panel.id = 'shop';
    this.panel.hidden = true;
    document.body.append(this.panel);
  }

  /** Opens the gun counter menu of a store (releases the mouse so the buttons can be clicked). */
  open(store: string) {
    if (this.name === store) return;
    this.name = store;
    this.flash = '';
    this.panel.hidden = false;
    document.exitPointerLock?.();
    this.render();
  }

  close() {
    if (this.name === null) return;
    this.name = null;
    this.panel.hidden = true;
  }

  get isOpen() {
    return this.name !== null;
  }

  private flash = '';
  private flashOk = true;

  render() {
    if (this.name === null) return;
    const a = this.arsenal;
    const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const bar = (label: string, v: number) => `<div class="stat"><span>${label}</span><i><u style="width:${Math.round(Math.max(0.06, Math.min(1, v)) * 100)}%"></u></i></div>`;
    const cards = WEAPON_ORDER.map((id) => {
      const w = WEAPONS[id];
      const own = a.owned.has(id);
      const buy = own
        ? `<button data-ammo="${id}" ${a.money < w.ammoPrice ? 'class="poor"' : ''}><b>+${w.ammoPack} nábojů</b><em>${formatKc(w.ammoPrice)}</em></button>`
        : `<button data-buy="${id}" class="main${a.money < w.price ? ' poor' : ''}"><b>Koupit</b><em>${formatKc(w.price)}</em></button>`;
      return `<article class="${own ? 'owned' : ''}">
        <div class="pic"><svg viewBox="0 0 64 24" fill="currentColor">${GUN_ICONS[id]}</svg>${own ? '<span class="tag">VLASTNÍŠ</span>' : ''}</div>
        <div class="info"><h3>${w.name}</h3>
          ${bar('Poškození', (w.damage * w.pellets) / 112)}${bar('Kadence', 1 / w.interval / 11.2)}${bar('Přesnost', (0.08 - w.spread) / 0.08)}
          <p class="ammo">${own ? `Náboje: <b>${a.ammo[id]}</b>` : `S první krabicí ${w.ammoPack} nábojů`}</p></div>
        ${buy}</article>`;
    }).join('');
    this.panel.innerHTML = `<header><div><small>ZBROJNÍ PULT</small><h2>${esc(this.name)}</h2></div><div class="wallet"><small>Peníze</small><b>${formatKc(a.money)}</b></div></header>
      <div class="cards">${cards}</div>
      <footer><span class="msg ${this.flashOk ? 'ok' : 'bad'}">${esc(this.flash)}</span><span class="hint">Odejdi od pultu pro zavření</span></footer>`;
    this.panel.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.addEventListener('click', () => {
        const before = a.money;
        const msg = b.dataset.buy ? a.buyWeapon(b.dataset.buy as never) : a.buyAmmo(b.dataset.ammo as never);
        this.flash = msg;
        this.flashOk = a.money < before;
        this.onMessage?.(msg);
        this.render();
      });
    });
  }
}

/** Gun silhouettes for the shop cards (viewBox 64 x 24). */
const GUN_ICONS: Record<string, string> = {
  pistol: '<path d="M14 4h32l2 1.5V10H32.5l-1.6 2.6h-5.2l-2.9 9.4h-8.6l2.6-10.4L14 11z"/><path d="M27 12.6c0 2.6-1.2 3.6-3.4 3.6v-1.6c1.2 0 1.6-.6 1.6-2z"/>',
  smg: '<path d="M3 6.5h12l1-1.5h30l2 1h8v4.5H47l-1.5 2H38l-.8 2.5h-4.5l1.8 8h-6.6l-1.6-8H22l-1-1.6h-5.5l-3 2.6H3.5l2-4.2H3z"/><rect x="56" y="7" width="7" height="2" rx="1"/>',
  shotgun: '<path d="M1 9.5 5 7h11l1.5 1h45.5v3H45l-3 2.2H24l-3.5 1.4h-4L8 19H1.6l3.2-6.2H1z"/><rect x="30" y="11.2" width="12" height="2.6" rx="1.3"/>',
};
