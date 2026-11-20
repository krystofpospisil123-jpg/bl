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
}

export const LANDMARKS: Record<number, LandmarkStyle> = {
  // Zámek Blansko (château): three storeys, ochre facade, dark hipped roof.
  3401183: { h: 16, colour: '#ecd9a6', roofColour: '#5e3b2e', roof: 'hipped', facade: FACADE.ornate, groundFacade: FACADE.ornate, sign: true },
  // Kostel sv. Martina (Staré Blansko): church with a west tower.
  102952951: { h: 11, colour: '#efe8d8', roofColour: '#6a4434', roof: 'gabled', facade: FACADE.ornate, groundFacade: FACADE.ornate, tower: { size: 5.5, height: 24, roofHeight: 9, end: 0 } },
  // Dřevěný kostel sv. Paraskivy: dark wooden church with a small tower.
  253861203: { h: 9, colour: '#6b4c34', roofColour: '#4a3a2c', roof: 'gabled', facade: FACADE.ornate, groundFacade: FACADE.ornate, tower: { size: 3.5, height: 12, roofHeight: 6, end: 0 } },
  // Stará vodárenská věž (old water tower).
  957022795: { h: 24, colour: '#c98f6a', roofColour: '#5a4a40', roof: 'pyramidal', facade: FACADE.oldtown, groundFacade: FACADE.oldtown, sign: true },
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
    'shop:alcohol': 'Nápoje', 'shop:clothes': 'Oděvy', 'shop:optician': 'Optika', 'shop:bicycle': 'Kola',
    'shop:car': 'Autosalon', 'shop:florist': 'Květiny', 'shop:pastry': 'Cukrárna', 'shop:confectionery': 'Cukrárna',
    'amenity:cafe': 'Kavárna', 'amenity:restaurant': 'Restaurace', 'amenity:pub': 'Hospoda', 'amenity:fast_food': 'Bistro',
    'amenity:pharmacy': 'Lékárna', 'amenity:bank': 'Banka', 'amenity:fuel': 'Čerpací stanice', 'amenity:cinema': 'Kino',
    'amenity:post_office': 'Pošta', 'amenity:police': 'Policie',
  };
  return map[use] ?? (use.startsWith('shop:') ? 'Obchod' : '');
}
