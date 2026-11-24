// Car tuning: looks (paint, rims, lowering, rear wing, neon) and performance (engine stage,
// exhaust). Prices in Kč. Applied by Car.applyTuning(); bought in a tuning garage.

export interface Tuning {
  rims: number;
  lowered: boolean;
  spoiler: boolean;
  neon: number | null;
  /** 0 = stock, 1-3 = stages. */
  engine: number;
  /** 0 = stock, 1 = sport, 2 = racing. */
  exhaust: number;
}

export const stockTuning = (): Tuning => ({ rims: 0xa9adb2, lowered: false, spoiler: false, neon: null, engine: 0, exhaust: 0 });

export const PAINTS: [string, number][] = [
  ['Bílá', 0xf2f2ef], ['Stříbrná', 0xb3b7bc], ['Černá', 0x18191b], ['Červená', 0xb5201f], ['Modrá', 0x1f4fa8],
  ['Zelená', 0x2f7a3c], ['Žlutá', 0xe0b520], ['Oranžová', 0xe06a1a], ['Fialová', 0x5d2f8a], ['Matná šedá', 0x55595e],
];
export const RIMS: [string, number][] = [['Stříbrné', 0xa9adb2], ['Černé', 0x1c1d1f], ['Zlaté', 0xc9a23a], ['Chromové', 0xe4e8ec], ['Červené', 0xb3262a]];
export const NEONS: [string, number][] = [['Modrý', 0x2f7bff], ['Zelený', 0x2fff7b], ['Růžový', 0xff2fb5], ['Oranžový', 0xff8a2f]];

/** Engine stages: power multiplier and price. */
export const ENGINE: { name: string; power: number; price: number }[] = [
  { name: 'Sériový', power: 1, price: 0 },
  { name: 'Stage 1 (+15 %)', power: 1.15, price: 2000 },
  { name: 'Stage 2 (+30 %)', power: 1.3, price: 4500 },
  { name: 'Stage 3 (+50 %)', power: 1.5, price: 8000 },
];
export const EXHAUST: { name: string; price: number }[] = [
  { name: 'Sériový', price: 0 },
  { name: 'Sportovní (hlasitější)', price: 1500 },
  { name: 'Závodní (střílí plameny)', price: 3000 },
];

export const PRICES = { paint: 400, rims: 600, lowered: 800, spoiler: 900, neon: 700 };
