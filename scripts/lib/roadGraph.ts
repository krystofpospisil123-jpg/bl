// Builds the drive and walk graphs from OSM highways (split at shared nodes = junctions).
import type { RoadGraph, GraphEdge } from '../../src/world/format.ts';

export interface GraphWay {
  id: number;
  tags: Record<string, string>;
  nodes: number[];
  pts: [number, number][]; // map coords (x east, y north)
  /** Optional deck elevation per point (bridges). */
  elev?: number[];
}

const DRIVE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service',
]);
const WALK = new Set(['footway', 'pedestrian', 'path', 'living_street', 'residential', 'unclassified', 'tertiary', 'secondary', 'steps', 'cycleway']);
/** Roads where pedestrians walk on a sidewalk beside the carriageway rather than on the centreline. */
export const SIDEWALK_KINDS = new Set(['residential', 'unclassified', 'tertiary', 'secondary']);

const SPEED_KMH: Record<string, number> = {
  primary: 50, secondary: 50, tertiary: 45, unclassified: 40, residential: 30, living_street: 15, service: 20,
  primary_link: 40, secondary_link: 40, tertiary_link: 35,
};

function isDrivable(t: Record<string, string>): boolean {
  if (!DRIVE.has(t.highway)) return false;
  if (t.highway === 'service' && t.service && t.service !== 'alley') return false; // skip driveways, parking aisles
  if (t.access === 'no' || t.access === 'private' || t.motor_vehicle === 'no') return false;
  if (t.area === 'yes') return false;
  return true;
}

function isWalkable(t: Record<string, string>): boolean {
  if (!WALK.has(t.highway) || t.area === 'yes') return false;
  if (t.access === 'no' || t.access === 'private' || t.foot === 'no') return false;
  return true;
}

function build(
  ways: GraphWay[],
  elevation: (x: number, y: number) => number,
  limit: number,
  maxStep: number,
  attrs: (w: GraphWay) => Omit<GraphEdge, 'a' | 'b' | 'pts' | 'len'>,
): RoadGraph {
  // Junctions: nodes used by more than one way, or way endpoints.
  const use = new Map<number, number>();
  for (const w of ways) for (const n of w.nodes) use.set(n, (use.get(n) ?? 0) + 1);
  const nodeIndex = new Map<number, number>();
  const nodes: number[] = [];
  const edges: GraphEdge[] = [];
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const inside = (p: [number, number]) => Math.abs(p[0]) < limit && Math.abs(p[1]) < limit;

  const nodeOf = (w: GraphWay, i: number) => {
    const osm = w.nodes[i];
    let idx = nodeIndex.get(osm);
    if (idx === undefined) {
      idx = nodes.length / 3;
      nodeIndex.set(osm, idx);
      const [x, y] = w.pts[i];
      nodes.push(r1(x), r1(w.elev ? w.elev[i] : elevation(x, y)), r1(-y));
    }
    return idx;
  };

  for (const w of ways) {
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      const junction = i === w.nodes.length - 1 || (use.get(w.nodes[i]) ?? 0) > 1;
      if (!junction) continue;
      const seg = w.pts.slice(start, i + 1);
      if (seg.every(inside)) {
        // Resample so linear interpolation follows the terrain closely.
        const pts: number[] = [];
        let len = 0;
        for (let k = 0; k < seg.length; k++) {
          const [x, y] = seg[k];
          const e = w.elev ? w.elev[start + k] : elevation(x, y);
          if (k > 0) {
            const [px, py] = seg[k - 1];
            const pe = w.elev ? w.elev[start + k - 1] : elevation(px, py);
            const d = Math.hypot(x - px, y - py);
            len += d;
            const steps = Math.ceil(d / maxStep);
            for (let s = 1; s < steps; s++) {
              const t = s / steps;
              const ix = px + (x - px) * t, iy = py + (y - py) * t;
              pts.push(r1(ix), r1(w.elev ? pe + (e - pe) * t : elevation(ix, iy)), r1(-iy));
            }
          }
          pts.push(r1(x), r1(e), r1(-y));
        }
        if (len > 0.5) edges.push({ a: nodeOf(w, start), b: nodeOf(w, i), pts, len: r1(len), ...attrs(w) });
      }
      start = i;
    }
  }
  return keepLargestComponent({ nodes, edges });
}

/** Drops small disconnected islands so agents never get stuck on them. */
function keepLargestComponent(g: RoadGraph): RoadGraph {
  const n = g.nodes.length / 3;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const e of g.edges) parent[find(e.a)] = find(e.b);
  const size = new Map<number, number>();
  for (let i = 0; i < n; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
  let best = -1, bestSize = 0;
  for (const [root, s] of size) if (s > bestSize) { best = root; bestSize = s; }
  // Re-index the kept nodes.
  const map = new Map<number, number>();
  const nodes: number[] = [];
  for (let i = 0; i < n; i++) if (find(i) === best) {
    map.set(i, nodes.length / 3);
    nodes.push(g.nodes[i * 3], g.nodes[i * 3 + 1], g.nodes[i * 3 + 2]);
  }
  const edges = g.edges.filter((e) => map.has(e.a)).map((e) => ({ ...e, a: map.get(e.a)!, b: map.get(e.b)! }));
  return { nodes, edges };
}

export function buildRoadGraphs(ways: GraphWay[], elevation: (x: number, y: number) => number, limit: number) {
  const drive = build(ways.filter((w) => isDrivable(w.tags)), elevation, limit, 8, (w) => {
    const t = w.tags;
    const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' || t.highway.endsWith('_link') && t.oneway !== 'no';
    const lanes = parseInt(t.lanes ?? '', 10);
    return {
      kind: t.highway,
      oneway: oneway || undefined,
      reverse: t.oneway === '-1' || undefined,
      lanes: Number.isFinite(lanes) ? lanes : oneway ? 1 : 2,
      speed: Math.round((parseInt(t.maxspeed ?? '', 10) || SPEED_KMH[t.highway] || 30) / 3.6 * 10) / 10,
    };
  });
  const walk = build(ways.filter((w) => isWalkable(w.tags)), elevation, limit, 6, (w) => ({
    kind: w.tags.highway,
    lanes: 0,
    speed: 0,
  }));
  return { drive, walk };
}
