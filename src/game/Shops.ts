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

  render() {
    if (this.name === null) return;
    const a = this.arsenal;
    const rows = WEAPON_ORDER.map((id) => {
      const w = WEAPONS[id];
      const own = a.owned.has(id);
      return `<div class="row"><b>${w.name}</b><span>${own ? `náboje: ${a.ammo[id]}` : formatKc(w.price)}</span>
        ${own ? '' : `<button data-buy="${id}">Koupit</button>`}
        <button data-ammo="${id}" ${own ? '' : 'disabled'}>Náboje ×${w.ammoPack} · ${formatKc(w.ammoPrice)}</button></div>`;
    }).join('');
    this.panel.innerHTML = `<h2>${this.name} – zbraně a náboje</h2><p>Peníze: <b>${formatKc(a.money)}</b></p>${rows}
      <p class="hint">Odejdi od pultu pro zavření.</p>`;
    this.panel.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.addEventListener('click', () => {
        const msg = b.dataset.buy ? a.buyWeapon(b.dataset.buy as never) : a.buyAmmo(b.dataset.ammo as never);
        this.onMessage?.(msg);
        this.render();
      });
    });
  }
}
