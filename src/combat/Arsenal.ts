// Money and weapons the player owns. Prices in Czech crowns (Kč).

export type WeaponId = 'pistol' | 'smg' | 'shotgun';

export interface WeaponSpec {
  name: string;
  /** Seconds between shots, damage per pellet, pellets per shot, spread (rad). */
  interval: number;
  damage: number;
  pellets: number;
  spread: number;
  /** Shop: price of the weapon (with a first box of ammo) and of a box of ammo. */
  price: number;
  ammoPrice: number;
  ammoPack: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol: { name: 'Pistole', interval: 0.28, damage: 34, pellets: 1, spread: 0.004, price: 800, ammoPrice: 60, ammoPack: 24 },
  smg: { name: 'Samopal', interval: 0.09, damage: 16, pellets: 1, spread: 0.03, price: 3500, ammoPrice: 150, ammoPack: 90 },
  shotgun: { name: 'Brokovnice', interval: 0.85, damage: 14, pellets: 8, spread: 0.07, price: 2400, ammoPrice: 120, ammoPack: 16 },
};

export const WEAPON_ORDER: WeaponId[] = ['pistol', 'smg', 'shotgun'];

export class Arsenal {
  money = 500;
  owned = new Set<WeaponId>(['pistol']);
  ammo: Record<WeaponId, number> = { pistol: 48, smg: 0, shotgun: 0 };
  /** Weapon in hand, or null when holstered. */
  current: WeaponId | null = null;

  /** Q: holster -> next owned weapon -> ... -> holster. */
  cycle(): WeaponId | null {
    const owned = WEAPON_ORDER.filter((w) => this.owned.has(w));
    if (this.current === null) this.current = owned[0] ?? null;
    else {
      const i = owned.indexOf(this.current);
      this.current = i + 1 < owned.length ? owned[i + 1] : null;
    }
    return this.current;
  }

  buyWeapon(id: WeaponId): string {
    const w = WEAPONS[id];
    if (this.owned.has(id)) return `${w.name} už máš`;
    if (this.money < w.price) return 'Nemáš dost peněz';
    this.money -= w.price;
    this.owned.add(id);
    this.ammo[id] += w.ammoPack;
    this.current = id;
    return `Koupeno: ${w.name}`;
  }

  buyAmmo(id: WeaponId): string {
    const w = WEAPONS[id];
    if (!this.owned.has(id)) return `Nejdřív si kup: ${w.name}`;
    if (this.money < w.ammoPrice) return 'Nemáš dost peněz';
    this.money -= w.ammoPrice;
    this.ammo[id] += w.ammoPack;
    return `Náboje (${w.ammoPack}) do: ${w.name}`;
  }
}

export const formatKc = (n: number) => `${Math.round(n).toLocaleString('cs-CZ')} Kč`;
