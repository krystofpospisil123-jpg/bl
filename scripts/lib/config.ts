// Shared configuration for the data pipeline.
import proj4 from 'proj4';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const RAW_DIR = path.join(ROOT, 'data/raw');
export const OUT_DIR = path.join(ROOT, 'public/data');

/** World origin: between Náměstí Republiky, the château and the railway station. */
export const ORIGIN = { lat: 49.3628, lon: 16.6448 };

/**
 * Playable area in local map metres (x east, y north): Blansko in the west, Jedovnice ~8 km to
 * the east, Kuničky ~8 km to the north, the Moravian Karst in between. Edges lie on the chunk grid.
 */
export const BOUNDS = { minX: -1500, maxX: 9500, minY: -3250, maxY: 9000 };

/**
 * The original 3 x 3 km around the centre of Blansko, mapped from OpenStreetMap. Outside it the
 * map comes from ČÚZK ZABAGED (scripts/fetch-zabaged.ts).
 */
export const OSM_HALF = 1500;
/** @deprecated the area is a rectangle now (BOUNDS); kept for the OSM download. */
export const HALF_EXTENT = OSM_HALF;

/** Chunk edge length in metres. */
export const CHUNK_SIZE = 250;

/** Heightmap sample spacing in metres (DMR 5G native resolution is 2 m). */
export const HEIGHT_STEP = 2;

/** Extra margin fetched around the area so that edge geometry is not cut. */
export const FETCH_MARGIN = 150;

// Local transverse Mercator centred on the origin: x = east, y = north, in metres.
// Over 10 km the scale error stays below 0.1 %.
export const LOCAL_PROJ = `+proj=tmerc +lat_0=${ORIGIN.lat} +lon_0=${ORIGIN.lon} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs`;

// S-JTSK / Krovak East North (EPSG:5514), used by ČÚZK services.
export const SJTSK_PROJ =
  '+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 ' +
  '+x_0=0 +y_0=0 +ellps=bessel +towgs84=572.213,85.334,461.94,4.9732,1.529,5.2484,3.5378 +units=m +no_defs';

proj4.defs('LOCAL', LOCAL_PROJ);
proj4.defs('SJTSK', SJTSK_PROJ);

const toLocal = proj4('WGS84', 'LOCAL');
const localToSjtsk = proj4('LOCAL', 'SJTSK');
const localToWgs = proj4('LOCAL', 'WGS84');

/** WGS84 lon/lat -> local metres [east, north]. */
export function lonLatToLocal(lon: number, lat: number): [number, number] {
  return toLocal.forward([lon, lat]) as [number, number];
}

export function localToLonLat(x: number, y: number): [number, number] {
  return localToWgs.forward([x, y]) as [number, number];
}

export function localToSJTSK(x: number, y: number): [number, number] {
  return localToSjtsk.forward([x, y]) as [number, number];
}

/** WGS84 bounding box (south, west, north, east) covering the area plus margin. */
export function fetchBBox(): { s: number; w: number; n: number; e: number } {
  const r = HALF_EXTENT + FETCH_MARGIN;
  const corners = [
    localToLonLat(-r, -r),
    localToLonLat(r, -r),
    localToLonLat(r, r),
    localToLonLat(-r, r),
  ];
  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  return { s: Math.min(...lats), w: Math.min(...lons), n: Math.max(...lats), e: Math.max(...lons) };
}

/** WGS84 bounding box (south, west, north, east) of a local rectangle plus margin. */
export function boundsBBox(b = BOUNDS, margin = FETCH_MARGIN): { s: number; w: number; n: number; e: number } {
  const corners = [
    localToLonLat(b.minX - margin, b.minY - margin),
    localToLonLat(b.maxX + margin, b.minY - margin),
    localToLonLat(b.maxX + margin, b.maxY + margin),
    localToLonLat(b.minX - margin, b.maxY + margin),
  ];
  const lons = corners.map((c) => c[0]);
  const lats = corners.map((c) => c[1]);
  return { s: Math.min(...lats), w: Math.min(...lons), n: Math.max(...lats), e: Math.max(...lons) };
}

/** S-JTSK extent of a local rectangle plus margin. */
export function boundsSJTSK(b = BOUNDS, margin = FETCH_MARGIN): { xmin: number; ymin: number; xmax: number; ymax: number } {
  const pts = [
    [b.minX - margin, b.minY - margin], [b.maxX + margin, b.minY - margin],
    [b.maxX + margin, b.maxY + margin], [b.minX - margin, b.maxY + margin],
  ].map(([x, y]) => localToSJTSK(x, y));
  return {
    xmin: Math.floor(Math.min(...pts.map((p) => p[0]))), xmax: Math.ceil(Math.max(...pts.map((p) => p[0]))),
    ymin: Math.floor(Math.min(...pts.map((p) => p[1]))), ymax: Math.ceil(Math.max(...pts.map((p) => p[1]))),
  };
}
