// Corrections for well-known Blansko buildings, keyed by OSM id. OSM has no heights for
// them, so these are approximate values chosen to make the landmarks recognisable; the
// footprints themselves still come from OSM.
import type { Building } from './format.ts';
import { FACADE } from '../render/facades.ts';

export interface Tower {
  /** Tower edge length (m) and height of its walls above ground (m). */
  size: number;
  height: number;
  /** Height of the roof/spire on top (m). */
  roofHeight: number;
  /** Which end of the building's long axis: 0 or 1. */
  end: 0 | 1;
}

export interface LandmarkStyle {
  h?: number;
  colour?: string;
  roofColour?: string;
  roof?: string;
  facade?: number;
  groundFacade?: number;
  tower?: Tower;
  /** Show the sign even for uses that normally have none. */
  sign?: boolean;
  /** Put the sign on the facade facing this direction (rad, 0 = +z) instead of the one nearest a road. */
  signFacing?: number;
  /** Sign text and purpose overrides (e.g. when OSM links the wrong shop to a hall). */
  label?: string;
  use?: string;
}

export const LANDMARKS: Record<number, LandmarkStyle> = {
  // Zámek Blansko (château): white walls, ochre window surrounds, red roof; the clock tower,
  // bastion, gate portal and gable are added by world/scenes.ts.
  3401183: { h: 14, colour: '#f4f2ec', roofColour: '#b04a30', roof: 'hipped', facade: FACADE.castle, groundFacade: FACADE.castle, sign: true },
  // Yellow building with white pilasters closing náměstí Republiky (Komerční banka), red hipped roof.
  253861544: { h: 13, colour: '#e9be55', roofColour: '#a9462e', roof: 'hipped', facade: FACADE.civic, groundFacade: FACADE.civic, sign: true },
  // Kostel sv. Martina (Staré Blansko): church with a west tower.
  102952951: { h: 11, colour: '#efe8d8', roofColour: '#6a4434', roof: 'gabled', facade: FACADE.ornate, groundFacade: FACADE.ornate, tower: { size: 5.5, height: 24, roofHeight: 9, end: 0 } },
  // Dřevěný kostel sv. Paraskivy: dark wooden church with a small tower.
  253861203: { h: 9, colour: '#6b4c34', roofColour: '#4a3a2c', roof: 'gabled', facade: FACADE.ornate, groundFacade: FACADE.ornate, tower: { size: 3.5, height: 12, roofHeight: 6, end: 0 } },
  // Stará vodárenská věž (old water tower).
  957022795: { h: 24, colour: '#c98f6a', roofColour: '#5a4a40', roof: 'pyramidal', facade: FACADE.oldtown, groundFacade: FACADE.oldtown, sign: true },
  // --- Shopping area on Na Řadech / Poříčí (from street photos; signs are plain text only).
  // Kaufland: dark grey hall, entrance facing the car park in the south. Pylon in world/scenes.ts.
  253791835: { h: 9, colour: '#5b6064', facade: FACADE.supermarket, groundFacade: FACADE.supermarket, signFacing: 0 },
  // Long white retail hall east of the car park (blue section added in world/scenes.ts), facing west.
  253792182: { h: 7.5, colour: '#eceeef', facade: FACADE.supermarket, groundFacade: FACADE.supermarket, signFacing: -Math.PI / 2 },
  372508663: { h: 7, colour: '#eceeef', facade: FACADE.supermarket, groundFacade: FACADE.supermarket, signFacing: -Math.PI / 2 },
  // West side of Poříčí: new retail row (grey cladding, glazed ground floor), facing east.
  // OSM links the shoe shop (southern end, orange panels) to it; the supermarket fills the rest.
  1280153528: { h: 7.5, colour: '#d5d8da', facade: FACADE.supermarket, groundFacade: FACADE.glass, signFacing: Math.PI / 2, label: 'Lidl', use: 'shop:supermarket', sign: true },
  253796332: { h: 7, colour: '#e4e6e7', facade: FACADE.supermarket, groundFacade: FACADE.glass, signFacing: Math.PI / 2 },
  1088075514: { h: 7, colour: '#e9ebec', facade: FACADE.supermarket, groundFacade: FACADE.supermarket, signFacing: Math.PI / 2 },
  // --- Fügnerova / Svitavská (street photos and 3D map)
  // Penny: white two-storey building, glazed ground floor, red entrance (world/scenes.ts).
  254004784: { h: 7.5, colour: '#f0f0ee', roof: 'flat', facade: FACADE.plaster, groundFacade: FACADE.glass, signFacing: Math.PI },
  // Tall yellow tower block behind it (twelve floors).
  254004783: { h: 38, colour: '#e2c36c', roof: 'flat', facade: FACADE.panel, groundFacade: FACADE.panel },
  // JYSK: grey-blue hall with a red gabled roof, entrance facing the car park and Svitavská.
  253974411: { h: 7, colour: '#6f7f8a', roofColour: '#b0392d', roof: 'gabled', facade: FACADE.supermarket, groundFacade: FACADE.glass, signFacing: Math.PI / 2, use: 'shop:furniture' },
  // Městský úřad (town hall)
  // (resolved by use=amenity:townhall below, no id override needed)
};

/** Styles applied by building purpose when there is no id-specific entry. */
export function styleForUse(b: Building): LandmarkStyle | undefined {
  const u = b.use ?? '';
  if (u === 'shop:supermarket' || u === 'shop:department_store' || u === 'shop:doityourself' || u === 'shop:furniture') {
    return { h: Math.max(b.h, 7), facade: FACADE.supermarket, groundFacade: FACADE.supermarket, roof: 'flat', colour: '#d9dcdf', sign: true };
  }
  if (u === 'amenity:fuel') return { facade: FACADE.blank, groundFacade: FACADE.glass, sign: true };
  if (u === 'amenity:townhall' || u === 'amenity:courthouse') return { h: Math.max(b.h, 13), facade: FACADE.oldtown, groundFacade: FACADE.oldtown, colour: '#efe6cf', sign: true };
  if (u === 'amenity:place_of_worship') return { h: Math.max(b.h, 9), facade: FACADE.ornate, groundFacade: FACADE.ornate };
  if (u === 'railway:station') return { h: Math.max(b.h, 8), facade: FACADE.oldtown, groundFacade: FACADE.glass, colour: '#e8dcc0', sign: true };
  if (u === 'amenity:cinema') return { facade: FACADE.plaster, groundFacade: FACADE.glass, sign: true };
  return undefined;
}

/** Uses that get a name sign on the facade. */
export const SIGN_USES = /^(shop:|amenity:(cafe|restaurant|pub|bar|fast_food|pharmacy|bank|fuel|cinema|townhall|police|post_office|courthouse|biergarten|doctors|events_venue)|historic:castle|railway:station|man_made:water_tower)/;

/** Neutral names used when real shop names are switched off (see config). */
export function genericName(use: string): string {
  const map: Record<string, string> = {
    'shop:supermarket': 'Supermarket', 'shop:convenience': 'Potraviny', 'shop:department_store': 'Obchodní dům',
    'shop:bakery': 'Pekárna', 'shop:butcher': 'Řeznictví', 'shop:chemist': 'Drogerie', 'shop:wine': 'Vinotéka',
    'shop:alcohol': 'Nápoje', 'shop:clothes': 'Oděvy', 'shop:shoes': 'Obuv', 'shop:optician': 'Optika', 'shop:bicycle': 'Kola',
    'shop:car': 'Autosalon', 'shop:florist': 'Květiny', 'shop:pastry': 'Cukrárna', 'shop:confectionery': 'Cukrárna',
    'amenity:cafe': 'Kavárna', 'amenity:restaurant': 'Restaurace', 'amenity:pub': 'Hospoda', 'amenity:fast_food': 'Bistro',
    'amenity:pharmacy': 'Lékárna', 'amenity:bank': 'Banka', 'amenity:fuel': 'Čerpací stanice', 'amenity:cinema': 'Kino',
    'amenity:post_office': 'Pošta', 'amenity:police': 'Policie',
  };
  return map[use] ?? (use.startsWith('shop:') ? 'Obchod' : '');
}
