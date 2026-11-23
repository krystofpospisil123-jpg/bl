// Paints the ground cover of one chunk (land use, water, rails, roads) into a canvas
// that is draped over the terrain mesh. Roads are therefore always glued to the terrain.
// Runs inside a Web Worker (OffscreenCanvas) as well as on the main thread.
import type { ChunkData, Polyline } from '../format.ts';
import { createCanvas, makeNoiseCanvas, type AnyCanvas } from '../../render/noise.ts';

const BASE = '#6f8f4a'; // meadow
const AREA_FILL: Record<string, string> = {
  farmland: '#a39a63', orchard: '#7c9450', allotments: '#7b8f4c', grass: '#6c9448', park: '#5f8c40', sport: '#5e9a4a',
  cemetery: '#66874a', residential: '#78904f', commercial: '#9a958c', industrial: '#8e8a84', railway: '#857a6c',
  construction: '#8f7b5c', parking: '#5f6163', plaza: '#a9a196', forest: '#4b5e30', scrub: '#5f7339',
};
// Drawing order: later kinds paint over earlier ones.
const AREA_ORDER = [
  'farmland', 'orchard', 'residential', 'commercial', 'industrial', 'railway', 'construction', 'allotments', 'grass',
  'cemetery', 'park', 'scrub', 'forest', 'sport', 'parking', 'plaza',
];
const ROAD_FILL: Record<string, string> = {
  primary: '#4d5155', secondary: '#4f5357', tertiary: '#53575b', residential: '#5a5d61', unclassified: '#5a5d61',
  living_street: '#7d7870', service: '#5f6265', pedestrian: '#a59c90', footway: '#a69d91', path: '#94805f',
  track: '#8a7556', cycleway: '#8b6f68', steps: '#9c978f', bridleway: '#8a7556', construction: '#7a6e5e',
  platform: '#9e9a94', raceway: '#4f5357',
};
const MAJOR = new Set(['primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link', 'trunk']);
const PAVED_EDGE = new Set([...MAJOR, 'residential', 'unclassified', 'service', 'living_street']);

let noiseCanvas: AnyCanvas | null = null;

/** Paints the chunk's ground cover; canvas row 0 is the chunk's north edge (min z). */
export function paintGround(
  data: ChunkData, minX: number, minZ: number, chunkSize: number, size: number,
  /** Orthophoto patch covering the chunk plus `photoMargin` (in metres) on each side. */
  photo?: CanvasImageSource, photoMargin = 0,
): AnyCanvas {
  const c = createCanvas(size, size);
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const s = size / chunkSize;
  g.setTransform(s, 0, 0, s, -minX * s, -minZ * s);
  const px = 1 / s;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  g.fillStyle = BASE;
  g.fillRect(minX, minZ, chunkSize, chunkSize);
  if (photo) {
    // Real colours of fields, meadows and woods from the aerial image.
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(photo, minX - photoMargin, minZ - photoMargin, chunkSize + 2 * photoMargin, chunkSize + 2 * photoMargin);
    // Land-use colours only tint the photo, so its texture shows through.
    g.globalAlpha = 0.4;
  }

  // --- Land use
  const areas = data.areas.slice().sort((a, b) => AREA_ORDER.indexOf(a.kind) - AREA_ORDER.indexOf(b.kind));
  const PAVED = new Set(['parking', 'plaza', 'sport', 'railway']);
  for (const a of areas) {
    if (photo) g.globalAlpha = PAVED.has(a.kind) ? 0.92 : 0.4;
    g.fillStyle = AREA_FILL[a.kind] ?? BASE;
    g.fill(ringsPath(a.rings), 'evenodd');
  }
  g.globalAlpha = 1;

  // Large-scale tonal noise, aligned to world coordinates so it is seamless across chunks.
  noiseCanvas ??= makeNoiseCanvas(128, 7);
  const noise = g.createPattern(noiseCanvas as CanvasImageSource, 'repeat');
  if (noise) {
    noise.setTransform(new DOMMatrix().scale(125 / 128));
    g.globalAlpha = photo ? 0.12 : 0.28;
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = noise;
    g.fillRect(minX, minZ, chunkSize, chunkSize);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }

  // --- Water
  g.fillStyle = '#35545b';
  g.strokeStyle = '#35545b';
  for (const w of data.water) g.fill(ringsPath(w.rings), 'evenodd');
  for (const w of data.waterways) {
    if (w.tunnel) continue;
    g.lineWidth = w.w;
    g.stroke(linePath(w.pts));
  }

  // --- Railways: ballast, sleepers, rails
  for (const r of data.rails) {
    if (r.tunnel || r.bridge || r.kind === 'abandoned') continue;
    const p = linePath(r.pts);
    g.strokeStyle = '#857b70';
    g.lineWidth = 3.6;
    g.stroke(p);
    if (r.kind === 'disused') continue;
    g.strokeStyle = '#5c4c3e';
    g.lineWidth = 2.5;
    g.setLineDash([0.25, 0.4]);
    g.lineCap = 'butt';
    g.stroke(p);
    g.setLineDash([]);
    g.strokeStyle = '#3c3c3e';
    g.lineWidth = 1.6;
    g.stroke(p);
    g.strokeStyle = '#6e6458';
    g.lineWidth = 1.3;
    g.stroke(p);
    g.lineCap = 'round';
  }

  // --- Roads: narrow first, then wide; curbs first, then surfaces, then markings.
  const roads = data.roads.filter((r) => !r.tunnel && !r.bridge).sort((a, b) => a.w - b.w);
  for (const r of roads) {
    if (!PAVED_EDGE.has(r.kind)) continue;
    g.strokeStyle = '#8f8d88';
    g.lineWidth = r.w + 0.8;
    g.stroke(linePath(r.pts));
  }
  for (const r of roads) {
    g.strokeStyle = ROAD_FILL[r.kind] ?? '#5a5d61';
    g.lineWidth = Math.max(r.w, 2 * px);
    if (r.kind === 'steps') {
      g.lineCap = 'butt';
      g.setLineDash([0.3, 0.3]);
    }
    g.stroke(linePath(r.pts));
    g.setLineDash([]);
    g.lineCap = 'round';
  }
  // Centre and edge lines on main roads (only when the texture is detailed enough).
  if (s >= 1) {
    g.strokeStyle = 'rgba(235,235,225,0.85)';
    g.lineCap = 'butt';
    for (const r of roads) {
      if (!MAJOR.has(r.kind)) continue;
      g.lineWidth = 0.15;
      if (!r.oneway) {
        g.setLineDash([3, 6]);
        g.stroke(linePath(r.pts));
        g.setLineDash([]);
      }
      strokeOffset(g, r, r.w / 2 - 0.35);
      strokeOffset(g, r, -(r.w / 2 - 0.35));
    }
    g.lineCap = 'round';
  }

  return c;
}

/** Strokes a line parallel to the polyline at a lateral offset (simple miter-less offset). */
function strokeOffset(g: CanvasRenderingContext2D, r: Polyline, off: number) {
  const p = r.pts;
  const path = new Path2D();
  for (let i = 0; i < p.length; i += 2) {
    const ia = Math.max(0, i - 2), ib = Math.min(p.length - 2, i + 2);
    const dx = p[ib] - p[ia], dz = p[ib + 1] - p[ia + 1];
    const len = Math.hypot(dx, dz) || 1;
    const x = p[i] + (-dz / len) * off, z = p[i + 1] + (dx / len) * off;
    if (i === 0) path.moveTo(x, z);
    else path.lineTo(x, z);
  }
  g.stroke(path);
}

function linePath(pts: number[]): Path2D {
  const p = new Path2D();
  p.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
  return p;
}

function ringsPath(rings: number[][]): Path2D {
  const p = new Path2D();
  for (const r of rings) {
    p.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
    p.closePath();
  }
  return p;
}
