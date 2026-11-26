// Drinks menu at the club bar: pick a drink, pay, and the player drinks it (animation in
// CharacterModel); alcohol makes the player tipsy for a while (see Game: drunk effects).
import type { Arsenal } from '../combat/Arsenal.ts';
import { formatKc } from '../combat/Arsenal.ts';

export type GlassKind = 'beer' | 'cocktail' | 'shot' | 'wine' | 'tumbler';

export interface Drink {
  id: string;
  name: string;
  desc: string;
  price: number;
  /** How much tipsier it makes you (0 = no alcohol). */
  strength: number;
  color: number;
  glass: GlassKind;
}

export const DRINKS: Drink[] = [
  { id: 'beer', name: 'Točené pivo', desc: 'Půllitr dvanáctky z tanku', price: 55, strength: 0.16, color: 0xe2a62a, glass: 'beer' },
  { id: 'prosecco', name: 'Prosecco', desc: 'Sklenka šumivého', price: 95, strength: 0.14, color: 0xf2e3a0, glass: 'wine' },
  { id: 'gin', name: 'Gin s tonikem', desc: 'S limetkou a ledem', price: 110, strength: 0.22, color: 0xdff3f6, glass: 'tumbler' },
  { id: 'mojito', name: 'Mojito', desc: 'Rum, máta, limetka, soda', price: 120, strength: 0.22, color: 0xbfe6a2, glass: 'cocktail' },
  { id: 'cuba', name: 'Cuba libre', desc: 'Rum s colou', price: 110, strength: 0.24, color: 0x4a2412, glass: 'tumbler' },
  { id: 'slivovice', name: 'Panák slivovice', desc: 'Domácí, 52 %', price: 70, strength: 0.32, color: 0xf3f0e2, glass: 'shot' },
  { id: 'lemonade', name: 'Domácí limonáda', desc: 'Nealko, pro řidiče', price: 45, strength: 0, color: 0xff8a3a, glass: 'tumbler' },
];

const GLASS_SVG: Record<GlassKind, (c: string) => string> = {
  beer: (c) => `<path d="M14 10h22v38a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4z" fill="${c}"/><path d="M14 10h22v7H14z" fill="#fff8ec"/><path d="M36 18h5a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5h-5v-5h4V23h-4z" fill="#dfe6ea" opacity=".8"/><path d="M14 10h22v38a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4z" fill="none" stroke="#e9f2f6" stroke-width="2"/>`,
  wine: (c) => `<path d="M17 6h16c0 14-2 20-8 21-6-1-8-7-8-21z" fill="none" stroke="#e9f2f6" stroke-width="2"/><path d="M18.5 13h13c-.5 8-2.5 12-6.5 12.5-4-.5-6-4.5-6.5-12.5z" fill="${c}"/><path d="M25 27v19M17 48h16" stroke="#e9f2f6" stroke-width="2.5" stroke-linecap="round"/>`,
  cocktail: (c) => `<path d="M15 12h20l-2 36a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4z" fill="${c}" opacity=".9"/><path d="M15 12h20l-2 36a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4z" fill="none" stroke="#e9f2f6" stroke-width="2"/><circle cx="33" cy="12" r="5" fill="#9ad14a"/><path d="M27 4l4 30" stroke="#ff5a7a" stroke-width="2"/>`,
  tumbler: (c) => `<path d="M14 18h22l-2 30a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4z" fill="${c}" opacity=".92"/><rect x="18" y="22" width="7" height="7" rx="1.5" fill="#fff" opacity=".6"/><rect x="25" y="27" width="7" height="7" rx="1.5" fill="#fff" opacity=".5"/><path d="M14 18h22l-2 30a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4z" fill="none" stroke="#e9f2f6" stroke-width="2"/><circle cx="34" cy="18" r="5" fill="#b8e04a"/>`,
  shot: (c) => `<path d="M17 24h16l-2 24a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3z" fill="${c}" opacity=".85"/><path d="M17 24h16l-2 24a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3z" fill="none" stroke="#e9f2f6" stroke-width="2.4"/>`,
};

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export class BarMenu {
  private panel = document.createElement('div');
  isOpen = false;
  private msg = '';
  /** Ordered: the game plays the drinking animation and applies the effects. */
  onOrder?: (d: Drink) => string;

  constructor(private wallet: Arsenal) {
    this.panel.id = 'barmenu';
    this.panel.hidden = true;
    document.body.append(this.panel);
    this.panel.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-drink]');
      if (b) this.order(b.dataset.drink!);
      if ((e.target as HTMLElement).closest('[data-close]')) this.close();
    });
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.msg = '';
    this.panel.hidden = false;
    document.exitPointerLock?.();
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.hidden = true;
  }

  private order(id: string) {
    const d = DRINKS.find((x) => x.id === id);
    if (!d) return;
    if (this.wallet.money < d.price) {
      this.msg = `Na ${d.name.toLowerCase()} nemáš (${formatKc(d.price)}).`;
      return this.render();
    }
    this.wallet.money -= d.price;
    this.onOrder?.(d);
    this.close();
  }

  render() {
    const m = this.wallet.money;
    const cards = DRINKS.map((d) => `<article><div class="pic"><svg viewBox="0 0 50 56">${GLASS_SVG[d.glass](hex(d.color))}</svg></div>
      <div class="info"><h3>${d.name}</h3><p>${d.desc}</p>
      <div class="stat"><span>${d.strength ? 'Síla' : 'Nealko'}</span><i><u style="width:${Math.round(Math.max(0.04, d.strength / 0.32) * 100)}%"></u></i></div></div>
      <button data-drink="${d.id}" class="main${m < d.price ? ' poor' : ''}"><b>Objednat</b><em>${formatKc(d.price)}</em></button></article>`).join('');
    this.panel.innerHTML = `<header><div><small>VELVET CLUB · BAR</small><h2>Co si dáš?</h2></div><div class="wallet"><small>Peníze</small><b>${formatKc(m)}</b></div></header>
      <div class="cards">${cards}</div>
      <footer><span class="msg bad">${this.msg}</span><button data-close class="x">Nic, díky</button></footer>`;
  }
}
