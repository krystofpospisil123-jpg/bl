// Converts the raw OSM + DEM downloads into the game's chunked world format.
// Input:  data/raw/osm.json (Blansko), data/raw/zabaged.json (the rest), data/raw/dem_local.{json,bin}
// Output: public/data/manifest.json, public/data/overview.png, public/data/chunks/*
import fs from 'node:fs/promises';
import path from 'node:path';
import { encodeUint16Png } from './lib/png.ts';
import { buildRoadGraphs, type GraphWay } from './lib/roadGraph.ts';
import { generateSigns } from './lib/signs.ts';
import { loadOrtho, roofColour } from './lib/ortho.ts';
import jpeg from 'jpeg-js';
import { RAW_DIR, OUT_DIR, ORIGIN, BOUNDS, OSM_HALF, CHUNK_SIZE, HEIGHT_STEP, lonLatToLocal } from './lib/config.ts';
import {
  type Ring, type Vec2, type Rect,
  assembleRings, centroid, cleanRing, clipRingToRect, distPointSegmentSq, hash01, orient,
  pointInPolygon, ringBounds, signedArea,
} from './lib/geom.ts';
import {
  FORMAT_VERSION, type Area, type Building, type ChunkData, type Manifest, type Poi, type Polyline,
} from '../src/world/format.ts';

// ---------------------------------------------------------------------------
// Inputs

interface OsmGeomPoint { lat: number; lon: number }
interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  nodes?: number[];
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: (OsmGeomPoint | null)[];
  members?: { type: string; role: string; geometry?: (OsmGeomPoint | null)[] }[];
  /** From ZABAGED (outside the OSM square) rather than OpenStreetMap. */
  zbg?: boolean;
  /** Pre-clipped line in map coordinates (replaces `geometry` for lines). */
  local?: Vec2[];
}

const CX = Math.round((BOUNDS.maxX - BOUNDS.minX) / CHUNK_SIZE);
const CZ = Math.round((BOUNDS.maxY - BOUNDS.minY) / CHUNK_SIZE);
const SAMPLES_PER_CHUNK = CHUNK_SIZE / HEIGHT_STEP; // intervals

/** Local map coordinates (x east, y north). Converted to the game's z = -y only on output. */
const toMap = (p: OsmGeomPoint): Vec2 => lonLatToLocal(p.lon, p.lat);
const r1 = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// DEM

let dem: Float32Array;
let demW = 0, demH = 0;

/** Bilinear terrain elevation at map coordinates (clamped to the area). */
function elevation(x: number, y: number): number {
  const fx = Math.max(0, Math.min(demW - 1.0001, (x - BOUNDS.minX) / HEIGHT_STEP));
  const fy = Math.max(0, Math.min(demH - 1.0001, (BOUNDS.maxY - y) / HEIGHT_STEP));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const i = y0 * demW + x0;
  return (dem[i] * (1 - tx) + dem[i + 1] * tx) * (1 - ty) + (dem[i + demW] * (1 - tx) + dem[i + demW + 1] * tx) * ty;
}

// ---------------------------------------------------------------------------
// Classification

const ROAD_WIDTH: Record<string, number> = {
  motorway: 14, trunk: 12, primary: 10, secondary: 8.5, tertiary: 7, unclassified: 6, residential: 6,
  living_street: 5, service: 4, pedestrian: 5, track: 3, footway: 2, path: 1.6, cycleway: 2.2, steps: 2,
  bridleway: 2, construction: 5, platform: 3, raceway: 6,
  motorway_link: 7, trunk_link: 7, primary_link: 6.5, secondary_link: 6, tertiary_link: 5.5,
};
const SKIP_HIGHWAY = new Set(['proposed', 'abandoned', 'razed', 'elevator', 'corridor', 'bus_stop', 'via_ferrata']);

const WATERWAY_WIDTH: Record<string, number> = { river: 14, canal: 6, stream: 2.5, ditch: 1.5, drain: 1.5 };

function areaKind(t: Record<string, string>): string | null {
  const lu = t.landuse, le = t.leisure, na = t.natural;
  if (na === 'wood' || lu === 'forest') return 'forest';
  if (na === 'scrub' || na === 'heath') return 'scrub';
  if (le === 'park' || le === 'garden') return 'park';
  if (le && ['pitch', 'playground', 'sports_centre', 'stadium', 'track'].includes(le)) return 'sport';
  if (t.amenity === 'parking') return 'parking';
  if (na === 'grassland') return 'grass';
  switch (lu) {
    case 'grass': case 'meadow': case 'village_green': case 'recreation_ground': case 'greenfield': return 'grass';
    case 'farmland': case 'farmyard': case 'greenhouse_horticulture': return 'farmland';
    case 'orchard': case 'vineyard': case 'plant_nursery': return 'orchard';
    case 'allotments': return 'allotments';
    case 'cemetery': return 'cemetery';
    case 'residential': return 'residential';
    case 'industrial': case 'quarry': case 'landfill': return 'industrial';
    case 'commercial': case 'retail': return 'commercial';
    case 'railway': return 'railway';
    case 'construction': case 'brownfield': return 'construction';
    case 'religious': return 'cemetery';
  }
  return null;
}

/** Purpose of a building, used to pick facades, signs and landmarks. */
function buildingUse(t: Record<string, string>): string | undefined {
  if (t.historic) return `historic:${t.historic}`;
  if (t.shop) return `shop:${t.shop}`;
  if (t.amenity) return `amenity:${t.amenity}`;
  if (t.building === 'supermarket') return 'shop:supermarket';
  if (['church', 'chapel', 'cathedral'].includes(t.building)) return 'amenity:place_of_worship';
  if (t.building === 'train_station') return 'railway:station';
  if (t.man_made === 'water_tower' || /vodárensk/i.test(t.name ?? '')) return 'man_made:water_tower';
  return undefined;
}

/** Building height in metres: OSM tags first, otherwise an estimate from type and size. */
function buildingHeight(t: Record<string, string>, area: number, id: number): { h: number; minH: number; tagged: boolean } {
  const num = (v?: string) => {
    const n = v ? parseFloat(v.replace(',', '.')) : NaN;
    return Number.isFinite(n) ? n : NaN;
  };
  let minH = num(t.min_height);
  if (!Number.isFinite(minH)) {
    const ml = num(t['building:min_level']);
    minH = Number.isFinite(ml) ? ml * 3 : 0;
  }
  const height = num(t.height);
  if (Number.isFinite(height) && height > 1) return { h: height, minH, tagged: true };
  const levels = num(t['building:levels']);
  const roofLevels = num(t['roof:levels']);
  if (Number.isFinite(levels) && levels > 0) {
    return { h: levels * 3 + 0.6 + (Number.isFinite(roofLevels) ? roofLevels * 2.2 : 0), minH, tagged: true };
  }

  const jitter = 0.9 + 0.2 * hash01(id, 7);
  const k = t.building;
  let h: number;
  if (['garage', 'garages', 'carport', 'shed', 'hut', 'kiosk', 'service', 'transformer_tower'].includes(k)) h = 2.8;
  else if (k === 'roof') { h = 4.5; minH = Math.max(minH, 3.2); }
  else if (['church', 'chapel', 'cathedral'].includes(k)) h = k === 'chapel' ? 8 : 16;
  else if (['industrial', 'warehouse', 'manufacture', 'hangar'].includes(k)) h = area > 1500 ? 10 : 7;
  else if (['house', 'detached', 'semidetached_house', 'bungalow', 'farm', 'terrace'].includes(k)) h = 7.5;
  else if (['apartments', 'residential', 'dormitory'].includes(k)) h = area < 160 ? 7.5 : area < 450 ? 10.5 : area < 1200 ? 14 : 17;
  else if (['commercial', 'retail', 'office', 'civic', 'public', 'school', 'hospital', 'government', 'train_station', 'transportation'].includes(k))
    h = area < 300 ? 8 : 11;
  else if (['barn', 'stable', 'farm_auxiliary', 'greenhouse', 'cowshed'].includes(k)) h = 5;
  else h = area < 35 ? 3 : area < 180 ? 7 : area < 700 ? 9.5 : 11; // building=yes and others
  return { h: Math.round(h * jitter * 10) / 10, minH, tagged: false };
}

// ---------------------------------------------------------------------------
// Chunk helpers

/** `osm`: the chunk lies in the OSM square (its features come from OSM, elsewhere from ZABAGED). */
interface ChunkAcc extends ChunkData { rect: Rect; osm: boolean }

const chunks: ChunkAcc[][] = [];
for (let cz = 0; cz < CZ; cz++) {
  chunks.push([]);
  for (let cx = 0; cx < CX; cx++) {
    // Map-space rect (y north). Chunk row cz = 0 is the northernmost.
    const minX = BOUNDS.minX + cx * CHUNK_SIZE;
    const maxY = BOUNDS.maxY - cz * CHUNK_SIZE;
    chunks[cz].push({
      v: FORMAT_VERSION, cx, cz, buildings: [], roads: [], rails: [], waterways: [], water: [], areas: [], trees: [], pois: [],
      rect: { minX, maxX: minX + CHUNK_SIZE, minY: maxY - CHUNK_SIZE, maxY },
      osm: inOsm([minX + CHUNK_SIZE / 2, maxY - CHUNK_SIZE / 2]),
    });
  }
}

function chunkAt(x: number, y: number): ChunkAcc | null {
  const cx = Math.floor((x - BOUNDS.minX) / CHUNK_SIZE);
  const cz = Math.floor((BOUNDS.maxY - y) / CHUNK_SIZE);
  if (cx < 0 || cz < 0 || cx >= CX || cz >= CZ) return null;
  return chunks[cz][cx];
}

/** Does a feature of this source belong in this chunk? (OSM inside the square, ZABAGED outside.) */
const fits = (c: ChunkAcc, zbg?: boolean) => c.osm === !zbg;

// ---------------------------------------------------------------------------
// Joining the two sources at the edge of the OSM square

function inOsm(p: Vec2): boolean {
  return Math.abs(p[0]) < OSM_HALF && Math.abs(p[1]) < OSM_HALF;
}
const SQ_EDGES: [Vec2, Vec2][] = (() => {
  const H = OSM_HALF;
  return [[[-H, -H], [H, -H]], [[H, -H], [H, H]], [[H, H], [-H, H]], [[-H, H], [-H, -H]]];
})();
interface Crossing { p: Vec2; id: number; drive: boolean }
let nextJunction = 9e10;
const NON_DRIVE = new Set(['footway', 'path', 'track', 'steps', 'cycleway', 'pedestrian', 'bridleway', 'service']);

/**
 * Cuts a line to the part inside (OSM) or outside (ZABAGED) the square. Where it crosses the edge
 * a junction node is made; ZABAGED roads snap their crossing to the nearest OSM road crossing
 * (within 35 m, same kind of road) so the two networks join.
 */
function clipLine(line: Vec2[], nodes: number[] | undefined, keepOsm: boolean, drive: boolean, record: Crossing[] | null, snapTo: Crossing[] | null): { line: Vec2[]; nodes?: number[] }[] {
  const has = !!nodes && nodes.length === line.length;
  const keep = (p: Vec2) => inOsm(p) === keepOsm;
  const parts: { line: Vec2[]; nodes: number[] }[] = [];
  let cur: { line: Vec2[]; nodes: number[] } | null = keep(line[0]) ? { line: [line[0]], nodes: [has ? nodes![0] : 0] } : null;
  const cross = (p: Vec2): { p: Vec2; id: number } => {
    if (snapTo) {
      let best: Crossing | null = null, bd = 35;
      for (const c of snapTo) {
        if (c.drive !== drive) continue;
        const d = Math.hypot(c.p[0] - p[0], c.p[1] - p[1]);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) return best;
    }
    const c = { p, id: nextJunction++, drive };
    record?.push(c);
    return c;
  };
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const ts: number[] = [];
    for (const [c, d] of SQ_EDGES) {
      const t = segCross(a, b, c, d);
      if (t !== null && t > 1e-9 && t < 1 - 1e-9) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    for (const t of ts) {
      const x = cross([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      if (cur) {
        cur.line.push(x.p);
        cur.nodes.push(x.id);
        parts.push(cur);
        cur = null;
      } else cur = { line: [x.p], nodes: [x.id] };
    }
    if (cur) {
      cur.line.push(b);
      cur.nodes.push(has ? nodes![i + 1] : 0);
    } else if (keep(b)) cur = { line: [b], nodes: [has ? nodes![i + 1] : 0] };
  }
  if (cur) parts.push(cur);
  return parts.filter((p) => p.line.length >= 2).map((p) => ({ line: p.line, nodes: has ? p.nodes : undefined }));
}

/** Map ring -> flat game-space array [x, z, ...]. */
const flatRing = (ring: Ring): number[] => ring.flatMap(([x, y]) => [r1(x), r1(-y)]);

/**
 * Splits a polyline into per-chunk runs. Each segment goes to every chunk its
 * bounding box (grown by `margin`) overlaps, so wide features are never cut off at
 * chunk edges. `elev` (optional, one value per point) is carried along.
 */
function addPolyline(
  pts: Vec2[],
  margin: number,
  make: (pts: number[], elev?: number[]) => Polyline,
  pick: (c: ChunkAcc) => Polyline[],
  elev?: number[],
) {
  const runs = new Map<ChunkAcc, { idx: number[]; last: number }>();
  const flush = (c: ChunkAcc) => {
    const r = runs.get(c);
    runs.delete(c);
    if (!r || r.idx.length < 2) return;
    const flat = r.idx.flatMap((i) => [r1(pts[i][0]), r1(-pts[i][1])]);
    pick(c).push(make(flat, elev ? r.idx.map((i) => r1(elev[i])) : undefined));
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const cx0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - margin - BOUNDS.minX) / CHUNK_SIZE));
    const cx1 = Math.min(CX - 1, Math.floor((Math.max(a[0], b[0]) + margin - BOUNDS.minX) / CHUNK_SIZE));
    const cz0 = Math.max(0, Math.floor((BOUNDS.maxY - Math.max(a[1], b[1]) - margin) / CHUNK_SIZE));
    const cz1 = Math.min(CZ - 1, Math.floor((BOUNDS.maxY - Math.min(a[1], b[1]) + margin) / CHUNK_SIZE));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = chunks[cz][cx];
        const r = runs.get(c);
        if (r && r.last === i) {
          r.idx.push(i + 1);
          r.last = i + 1;
        } else {
          if (r) flush(c);
          runs.set(c, { idx: [i, i + 1], last: i + 1 });
        }
      }
    }
    // Close runs of chunks that this segment did not touch.
    for (const [c, r] of runs) if (r.last !== i + 1) flush(c);
  }
  for (const c of [...runs.keys()]) flush(c);
}

/** Inserts points every `step` m; new points get unique negative node ids (never junctions). */
function densify(line: Vec2[], nodes: number[], wayId: number, step = 5): { line: Vec2[]; nodes: number[] } {
  const outL: Vec2[] = [line[0]], outN = [nodes[0]];
  let k = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const n = Math.floor(Math.hypot(bx - ax, by - ay) / step);
    for (let j = 1; j < n; j++) {
      outL.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]);
      outN.push(-(wayId * 1000 + ++k));
    }
    outL.push(line[i]);
    outN.push(nodes[i]);
  }
  return { line: outL, nodes: outN };
}

/** Lines a bridge must clear: railways (10 m, room for trains and overhead wires) and rivers/streams (5 m). */
const clearanceLines: { line: Vec2[]; clear: number }[] = [];

function segCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number | null {
  const r1x = b[0] - a[0], r1y = b[1] - a[1], r2x = d[0] - c[0], r2y = d[1] - c[1];
  const den = r1x * r2y - r1y * r2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * r2y - (c[1] - a[1]) * r2x) / den;
  const u = ((c[0] - a[0]) * r1y - (c[1] - a[1]) * r1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/**
 * Deck elevation for bridges: linear between the terrain at both ends, at least 1 m above the
 * terrain in between (reached gradually, so the deck meets the road at the ends without a step),
 * and raised over railways and rivers it crosses, with ramps of at most 10 % towards the ends.
 */
function bridgeElevations(line: Vec2[]): number[] {
  const d = [0];
  for (let i = 1; i < line.length; i++) d.push(d[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = d[d.length - 1] || 1;
  const h0 = elevation(...line[0]), h1 = elevation(...line[line.length - 1]);
  const peaks: { at: number; h: number }[] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    for (const { line: o, clear } of clearanceLines) {
      for (let j = 0; j + 1 < o.length; j++) {
        const t = segCross(line[i], line[i + 1], o[j], o[j + 1]);
        if (t === null) continue;
        const p: Vec2 = [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t];
        peaks.push({ at: d[i] + (d[i + 1] - d[i]) * t, h: elevation(...p) + clear });
      }
    }
  }
  const grade = 0.1;
  return line.map((p, i) => {
    const fromEnd = Math.min(d[i], total - d[i]);
    let e = Math.max(h0 + ((h1 - h0) * d[i]) / total, elevation(p[0], p[1]) + Math.min(1, grade * fromEnd));
    // Only lift the deck where both ends leave room for a ramp (short footbridges stay flat).
    for (const pk of peaks) e = Math.max(e, Math.min(pk.h - grade * Math.abs(d[i] - pk.at), h0 + grade * d[i], h1 + grade * (total - d[i])));
    return e;
  });
}

/** Clips a polygon (outer + holes) into every chunk it overlaps. */
function addPolygon(rings: Ring[], each: (c: ChunkAcc, clipped: Ring[]) => void) {
  const b = ringBounds(rings[0]);
  const cx0 = Math.max(0, Math.floor((b.minX - BOUNDS.minX) / CHUNK_SIZE));
  const cx1 = Math.min(CX - 1, Math.floor((b.maxX - BOUNDS.minX) / CHUNK_SIZE));
  const cz0 = Math.max(0, Math.floor((BOUNDS.maxY - b.maxY) / CHUNK_SIZE));
  const cz1 = Math.min(CZ - 1, Math.floor((BOUNDS.maxY - b.minY) / CHUNK_SIZE));
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = chunks[cz][cx];
      const outer = cleanRing(clipRingToRect(rings[0], c.rect));
      if (outer.length < 3 || Math.abs(signedArea(outer)) < 1) continue;
      const holes = rings
        .slice(1)
        .map((h) => cleanRing(clipRingToRect(h, c.rect)))
        .filter((h) => h.length >= 3 && Math.abs(signedArea(h)) >= 1);
      each(c, [outer, ...holes]);
    }
  }
}

/** Builds polygons (outer ring + its holes) from a way or multipolygon relation. */
function polygonsOf(el: OsmElement): Ring[][] {
  const toRing = (g?: (OsmGeomPoint | null)[]) => (g ?? []).filter((p): p is OsmGeomPoint => !!p).map(toMap);
  if (el.type === 'way') {
    const ring = cleanRing(toRing(el.geometry));
    return ring.length >= 3 ? [[orient(ring, true)]] : [];
  }
  if (el.type === 'relation' && el.members) {
    const outers = assembleRings(el.members.filter((m) => m.type === 'way' && m.role !== 'inner').map((m) => toRing(m.geometry)))
      .map((r) => orient(cleanRing(r), true))
      .filter((r) => r.length >= 3);
    const inners = assembleRings(el.members.filter((m) => m.type === 'way' && m.role === 'inner').map((m) => toRing(m.geometry)))
      .map((r) => orient(cleanRing(r), false))
      .filter((r) => r.length >= 3);
    return outers.map((o) => [o, ...inners.filter((h) => pointInPolygon(h[0], [o]))]);
  }
  return [];
}

function pointInFlat(x: number, z: number, r: number[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Trees

/** Uniform grid of segments for fast "is this point near a road/building" queries. */
class ObstacleIndex {
  private cells = new Map<number, { a: Vec2; b: Vec2; r2: number }[]>();
  private polys = new Map<number, Ring[][]>();
  constructor(private cell = 16) {}
  private key(ix: number, iy: number) { return ix * 100003 + iy; }
  addSegment(a: Vec2, b: Vec2, radius: number) {
    const r = radius;
    const x0 = Math.floor((Math.min(a[0], b[0]) - r) / this.cell), x1 = Math.floor((Math.max(a[0], b[0]) + r) / this.cell);
    const y0 = Math.floor((Math.min(a[1], b[1]) - r) / this.cell), y1 = Math.floor((Math.max(a[1], b[1]) + r) / this.cell);
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
      const k = this.key(ix, iy);
      let l = this.cells.get(k);
      if (!l) this.cells.set(k, (l = []));
      l.push({ a, b, r2: r * r });
    }
  }
  addPolygon(rings: Ring[]) {
    const b = ringBounds(rings[0]);
    for (let ix = Math.floor(b.minX / this.cell); ix <= Math.floor(b.maxX / this.cell); ix++)
      for (let iy = Math.floor(b.minY / this.cell); iy <= Math.floor(b.maxY / this.cell); iy++) {
        const k = this.key(ix, iy);
        let l = this.polys.get(k);
        if (!l) this.polys.set(k, (l = []));
        l.push(rings);
      }
  }
  blocked(p: Vec2): boolean {
    const k = this.key(Math.floor(p[0] / this.cell), Math.floor(p[1] / this.cell));
    for (const s of this.cells.get(k) ?? []) if (distPointSegmentSq(p, s.a, s.b) < s.r2) return true;
    for (const poly of this.polys.get(k) ?? []) if (pointInPolygon(p, poly)) return true;
    return false;
  }
}

/** Chance of a street tree every 11 m on each side of these roads (Blansko's tree-lined streets). */
const STREET_TREE_ROADS: Record<string, number> = { secondary: 0.6, tertiary: 0.55, unclassified: 0.35, residential: 0.3 };

const TREE_RULES: Record<string, { spacing: number; keep: number; conifer: number; hMin: number; hMax: number }> = {
  forest: { spacing: 6.5, keep: 0.85, conifer: 0.45, hMin: 12, hMax: 24 },
  scrub: { spacing: 7, keep: 0.6, conifer: 0.1, hMin: 3, hMax: 6 },
  park: { spacing: 13, keep: 0.65, conifer: 0.15, hMin: 8, hMax: 18 },
  cemetery: { spacing: 12, keep: 0.5, conifer: 0.5, hMin: 6, hMax: 14 },
  orchard: { spacing: 7, keep: 0.9, conifer: 0, hMin: 4, hMax: 6 },
  allotments: { spacing: 14, keep: 0.4, conifer: 0.1, hMin: 4, hMax: 8 },
};

// ---------------------------------------------------------------------------

async function main() {
  const demMeta = JSON.parse(await fs.readFile(path.join(RAW_DIR, 'dem_local.json'), 'utf8'));
  const db = demMeta.bounds ?? {};
  if (demMeta.step !== HEIGHT_STEP || db.minX !== BOUNDS.minX || db.maxX !== BOUNDS.maxX || db.minY !== BOUNDS.minY || db.maxY !== BOUNDS.maxY) {
    throw new Error('DEM grid does not match config; rerun data:dem');
  }
  const demBuf = await fs.readFile(path.join(RAW_DIR, 'dem_local.bin'));
  dem = new Float32Array(demBuf.buffer, demBuf.byteOffset, demBuf.byteLength / 4);
  demW = demMeta.width;
  demH = demMeta.height;

  const ortho = await loadOrtho();
  const osmRaw: { elements: OsmElement[] } = JSON.parse(await fs.readFile(path.join(RAW_DIR, 'osm.json'), 'utf8'));
  let zbgElements: OsmElement[] = [];
  try {
    zbgElements = JSON.parse(await fs.readFile(path.join(RAW_DIR, 'zabaged.json'), 'utf8')).elements;
  } catch {
    console.warn('No data/raw/zabaged.json (npm run data:zabaged): only the OSM square will have features');
  }
  for (const el of zbgElements) el.zbg = true;
  // Lines are cut at the edge of the OSM square: OSM keeps the inside, ZABAGED the outside,
  // and roads crossing the edge are joined. OSM first, so ZABAGED can snap to its crossings.
  const crossings: Crossing[] = [];
  const elements: OsmElement[] = [];
  let partId = 9.5e10;
  for (const el of [...osmRaw.elements, ...zbgElements]) {
    const t = el.tags ?? {};
    const isLine = el.type === 'way' && !!el.geometry && !t.building && t.area !== 'yes' &&
      (!!t.highway || !!t.railway || (!!t.waterway && !!WATERWAY_WIDTH[t.waterway]));
    if (!isLine) {
      elements.push(el);
      continue;
    }
    const pts = el.geometry!.filter((p): p is OsmGeomPoint => !!p);
    const line = pts.map(toMap);
    if (line.length < 2) continue;
    const nodes = el.nodes && el.nodes.length === line.length ? el.nodes : undefined;
    const drive = !!t.highway && !NON_DRIVE.has(t.highway);
    const isRoad = !!t.highway;
    const parts = clipLine(line, nodes, !el.zbg, drive, isRoad && !el.zbg ? crossings : null, isRoad && el.zbg ? crossings : null);
    parts.forEach((part, k) => elements.push({ ...el, id: k ? partId++ : el.id, local: part.line, nodes: part.nodes, geometry: el.geometry }));
  }
  const osm = { elements };
  console.log(`Sources: ${osmRaw.elements.length} OSM + ${zbgElements.length} ZABAGED elements, ${crossings.length} road crossings at the square's edge`);
  const obstacles = new ObstacleIndex();
  const treeAreas: { kind: string; rings: Ring[]; zbg?: boolean }[] = [];
  const treeRows: Vec2[][] = [];
  const allPois: Poi[] = [];
  const graphWays: GraphWay[] = [];
  const railLines: Vec2[][] = [];
  const streetTreeRoads: { id: number; line: Vec2[]; w: number; chance: number }[] = [];
  const stats = { buildings: 0, estimated: 0, roads: 0, rails: 0, waterways: 0, water: 0, areas: 0, trees: 0 };

  for (const el of osm.elements) {
    const t = el.tags ?? {};
    if (el.type !== 'way' || !el.geometry || t.bridge || t.tunnel) continue;
    const clear = t.railway === 'rail' ? 10 : t.waterway === 'river' || t.waterway === 'stream' || t.waterway === 'canal' ? 5 : 0;
    if (clear) clearanceLines.push({ line: el.local ?? el.geometry.filter((p): p is OsmGeomPoint => !!p).map(toMap), clear });
  }

  for (const el of osm.elements) {
    const t = el.tags ?? {};

    // --- Nodes: individual trees and points of interest
    if (el.type === 'node') {
      const [x, y] = lonLatToLocal(el.lon!, el.lat!);
      const c = chunkAt(x, y);
      if (!c || !fits(c, el.zbg)) continue;
      if (t.natural === 'tree') {
        const conifer = t.leaf_type === 'needleleaved' ? 1 : 0;
        c.trees.push(r1(x), r1(-y), r1(8 + 8 * hash01(el.id)), conifer);
        stats.trees++;
        continue;
      }
      const kind = t.amenity ?? (t.shop ? 'shop' : t.railway === 'station' ? 'station' : t.place ? 'place' : null);
      if (kind) {
        const poi: Poi = { id: el.id, kind, x: r1(x), z: r1(-y), ...(t.name ? { name: t.name } : {}), ...(t.shop ? { sub: t.shop } : {}) };
        c.pois.push(poi);
        allPois.push(poi);
      }
      continue;
    }

    let line = el.local ?? (el.geometry ?? []).filter((p): p is OsmGeomPoint => !!p).map(toMap);

    // --- Buildings
    if (t.building && t.building !== 'no') {
      for (const rings of polygonsOf(el)) {
        const outer = rings[0];
        const area = Math.abs(signedArea(outer));
        if (area < 4) continue;
        const [cxm, cym] = centroid(outer);
        const c = chunkAt(cxm, cym);
        if (!c || !fits(c, el.zbg)) continue;
        let gMin = Infinity, gSum = 0;
        for (const [x, y] of outer) {
          const g = elevation(x, y);
          gMin = Math.min(gMin, g);
          gSum += g;
        }
        const gMean = gSum / outer.length;
        const { h, minH, tagged } = buildingHeight(t, area, el.id);
        const b: Building = {
          id: el.id, kind: t.building, h, minH: r1(minH), ground: r1(gMin), top: r1(gMean + h), tagged,
          rings: rings.map(flatRing),
          ...(t['roof:shape'] ? { roof: t['roof:shape'] } : {}),
          ...(t.name ? { name: t.name, label: t.name } : {}),
          ...(buildingUse(t) ? { use: buildingUse(t) } : {}),
          ...(t['building:colour'] ? { colour: t['building:colour'] } : {}),
          ...(t['roof:colour'] ? { roofColour: t['roof:colour'] } : {}),
          ...(ortho ? { roofPhoto: roofColour(ortho, outer, (p) => pointInPolygon(p, rings)) ?? undefined } : {}),
          ...(parseFloat(t['building:levels']) > 0 ? { levels: parseFloat(t['building:levels']) } : {}),
        };
        c.buildings.push(b);
        obstacles.addPolygon(rings);
        stats.buildings++;
        if (!tagged) stats.estimated++;
      }
      continue;
    }

    // --- Roads
    if (t.highway && el.type === 'way' && !SKIP_HIGHWAY.has(t.highway) && line.length >= 2) {
      if (t.area === 'yes') continue; // pedestrian squares etc. are handled as areas later
      const lanes = parseInt(t.lanes ?? '', 10);
      const base = ROAD_WIDTH[t.highway] ?? 4;
      const w = Number.isFinite(lanes) && lanes > 0 && base >= 5 ? Math.max(base, lanes * 3.25) : base;
      const layer = parseInt(t.layer ?? '', 10);
      const tunnel = t.tunnel === 'yes' || t.tunnel === 'culvert';
      const bridge = !!t.bridge && t.bridge !== 'no';
      // Bridge decks get points every 5 m so their height profile can rise over what they cross.
      let nodes = el.nodes;
      if (bridge && nodes && nodes.length === line.length) ({ line, nodes } = densify(line, nodes, el.id));
      if (!tunnel && !bridge && STREET_TREE_ROADS[t.highway]) streetTreeRoads.push({ id: el.id, line, w, chance: STREET_TREE_ROADS[t.highway] });
      if (nodes && nodes.length === line.length && !tunnel) {
        graphWays.push({ id: el.id, tags: t, nodes, pts: line, elev: bridge ? bridgeElevations(line).map((e) => e + 0.1) : undefined });
      }
      addPolyline(line, w / 2 + 1, (pts, elev) => ({
        id: el.id, kind: t.highway, w, pts, ...(elev ? { elev } : {}),
        ...(['sett', 'cobblestone', 'unhewn_cobblestone', 'paving_stones'].includes(t.surface) ? { surface: t.surface } : {}),
        ...(t.footway === 'crossing' ? { crossing: t.crossing ?? 'yes' } : {}),
        ...(t.name ? { name: t.name } : {}),
        ...(bridge ? { bridge: true } : {}),
        ...(tunnel ? { tunnel: true } : {}),
        ...(Number.isFinite(layer) && layer !== 0 ? { layer } : {}),
        ...(t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' ? { oneway: true } : {}),
      }), (c) => c.roads, bridge ? bridgeElevations(line) : undefined);
      if (!tunnel) for (let i = 0; i + 1 < line.length; i++) obstacles.addSegment(line[i], line[i + 1], w / 2 + 1.5);
      stats.roads++;
      continue;
    }

    // --- Railways
    if (t.railway && el.type === 'way' && line.length >= 2) {
      const tunnel = t.tunnel === 'yes';
      const bridge = !!t.bridge && t.bridge !== 'no';
      if (bridge) line = densify(line, line.map((_, i) => i), el.id).line;
      if (!bridge && !tunnel && ['rail', 'light_rail', 'tram', 'narrow_gauge'].includes(t.railway)) railLines.push(line);
      addPolyline(line, 3, (pts, elev) => ({
        id: el.id, kind: t.railway, w: 4, pts, ...(elev ? { elev } : {}),
        ...(bridge ? { bridge: true } : {}),
        ...(tunnel ? { tunnel: true } : {}),
      }), (c) => c.rails, bridge ? bridgeElevations(line) : undefined);
      if (!tunnel) for (let i = 0; i + 1 < line.length; i++) obstacles.addSegment(line[i], line[i + 1], 4);
      stats.rails++;
      continue;
    }

    // --- Water polygons (checked before waterway lines: waterway=riverbank is an area)
    if (t.natural === 'water' || t.waterway === 'riverbank' || t.water || t.landuse === 'basin' || t.landuse === 'reservoir') {
      for (const rings of polygonsOf(el)) {
        addPolygon(rings, (c, clipped) => { if (fits(c, el.zbg)) c.water.push({ id: el.id, kind: t.water ?? 'water', rings: clipped.map(flatRing) }); });
        obstacles.addPolygon(rings);
        stats.water++;
      }
      continue;
    }

    // --- Waterway lines (Svitava, streams)
    if (t.waterway && WATERWAY_WIDTH[t.waterway] && line.length >= 2) {
      const width = parseFloat(t.width ?? '') || WATERWAY_WIDTH[t.waterway];
      const tunnel = t.tunnel === 'yes' || t.tunnel === 'culvert';
      addPolyline(line, width / 2 + 1, (pts) => ({
        id: el.id, kind: t.waterway, w: width, pts,
        ...(t.name ? { name: t.name } : {}),
        ...(tunnel ? { tunnel: true } : {}),
      }), (c) => c.waterways);
      if (!tunnel) for (let i = 0; i + 1 < line.length; i++) obstacles.addSegment(line[i], line[i + 1], width / 2 + 1);
      stats.waterways++;
      continue;
    }

    // --- Tree rows
    if (t.natural === 'tree_row' && line.length >= 2) {
      treeRows.push(line);
      continue;
    }

    // --- Land use / cover areas
    const kind = areaKind(t) ?? (t.highway === 'pedestrian' && t.area === 'yes' ? 'plaza' : null);
    if (kind) {
      for (const rings of polygonsOf(el)) {
        addPolygon(rings, (c, clipped) => { if (fits(c, el.zbg)) c.areas.push({ id: el.id, kind, rings: clipped.map(flatRing) } as Area); });
        if (TREE_RULES[kind]) treeAreas.push({ kind, rings, zbg: el.zbg });
        stats.areas++;
      }
    }
  }

  // --- Procedural trees inside wooded areas (deterministic jittered grid).
  for (const { kind, rings, zbg } of treeAreas) {
    const rule = TREE_RULES[kind];
    const b = ringBounds(rings[0]);
    const s = rule.spacing;
    const x0 = Math.max(BOUNDS.minX, Math.floor(b.minX / s) * s), x1 = Math.min(BOUNDS.maxX, b.maxX);
    const y0 = Math.max(BOUNDS.minY, Math.floor(b.minY / s) * s), y1 = Math.min(BOUNDS.maxY, b.maxY);
    for (let gx = x0; gx <= x1; gx += s) {
      for (let gy = y0; gy <= y1; gy += s) {
        const ix = Math.round(gx / s), iy = Math.round(gy / s);
        if (hash01(ix, iy, 1) > rule.keep) continue;
        const p: Vec2 = [gx + (hash01(ix, iy, 2) - 0.5) * s * 0.9, gy + (hash01(ix, iy, 3) - 0.5) * s * 0.9];
        const c = chunkAt(p[0], p[1]);
        if (!c || !fits(c, zbg)) continue;
        if (!pointInPolygon(p, rings) || obstacles.blocked(p)) continue;
        const conifer = hash01(ix, iy, 4) < rule.conifer ? 1 : 0;
        const h = rule.hMin + (rule.hMax - rule.hMin) * hash01(ix, iy, 5);
        c.trees.push(r1(p[0]), r1(-p[1]), r1(h), conifer);
        stats.trees++;
      }
    }
  }
  // --- Trees seen on the orthophoto (street trees, gardens) that OSM does not map.
  if (ortho) {
    const cell = 5;
    const occupied = new Set<string>();
    const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    for (const row of chunks) for (const c of row) for (let i = 0; i < c.trees.length; i += 4) occupied.add(key(c.trees[i], -c.trees[i + 1]));
    let added = 0;
    for (let gx = BOUNDS.minX + cell / 2; gx < BOUNDS.maxX; gx += cell) {
      for (let gy = BOUNDS.minY + cell / 2; gy < BOUNDS.maxY; gy += cell) {
        if (occupied.has(key(gx, gy))) continue;
        // Average a 3 x 3 m patch: canopies are dark, clearly green and fairly uniform.
        let r = 0, g = 0, b = 0, n = 0;
        for (let dx = -1.5; dx <= 1.5; dx += 1.5) for (let dy = -1.5; dy <= 1.5; dy += 1.5) {
          const c = ortho.sample(gx + dx, gy + dy);
          if (c) { r += c[0]; g += c[1]; b += c[2]; n++; }
        }
        if (n < 5) continue;
        r /= n; g /= n; b /= n;
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        if (!(g > r + 12 && g > b + 14 && lum < 80 && lum > 25)) continue;
        const ix = Math.round(gx), iy = Math.round(gy);
        const p: Vec2 = [gx + (hash01(ix, iy, 21) - 0.5) * 2.5, gy + (hash01(ix, iy, 22) - 0.5) * 2.5];
        if (obstacles.blocked(p)) continue;
        const c = chunkAt(p[0], p[1]);
        if (!c) continue;
        // Darker canopies are usually bigger trees.
        const h = 7 + (80 - lum) / 7 + 3 * hash01(ix, iy, 23);
        c.trees.push(r1(p[0]), r1(-p[1]), r1(h), hash01(ix, iy, 24) < 0.2 ? 1 : 0);
        occupied.add(key(p[0], p[1]));
        added++;
      }
    }
    stats.trees += added;
    console.log(`Added ${added} trees detected on the orthophoto`);
  }

  // --- Street trees on the verges of main and residential roads.
  {
    const cell = 5;
    const taken = new Set<string>();
    const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    for (const row of chunks) for (const c of row) for (let i = 0; i < c.trees.length; i += 4) taken.add(key(c.trees[i], -c.trees[i + 1]));
    let added = 0;
    for (const r of streetTreeRoads) {
      for (const side of [-1, 1]) {
        let acc = 5.5;
        for (let i = 0; i + 1 < r.line.length; i++) {
          const [a, b] = [r.line[i], r.line[i + 1]];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 0.01) continue;
          const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
          while (acc < len) {
            const n = Math.round(acc * 10) + i * 1000;
            if (hash01(r.id, n, side + 30) < r.chance) {
              const off = r.w / 2 + 3;
              const p: Vec2 = [a[0] + dx * acc - dy * off * side, a[1] + dy * acc + dx * off * side];
              const c = chunkAt(p[0], p[1]);
              if (c && !taken.has(key(p[0], p[1])) && !obstacles.blocked(p)) {
                c.trees.push(r1(p[0]), r1(-p[1]), r1(10 + 6 * hash01(r.id, n, 31)), 0);
                taken.add(key(p[0], p[1]));
                added++;
              }
            }
            acc += 11;
          }
          acc -= len;
        }
      }
    }
    stats.trees += added;
    console.log(`Added ${added} street trees`);
  }

  for (const row of treeRows) {
    for (let i = 0; i + 1 < row.length; i++) {
      const [a, b] = [row[i], row[i + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 0; d < len; d += 9) {
        const p: Vec2 = [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len];
        const c = chunkAt(p[0], p[1]);
        if (!c || obstacles.blocked(p)) continue;
        c.trees.push(r1(p[0]), r1(-p[1]), r1(9 + 6 * hash01(Math.round(p[0]), Math.round(p[1]))), 0);
        stats.trees++;
      }
    }
  }

  // --- Give buildings the name and purpose of shops/amenities located inside them.
  let linked = 0;
  for (const poi of allPois) {
    if (!poi.name || poi.kind === 'place') continue;
    const c = chunkAt(poi.x, -poi.z);
    if (!c) continue;
    for (const row of chunks.slice(Math.max(0, c.cz - 1), c.cz + 2)) {
      for (const cc of row.slice(Math.max(0, c.cx - 1), c.cx + 2)) {
        for (const b of cc.buildings) {
          if (b.label && b.use) continue;
          if (!pointInFlat(poi.x, poi.z, b.rings[0])) continue;
          b.label ??= poi.name;
          b.use ??= poi.kind === 'shop' ? `shop:${poi.sub ?? 'yes'}` : `amenity:${poi.kind}`;
          linked++;
        }
      }
    }
  }
  console.log(`Linked ${linked} shops/amenities to their buildings`);

  // --- Heights: Uint16 per chunk, shared edge samples.
  let eMin = Infinity, eMax = -Infinity;
  for (const v of dem) if (v > 0) { eMin = Math.min(eMin, v); eMax = Math.max(eMax, v); }
  const heightBase = Math.floor(eMin) - 10;
  const heightScale = 0.01;
  const enc = (h: number) => Math.max(0, Math.min(65535, Math.round((h - heightBase) / heightScale)));

  // Overwrite files in place (deleting the folder confuses dev-server file watchers).
  await fs.mkdir(path.join(OUT_DIR, 'chunks'), { recursive: true });

  const manifest: Manifest = {
    version: FORMAT_VERSION,
    name: 'Blansko: Open World',
    generated: new Date().toISOString(),
    origin: ORIGIN,
    bounds: { minX: BOUNDS.minX, maxX: BOUNDS.maxX, minZ: -BOUNDS.maxY, maxZ: -BOUNDS.minY },
    chunkSize: CHUNK_SIZE,
    chunksX: CX,
    chunksZ: CZ,
    heightStep: HEIGHT_STEP,
    heightBase,
    heightScale,
    elevation: { min: r1(eMin), max: r1(eMax) },
    overview: { file: 'overview.png', width: 0, height: 0, step: 0 },
    chunks: [],
    graphFile: 'roads.json',
    pois: allPois.filter((p) => p.name),
    attribution: [
      '© přispěvatelé OpenStreetMap (ODbL), openstreetmap.org/copyright',
      'Výškopis: DMR 5G © ČÚZK (CC BY 4.0)',
      'Mapa okolí: ZABAGED® © ČÚZK (CC BY 4.0)',
    ],
  };

  // Traffic signs derived from the road network (see scripts/lib/signs.ts), filed into chunks.
  const parkingRings: Vec2[][] = osm.elements
    .filter((el) => el.tags?.amenity === 'parking' && el.type === 'way' && el.geometry)
    .map((el) => el.geometry!.filter((p): p is OsmGeomPoint => !!p).map(toMap));
  let signCount = 0;
  // Is a point (game coordinates) inside a building? Signs must not stand in walls.
  const inBuilding = (x: number, z: number) => {
    const c = chunkAt(x, -z);
    if (!c) return false;
    for (const b of c.buildings) {
      const o = b.rings[0];
      let inside = false;
      for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) {
        if (o[i + 1] > z !== o[j + 1] > z && x < ((o[j] - o[i]) * (z - o[i + 1])) / (o[j + 1] - o[i + 1]) + o[i]) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  };
  for (const sg of generateSigns(graphWays, railLines, parkingRings, inBuilding)) {
    const c = chunkAt(sg.x, -sg.z);
    if (!c) continue;
    (c.signs ??= []).push(r1(sg.x), r1(sg.z), Math.round(sg.yaw * 100) / 100, sg.tile, Math.round(sg.h * 100) / 100, sg.post);
    signCount++;
  }
  console.log(`Traffic signs: ${signCount}`);
  let bytes = 0;
  const n = SAMPLES_PER_CHUNK + 1;
  for (const row of chunks) {
    for (const c of row) {
      const heights = new Uint16Array(n * n);
      const col0 = c.cx * SAMPLES_PER_CHUNK, row0 = c.cz * SAMPLES_PER_CHUNK;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = enc(dem[(row0 + j) * demW + col0 + i]);
      const base = `chunks/c_${c.cx}_${c.cz}`;
      const { rect: _rect, osm: _osm, ...data } = c;
      const json = JSON.stringify(data);
      await fs.writeFile(path.join(OUT_DIR, base + '.json'), json);
      const png = encodeUint16Png(heights, n, n);
      await fs.writeFile(path.join(OUT_DIR, base + '.png'), png);
      bytes += json.length + png.length;
      manifest.chunks.push({
        cx: c.cx, cz: c.cz, file: base + '.json', heightFile: base + '.png',
        counts: { buildings: c.buildings.length, roads: c.roads.length, trees: c.trees.length / 4 },
      });
    }
  }

  // --- Overview heightmap (every 20th sample -> 40 m grid).
  const stride = 20;
  const ovW = Math.floor((demW - 1) / stride) + 1, ovH = Math.floor((demH - 1) / stride) + 1;
  const ov = new Uint16Array(ovW * ovH);
  for (let j = 0; j < ovH; j++) for (let i = 0; i < ovW; i++) ov[j * ovW + i] = enc(dem[j * stride * demW + i * stride]);
  await fs.rm(path.join(OUT_DIR, 'overview.bin'), { force: true });
  await fs.writeFile(path.join(OUT_DIR, 'overview.png'), encodeUint16Png(ov, ovW, ovH));
  manifest.overview = { file: 'overview.png', width: ovW, height: ovH, step: HEIGHT_STEP * stride };

  // --- Orthophoto ground colours (2.5 m grid, north-up) used under the painted ground cover.
  if (ortho) {
    // At most 4096 px on a side (3 m per pixel for the enlarged area).
    const ext = Math.max(BOUNDS.maxX - BOUNDS.minX, BOUNDS.maxY - BOUNDS.minY);
    const step = Math.max(2.5, Math.ceil((ext / 4096) * 4) / 4);
    const pw = Math.round((BOUNDS.maxX - BOUNDS.minX) / step), ph = Math.round((BOUNDS.maxY - BOUNDS.minY) / step);
    const img = Buffer.alloc(pw * ph * 4);
    for (let j = 0; j < ph; j++)
      for (let i = 0; i < pw; i++) {
        // Average a 3x3 neighbourhood so cars and small details blur away.
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const c = ortho.sample(BOUNDS.minX + (i + 0.5 + dx * 0.33) * step, BOUNDS.maxY - (j + 0.5 + dy * 0.33) * step);
            if (c) { r += c[0]; g += c[1]; b += c[2]; n++; }
          }
        const k = (j * pw + i) * 4;
        img[k] = n ? r / n : 110; img[k + 1] = n ? g / n : 140; img[k + 2] = n ? b / n : 80; img[k + 3] = 255;
      }
    const jpg = jpeg.encode({ data: img, width: pw, height: ph }, 82).data;
    await fs.writeFile(path.join(OUT_DIR, 'ground.jpg'), jpg);
    manifest.groundPhoto = { file: 'ground.jpg', width: pw, height: ph, step };
    manifest.attribution.push('Ortofoto © ČÚZK (CC BY 4.0)');
    console.log(`Ground photo ${pw}x${ph} px, ${(jpg.length / 1e3).toFixed(0)} kB`);
  }

  // --- Road graphs for traffic and pedestrians.
  const graphs = buildRoadGraphs(graphWays, elevation, (p) =>
    p[0] > BOUNDS.minX + 5 && p[0] < BOUNDS.maxX - 5 && p[1] > BOUNDS.minY + 5 && p[1] < BOUNDS.maxY - 5);
  await fs.writeFile(path.join(OUT_DIR, 'roads.json'), JSON.stringify(graphs));
  console.log(`Road graphs: drive ${graphs.drive.nodes.length / 3} nodes / ${graphs.drive.edges.length} edges, ` +
    `walk ${graphs.walk.nodes.length / 3} nodes / ${graphs.walk.edges.length} edges`);

  await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log('Features:', stats);
  console.log(`Wrote ${CX * CZ} chunks (${(bytes / 1e6).toFixed(1)} MB uncompressed) to ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
