// Downloads traffic-sign related OSM nodes (stop, give way, crossings, traffic signals, signs,
// calming) for the Blansko area. Output: data/raw/signs.json (Overpass JSON, nodes only).
import fs from 'node:fs/promises';
import path from 'node:path';
import { RAW_DIR, fetchBBox } from './lib/config.ts';
import { fetchWithRetry } from './lib/http.ts';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const b = fetchBBox();
const bbox = `${b.s.toFixed(6)},${b.w.toFixed(6)},${b.n.toFixed(6)},${b.e.toFixed(6)}`;
const query = `[out:json][timeout:120][bbox:${bbox}];
(
  node["highway"~"^(stop|give_way|traffic_signals|crossing|speed_camera|mini_roundabout|turning_circle|motorway_junction)$"];
  node["traffic_sign"];
  node["traffic_calming"];
  node["railway"~"^(level_crossing|crossing)$"];
  node["amenity"="school"];
  node["amenity"="kindergarten"];
);
out body;`;

await fs.mkdir(RAW_DIR, { recursive: true });
for (const endpoint of ENDPOINTS) {
  console.log(`Querying ${endpoint} ...`);
  try {
    const res = await fetchWithRetry(
      endpoint,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'blansko-open-world-data/0.1' }, body: 'data=' + encodeURIComponent(query) },
      { retries: 2 },
    );
    const text = await res.text();
    const json = JSON.parse(text);
    if (!Array.isArray(json.elements)) throw new Error('Unexpected Overpass response');
    await fs.writeFile(path.join(RAW_DIR, 'signs.json'), text);
    console.log(`Saved ${json.elements.length} nodes`);
    process.exit(0);
  } catch (err) {
    console.warn(`  failed: ${(err as Error).message}`);
  }
}
console.error('All endpoints failed.');
process.exit(1);
