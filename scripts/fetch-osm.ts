// Downloads OpenStreetMap features for the Blansko area from the Overpass API.
// Output: data/raw/osm.json (Overpass JSON with inline geometry).
//
// Manual fallback (if the API is unreachable): open https://overpass-turbo.eu,
// paste the query printed by `npm run data:osm -- --print-query`, run it, then
// Export -> "raw OSM data" (JSON) and save it as data/raw/osm.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RAW_DIR, fetchBBox } from './lib/config.ts';
import { fetchWithRetry } from './lib/http.ts';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export function buildQuery(): string {
  const b = fetchBBox();
  const bbox = `${b.s.toFixed(6)},${b.w.toFixed(6)},${b.n.toFixed(6)},${b.e.toFixed(6)}`;
  return `[out:json][timeout:180][bbox:${bbox}];
(
  way["building"];
  relation["building"]["type"="multipolygon"];
  way["building:part"];
  way["highway"];
  way["railway"~"^(rail|tram|light_rail|narrow_gauge|disused|abandoned)$"];
  way["waterway"];
  way["natural"="water"];
  relation["natural"="water"];
  way["water"];
  way["landuse"];
  relation["landuse"]["type"="multipolygon"];
  way["leisure"~"^(park|garden|pitch|playground|sports_centre|stadium|track)$"];
  relation["leisure"="park"];
  way["natural"~"^(wood|scrub|grassland|heath|tree_row)$"];
  relation["natural"~"^(wood|scrub)$"];
  way["amenity"="parking"];
  way["barrier"~"^(wall|retaining_wall)$"];
  way["man_made"="bridge"];
  node["natural"="tree"];
  node["amenity"~"^(fuel|police|hospital|pharmacy|cafe|restaurant|pub|fast_food|bank|post_office|townhall)$"];
  node["shop"];
  node["railway"="station"];
  node["place"];
);
out geom qt;`;
}

async function main() {
  const query = buildQuery();
  if (process.argv.includes('--print-query')) {
    console.log(query);
    return;
  }
  await fs.mkdir(RAW_DIR, { recursive: true });
  const outFile = path.join(RAW_DIR, 'osm.json');

  for (const endpoint of ENDPOINTS) {
    console.log(`Querying ${endpoint} ...`);
    try {
      const res = await fetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'blansko-open-world-data/0.1' },
          body: 'data=' + encodeURIComponent(query),
        },
        { retries: 2 },
      );
      const text = await res.text();
      const json = JSON.parse(text);
      if (!Array.isArray(json.elements)) throw new Error('Unexpected Overpass response');
      await fs.writeFile(outFile, text);
      console.log(`Saved ${json.elements.length} elements to ${path.relative(process.cwd(), outFile)}`);
      return;
    } catch (err) {
      console.warn(`  ${endpoint} failed: ${(err as Error).message}`);
    }
  }
  console.error(
    '\nAll Overpass endpoints failed. Download the data manually:\n' +
      '  1. Run: npm run data:osm -- --print-query\n' +
      '  2. Paste the query into https://overpass-turbo.eu and run it\n' +
      '  3. Export -> raw OSM data (JSON), save as data/raw/osm.json',
  );
  process.exit(1);
}

main();
