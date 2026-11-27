// Downloads the map outside the original Blansko square from ČÚZK ZABAGED (the Czech base
// topographic database, CC BY 4.0) and converts it to OSM-like elements (the same shape as the
// Overpass output), so build-chunks can treat both sources alike. Covers Jedovnice, Kuničky and
// the Moravian Karst between them. Output: data/raw/zabaged.json
//
// Buildings, roads (II./III. class, streets with names, unregistered roads, forest tracks,
// paths), railways, streams, ponds, forests, fields, meadows, gardens, cemeteries, parking,
// villages (place names) and a few amenities (fuel, post, police, town hall, stations).
import fs from 'node:fs/promises';
import path from 'node:path';
import { RAW_DIR, BOUNDS, OSM_HALF, boundsSJTSK, lonLatToLocal } from './lib/config.ts';
import { fetchWithRetry } from './lib/http.ts';

const SERVICE = 'https://ags.cuzk.gov.cz/arcgis/rest/services/ZABAGED_POLOHOPIS/MapServer';
const RUIAN = 'https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/MapServer';

type Tags = Record<string, string>;
interface Pt { lat: number; lon: number }
interface El {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags: Tags;
  geometry?: Pt[];
  members?: { type: 'way'; role: string; geometry: Pt[] }[];
}
type Attrs = Record<string, string | number | null>;
interface Feature { attributes: Attrs; geometry: { x?: number; y?: number; paths?: number[][][]; rings?: number[][][] } }

/** ZABAGED element ids live above every OSM id (5e10 + layer * 1e8 + OBJECTID). */
const elId = (layer: number, oid: number) => 5e10 + layer * 1e8 + oid;
/** Extra parts of multi-part features. */
let nextPart = 7e10;
/** Line vertices get node ids by position, so segments that meet share a junction. */
const nodeIds = new Map<string, number>();
let nextNode = 8e10;
function nodeAt(p: Pt): number {
  const k = `${Math.round(p.lon * 2e6)},${Math.round(p.lat * 2e6)}`;
  let id = nodeIds.get(k);
  if (id === undefined) nodeIds.set(k, (id = nextNode++));
  return id;
}

async function query(layer: number, fields: string, simplify = 0, service = SERVICE, oid = 'OBJECTID'): Promise<Feature[]> {
  const e = boundsSJTSK(BOUNDS, 120);
  const out: Feature[] = [];
  for (let offset = 0; ; offset += 2000) {
    const params = new URLSearchParams({
      where: '1=1', geometry: `${e.xmin},${e.ymin},${e.xmax},${e.ymax}`, geometryType: 'esriGeometryEnvelope', inSR: '5514',
      spatialRel: 'esriSpatialRelIntersects', outFields: `${oid},${fields}`, returnGeometry: 'true', outSR: '4326',
      geometryPrecision: '7', orderByFields: oid, resultOffset: String(offset), resultRecordCount: '2000', f: 'json',
      ...(simplify ? { maxAllowableOffset: String(simplify) } : {}),
    });
    const res = await fetchWithRetry(`${service}/${layer}/query`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString(),
    }, { timeoutMs: 300_000, retries: 5 });
    const d = (await res.json()) as { features?: Feature[]; exceededTransferLimit?: boolean; error?: { message: string } };
    if (d.error) throw new Error(`layer ${layer}: ${d.error.message}`);
    out.push(...(d.features ?? []));
    if (!d.exceededTransferLimit && (d.features?.length ?? 0) < 2000) break;
  }
  return out;
}

const toPts = (c: number[][]): Pt[] => c.map(([lon, lat]) => ({ lon, lat }));

/** True when a feature lies wholly inside the OSM square (it is mapped from OSM there). */
function insideOsm(pts: Pt[]): boolean {
  const lim = OSM_HALF - 60;
  return pts.every((p) => {
    const [x, y] = lonLatToLocal(p.lon, p.lat);
    return Math.abs(x) < lim && Math.abs(y) < lim;
  });
}

const els: El[] = [];
const counts: Record<string, number> = {};
const count = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };

function addLines(layer: number, f: Feature, tags: Tags) {
  (f.geometry.paths ?? []).forEach((path, k) => {
    const g = toPts(path);
    if (g.length < 2 || insideOsm(g)) return;
    els.push({ type: 'way', id: k ? nextPart++ : elId(layer, Number(f.attributes.OBJECTID)), tags, geometry: g, nodes: g.map(nodeAt) });
    count(tags.highway ?? tags.railway ?? tags.waterway ?? 'line');
  });
}

function addPolygon(layer: number, f: Feature, tags: Tags) {
  const rings = (f.geometry.rings ?? []).map(toPts).filter((r) => r.length >= 4);
  if (!rings.length || insideOsm(rings[0])) return;
  const id = elId(layer, Number(f.attributes.OBJECTID));
  // ArcGIS: outer rings clockwise, holes counter-clockwise (x = lon, y = lat).
  const area = (r: Pt[]) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.lon * q.lat - q.lon * p.lat; }, 0);
  if (rings.length === 1) els.push({ type: 'way', id, tags, geometry: rings[0] });
  else els.push({ type: 'relation', id, tags: { ...tags, type: 'multipolygon' }, members: rings.map((r) => ({ type: 'way', role: area(r) < 0 ? 'outer' : 'inner', geometry: r })) });
  count(tags.building ? 'building' : tags.landuse ?? tags.natural ?? tags.leisure ?? tags.amenity ?? 'area');
}

function addPoint(layer: number, f: Feature, tags: Tags) {
  const { x, y } = f.geometry;
  if (x === undefined || y === undefined || insideOsm([{ lon: x, lat: y }])) return;
  els.push({ type: 'node', id: elId(layer, Number(f.attributes.OBJECTID)), lon: x, lat: y, tags });
  count(tags.place ? 'place' : tags.amenity ?? tags.railway ?? tags.natural ?? 'point');
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const named = (tags: Tags, name: unknown): Tags => (str(name) ? { ...tags, name: str(name)! } : tags);

/** RÚIAN building points (floors and use), indexed on a 20 m grid in local metres. */
const ruian = new Map<string, { x: number; y: number; floors: number; use: number }[]>();
const RG = 20;

/** Floors and use of the RÚIAN buildings inside a footprint (the tallest, the main use). */
function ruianInfo(ring: Pt[]): { floors: number; use: number } | null {
  const loc = ring.map((p) => lonLatToLocal(p.lon, p.lat));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of loc) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  let best: { floors: number; use: number } | null = null;
  for (let gx = Math.floor(minX / RG); gx <= Math.floor(maxX / RG); gx++)
    for (let gy = Math.floor(minY / RG); gy <= Math.floor(maxY / RG); gy++)
      for (const p of ruian.get(`${gx},${gy}`) ?? []) {
        let inside = false;
        for (let i = 0, j = loc.length - 1; i < loc.length; j = i++) {
          if (loc[i][1] > p.y !== loc[j][1] > p.y && p.x < ((loc[j][0] - loc[i][0]) * (p.y - loc[i][1])) / (loc[j][1] - loc[i][1]) + loc[i][0]) inside = !inside;
        }
        if (inside && (!best || p.floors > best.floors)) best = { floors: p.floors, use: p.use };
      }
  return best;
}

/** Building tag from the footprint size and RÚIAN use (6 flats, 7 family house, 8 cottage, 18 garage). */
function residentialKind(area: number, use: number | undefined, floors: number): string {
  if (use === 18 || area < 40) return 'garage';
  if (use === 6 || floors >= 4) return 'apartments';
  if (use === 7 || use === 8) return area > 450 ? 'terrace' : 'house';
  if (area < 450) return 'house';
  if (area < 2500) return 'terrace';
  return 'industrial';
}

function buildingTags(kind: string): Tags {
  const k = kind.toLowerCase();
  if (k.includes('kostel')) return { building: 'church' };
  if (k.includes('škola')) return { building: 'school', amenity: 'school' };
  if (k.includes('nemocnice')) return { building: 'hospital' };
  if (k.includes('chov')) return { building: 'farm_auxiliary' };
  if (k.includes('obchodní')) return { building: 'retail' };
  if (k.includes('průmysl') || k.includes('rozvodna') || k.includes('čerpací') || k.includes('přečerpávací')) return { building: 'industrial' };
  if (k.includes('hangár') || k.includes('sklad')) return { building: 'warehouse' };
  if (k.includes('hala') || k.includes('bazén')) return { building: 'sports_hall' };
  if (k.includes('pošta')) return { building: 'civic', amenity: 'post_office' };
  if (k.includes('hasič')) return { building: 'civic', amenity: 'fire_station' };
  if (k.includes('správní')) return { building: 'civic', amenity: 'townhall' };
  if (k.includes('polic')) return { building: 'civic', amenity: 'police' };
  if (k.includes('muzeum') || k.includes('kulturní')) return { building: 'civic' };
  return { building: 'yes' };
}

async function main() {
  const step = async (name: string, layer: number, fields: string, fn: (f: Feature) => void, simplify = 0) => {
    const fs_ = await query(layer, fields, simplify);
    fs_.forEach(fn);
    console.log(`${name}: ${fs_.length}`);
  };
  // Floors and use of every building from RÚIAN (points), for heights and roofs.
  const pts = await query(2, 'pocetpodlazi,zpusobvyuzitikod', 0, RUIAN, 'objectid');
  for (const f of pts) {
    if (f.geometry.x === undefined) continue;
    const [x, y] = lonLatToLocal(f.geometry.x, f.geometry.y!);
    const k = `${Math.floor(x / RG)},${Math.floor(y / RG)}`;
    (ruian.get(k) ?? ruian.set(k, []).get(k)!).push({ x, y, floors: Number(f.attributes.pocetpodlazi ?? 0), use: Number(f.attributes.zpusobvyuzitikod ?? 0) });
  }
  console.log(`RÚIAN building points: ${pts.length}`);
  // Buildings.
  await step('budovy', 99, 'jmeno,druhbud', (f) => {
    let tags = buildingTags(String(f.attributes.druhbud ?? ''));
    const ring = f.geometry.rings?.[0] ? toPts(f.geometry.rings[0]) : [];
    const info = ring.length ? ruianInfo(ring) : null;
    const floors = info?.floors && info.floors < 30 ? info.floors : 0;
    if (tags.building === 'yes') {
      const loc = ring.map((p) => lonLatToLocal(p.lon, p.lat));
      const area = Math.abs(loc.reduce((s, p, i) => { const q = loc[(i + 1) % loc.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
      tags = { building: residentialKind(area, info?.use, floors) };
    }
    if (floors && tags.building !== 'garage') tags['building:levels'] = String(floors);
    addPolygon(99, f, named(tags, f.attributes.jmeno));
  });
  await step('kůlny', 105, 'jmeno', (f) => addPolygon(105, f, { building: 'shed' }));
  await step('hrady', 101, 'jmeno', (f) => addPolygon(101, f, named({ building: 'castle', historic: 'castle' }, f.attributes.jmeno)));
  await step('zámky', 102, 'jmeno', (f) => addPolygon(102, f, named({ building: 'castle', historic: 'castle' }, f.attributes.jmeno)));

  // Roads. Streets that run along a road (the same carriageway) only lend it their name.
  const roads: El[] = [];
  const pushRoad = (layer: number, f: Feature, tags: Tags) => {
    const before = els.length;
    addLines(layer, f, tags);
    roads.push(...els.slice(before));
  };
  await step('silnice', 79, 'typsil_p,cislouseku', (f) => {
    const t = String(f.attributes.typsil_p ?? '');
    const hw = t.includes('dálnice') ? 'motorway' : t.includes('I. třídy') && !t.includes('II') && !t.includes('III') ? 'primary' : t.includes('III.') ? 'tertiary' : 'secondary';
    pushRoad(79, f, { highway: hw, surface: 'asphalt' });
  });
  await step('silnice neevidované', 80, 'jmeno', (f) => pushRoad(80, f, named({ highway: 'unclassified' }, f.attributes.jmeno)));
  const streets: { f: Feature; tags: Tags }[] = [];
  await step('ulice', 84, 'nazev,typulice_p', (f) => {
    const t = String(f.attributes.typulice_p ?? '');
    if (t.includes('neexistující')) return;
    const hw = t.includes('chodník') || t.includes('nesjízdná') ? 'footway' : t.includes('mimo sídlo') ? 'unclassified' : 'residential';
    streets.push({ f, tags: named({ highway: hw }, f.attributes.nazev) });
  });
  // Grid of road segments to find streets lying on a road.
  const cell = 20, grid = new Map<string, { a: [number, number]; b: [number, number]; el: El }[]>();
  for (const r of roads) {
    const p = r.geometry!.map((q) => lonLatToLocal(q.lon, q.lat));
    for (let i = 0; i + 1 < p.length; i++) {
      const x0 = Math.floor(Math.min(p[i][0], p[i + 1][0]) / cell), x1 = Math.floor(Math.max(p[i][0], p[i + 1][0]) / cell);
      const y0 = Math.floor(Math.min(p[i][1], p[i + 1][1]) / cell), y1 = Math.floor(Math.max(p[i][1], p[i + 1][1]) / cell);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push({ a: p[i], b: p[i + 1], el: r });
      }
    }
  }
  const nearRoad = (x: number, y: number): El | null => {
    for (const s of grid.get(`${Math.floor(x / cell)},${Math.floor(y / cell)}`) ?? []) {
      const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - s.a[0]) * dx + (y - s.a[1]) * dy) / l2));
      if (Math.hypot(s.a[0] + dx * t - x, s.a[1] + dy * t - y) < 5) return s.el;
    }
    return null;
  };
  let merged = 0;
  for (const { f, tags } of streets) {
    const paths = f.geometry.paths ?? [];
    const pts = paths.flat().map(([lon, lat]) => lonLatToLocal(lon, lat));
    // Sample along the street: if most samples sit on a road, it is that road.
    const samples: [number, number][] = [];
    for (let i = 0; i + 1 < pts.length; i++) for (let t = 0; t < 1; t += 0.25) samples.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
    const hits = samples.map(([x, y]) => nearRoad(x, y));
    if (samples.length && hits.filter(Boolean).length / samples.length > 0.7) {
      const road = hits.find(Boolean)!;
      if (tags.name && !road.tags.name) road.tags.name = tags.name;
      merged++;
      continue;
    }
    addLines(84, f, tags);
  }
  console.log(`  ${merged} streets lie on a road (name passed on)`);
  await step('cesty', 83, 'typcesty_p,jmeno', (f) => addLines(83, f, named({ highway: 'track' }, f.attributes.jmeno)));
  await step('pěšiny', 82, 'jmeno', (f) => addLines(82, f, named({ highway: 'path' }, f.attributes.jmeno)));
  await step('železnice', 75, 'jmeno', (f) => addLines(75, f, { railway: 'rail' }));
  await step('vlečky', 76, 'jmeno', (f) => addLines(76, f, { railway: 'rail' }));

  // Water.
  await step('vodní toky', 93, 'jmeno,typtoku_p', (f) => {
    if (String(f.attributes.typtoku_p ?? '').includes('podzemní')) return; // the karst rivers underground
    addLines(93, f, named({ waterway: /svitava/i.test(String(f.attributes.jmeno ?? '')) ? 'river' : 'stream' }, f.attributes.jmeno));
  });
  await step('vodní plochy', 132, 'jmeno,typ_vp_p', (f) => addPolygon(132, f, named({ natural: 'water', water: /rybník/.test(String(f.attributes.typ_vp_p ?? '')) ? 'pond' : 'lake' }, f.attributes.jmeno)));

  // Land cover (simplified to ~1 m: the polygons are huge).
  const s = 0.00001;
  await step('lesy', 142, 'fid_zbg', (f) => addPolygon(142, f, { natural: 'wood' }), s);
  await step('křoviny', 140, 'fid_zbg', (f) => addPolygon(140, f, { natural: 'scrub' }), s);
  await step('sady a zahrady', 135, 'fid_zbg', (f) => addPolygon(135, f, { landuse: 'allotments' }), s);
  await step('orná půda', 138, 'fid_zbg', (f) => addPolygon(138, f, { landuse: 'farmland' }), s);
  await step('louky', 139, 'fid_zbg', (f) => addPolygon(139, f, { landuse: 'meadow' }), s);
  await step('zeleň', 134, 'fid_zbg', (f) => addPolygon(134, f, { leisure: 'park' }), s);
  await step('hřbitovy', 116, 'fid_zbg', (f) => addPolygon(116, f, { landuse: 'cemetery' }), s);
  await step('lomy', 118, 'fid_zbg', (f) => addPolygon(118, f, { landuse: 'quarry' }), s);
  await step('areály', 114, 'jmeno', (f) => addPolygon(114, f, { landuse: 'industrial' }), s);
  await step('plochy v sídlech', 115, 'fid_zbg', (f) => addPolygon(115, f, { landuse: 'residential' }), s);
  await step('parkoviště', 123, 'fid_zbg', (f) => addPolygon(123, f, { amenity: 'parking' }));
  await step('kolejiště', 122, 'fid_zbg', (f) => addPolygon(122, f, { landuse: 'railway' }), s);

  // Places and amenities.
  await step('obce', 3, 'nazev,poc_obyv', (f) => addPoint(3, f, named({ place: Number(f.attributes.poc_obyv ?? 0) > 2000 ? 'town' : 'village' }, f.attributes.nazev)));
  await step('pumpy', 35, 'typcs_p', (f) => addPoint(35, f, { amenity: 'fuel' }));
  await step('pošty', 46, 'nazev', (f) => addPoint(46, f, named({ amenity: 'post_office' }, f.attributes.nazev)));
  await step('policie', 43, 'fid_zbg', (f) => addPoint(43, f, { amenity: 'police' }));
  await step('úřady', 45, 'fid_zbg', (f) => addPoint(45, f, { amenity: 'townhall' }));
  await step('nádraží', 58, 'zst_p', (f) => addPoint(58, f, named({ railway: 'station' }, f.attributes.zst_p)));
  await step('stromy', 14, 'jmeno', (f) => addPoint(14, f, { natural: 'tree' }));

  await fs.writeFile(path.join(RAW_DIR, 'zabaged.json'), JSON.stringify({ source: 'ČÚZK ZABAGED', elements: els }));
  console.log('Elements:', counts, 'total', els.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
