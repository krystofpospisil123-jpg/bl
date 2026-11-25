// Derives traffic signs from the road network, following Czech practice (vyhláška 294/2015):
//  - priority at junctions by road class: P2 "hlavní pozemní komunikace" on the through road,
//    P4 "dej přednost v jízdě" (P6 "stůj" onto a much bigger road) on the side roads, nothing where
//    the roads are equal (right-hand rule);
//  - roundabouts: P4 together with the blue C1 circle on every entry;
//  - speed limits (B20a) where the limit changes, including the "50" that ends a restricted stretch;
//  - pedestrian crossings: IP6 on both sides of every zebra, on the right-hand kerb of each direction;
//  - one-way streets: IP4a at the entrance, B2 "zákaz vjezdu" at the exit end;
//  - level crossings: the St Andrew's cross on both approaches;
//  - car parks: IP11a at the entrance.
// Signs stand on the right-hand kerb facing oncoming traffic, bottom edge 2.2 m above the pavement.
// OSM's own stop / give_way nodes could not be downloaded, so priority follows road class.
import type { GraphWay } from './roadGraph.ts';

export type Vec2 = [number, number];

/** Tile numbers in the sign atlas (src/world/builders/trafficSigns.ts draws them in this order). */
export const TILE = { s20: 0, s30: 1, s40: 2, s50: 3, s60: 4, s70: 5, s80: 6, p2: 7, p4: 8, p6: 9, ip6: 10, ip4: 11, b2: 12, ip11: 13, c1: 14, cross: 15 } as const;
/** Plate size (m) per tile, used for stacking plates on one post. */
export const SIZE = [0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.9, 0.75, 0.6, 0.6, 0.7, 0.6, 0.7, 0.9];

export interface Sign {
  x: number;
  /** Game coordinates: x east, z south. */
  z: number;
  /** Direction the sign face looks (rad, 0 = +z). */
  yaw: number;
  tile: number;
  /** Height of the plate centre above the ground (m). */
  h: number;
  /** 1 = draw a post here (the first plate of a stack). */
  post: 0 | 1;
}

const RANK: Record<string, number> = {
  primary: 5, primary_link: 5, secondary: 4, secondary_link: 4, tertiary: 3, tertiary_link: 3, unclassified: 2, residential: 1, living_street: 0,
};
const WIDTH: Record<string, number> = {
  primary: 10, secondary: 8.5, tertiary: 7, unclassified: 6, residential: 6, living_street: 5,
  primary_link: 6.5, secondary_link: 6, tertiary_link: 5.5,
};
const LIMIT_TILE: Record<number, number> = { 20: TILE.s20, 30: TILE.s30, 40: TILE.s40, 50: TILE.s50, 60: TILE.s60, 70: TILE.s70, 80: TILE.s80 };

interface Road {
  way: GraphWay;
  /** Points in game coordinates. */
  p: Vec2[];
  rank: number;
  w: number;
  /** Flow along the way: 1 forward, -1 backward, 0 both directions. */
  flow: 1 | -1 | 0;
  limit?: number;
  roundabout: boolean;
}

interface Arm {
  road: Road;
  /** Point on the arm at s metres from the junction and the direction pointing away from it. */
  x: number;
  z: number;
  dx: number;
  dz: number;
  /** Traffic can drive into the junction along this arm. */
  approach: boolean;
  /** Traffic can drive away from the junction along this arm. */
  leave: boolean;
}

const toGame = (p: [number, number]): Vec2 => [p[0], -p[1]];

/** Point at distance s along a polyline starting at index i going in direction step (+1/-1). */
function along(p: Vec2[], i: number, step: 1 | -1, s: number) {
  let acc = 0, x = p[i][0], z = p[i][1], dx = 0, dz = 0;
  for (let k = i; k + step >= 0 && k + step < p.length; k += step) {
    const ax = p[k][0], az = p[k][1], bx = p[k + step][0], bz = p[k + step][1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    dx = (bx - ax) / len;
    dz = (bz - az) / len;
    if (acc + len >= s) {
      return { x: ax + dx * (s - acc), z: az + dz * (s - acc), dx, dz };
    }
    acc += len;
    x = bx;
    z = bz;
  }
  return { x, z, dx, dz };
}

const yawOf = (nx: number, nz: number) => Math.atan2(nx, nz);

/** Ways, rails and parking outlines all in map coordinates (x east, y north); signs come out in game coordinates. */
export function generateSigns(ways: GraphWay[], rails: Vec2[][], parking: Vec2[][]): Sign[] {
  const out: Sign[] = [];
  rails = rails.map((r) => r.map(toGame));
  parking = parking.map((r) => r.map(toGame));
  const add = (x: number, z: number, nx: number, nz: number, tiles: number[]) => {
    // Stack of plates on one post: the first at 2.2 m + half its size, the rest below... above it.
    let top = 2.2;
    tiles.forEach((tile, k) => {
      const size = SIZE[tile];
      out.push({ x, z, yaw: yawOf(nx, nz), tile, h: top + size / 2, post: k === 0 ? 1 : 0 });
      top += size + 0.06;
    });
  };
  /** Sign for traffic heading (hx, hz) at point (x, z) on a road of width w: right-hand kerb, face towards the driver. */
  const roadside = (x: number, z: number, hx: number, hz: number, w: number, tiles: number[]) => {
    const rx = -hz, rz = hx; // right of the heading in the x-east, z-south frame
    add(x + rx * (w / 2 + 0.85), z + rz * (w / 2 + 0.85), -hx, -hz, tiles);
  };

  // --- Road network -------------------------------------------------------------------------
  const roads: Road[] = [];
  for (const way of ways) {
    const t = way.tags;
    const rank = RANK[t.highway];
    if (rank === undefined) continue;
    if (t.access === 'no' || t.access === 'private' || t.motor_vehicle === 'no' || t.area === 'yes') continue;
    const p = way.pts.map(toGame);
    if (p.length < 2) continue;
    const roundabout = t.junction === 'roundabout';
    const oneway = roundabout || t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1' || (t.highway.endsWith('_link') && t.oneway !== 'no');
    const limit = parseInt(t.maxspeed ?? '', 10);
    roads.push({
      way, p, rank, w: WIDTH[t.highway] ?? 6, roundabout,
      flow: oneway ? (t.oneway === '-1' ? -1 : 1) : 0,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  }

  // Arms at each node.
  const at = new Map<number, { road: Road; i: number }[]>();
  for (const r of roads) r.way.nodes.forEach((n, i) => {
    let l = at.get(n);
    if (!l) at.set(n, (l = []));
    l.push({ road: r, i });
  });
  const armsOf = (n: number): Arm[] => {
    const arms: Arm[] = [];
    for (const { road, i } of at.get(n) ?? []) {
      for (const step of [1, -1] as const) {
        if (i + step < 0 || i + step >= road.p.length) continue;
        const a = along(road.p, i, step, 5);
        // Flow +1 runs towards higher indices: stepping forward leaves the node, stepping back arrives.
        const leave = road.flow === 0 || road.flow === step;
        const approach = road.flow === 0 || road.flow === -step;
        arms.push({ road, ...a, approach, leave });
      }
    }
    return arms;
  };

  const limitOf = (r: Road): number | undefined => {
    if (r.limit) return r.limit;
    return r.rank <= 2 ? 50 : undefined; // built-up residential streets default to 50
  };
  const placedLimit = new Set<string>();

  for (const node of at.keys()) {
    const arms = armsOf(node);
    if (arms.length < 3) continue;
    const entering = arms.filter((a) => a.approach);
    const roundaboutHere = arms.some((a) => a.road.roundabout);

    // Priority.
    if (roundaboutHere) {
      for (const a of entering) {
        if (a.road.roundabout) continue;
        roadside(a.x, a.z, -a.dx, -a.dz, a.road.w, [TILE.p4, TILE.c1]);
      }
    } else {
      const ranks = arms.map((a) => a.road.rank);
      const max = Math.max(...ranks), min = Math.min(...ranks);
      const mainArms = arms.filter((a) => a.road.rank === max);
      if (max !== min && mainArms.length >= 2) {
        const mainSpeed = Math.max(...mainArms.map((a) => a.road.limit ?? 50));
        for (const a of entering) {
          const heading: Vec2 = [-a.dx, -a.dz];
          if (a.road.rank < max) {
            const stop = max - a.road.rank >= 2 && mainSpeed >= 60;
            roadside(a.x, a.z, heading[0], heading[1], a.road.w, [stop ? TILE.p6 : TILE.p4]);
          } else roadside(a.x, a.z, heading[0], heading[1], a.road.w, [TILE.p2]);
        }
      }
    }
  }

  // Speed limits: on each arm entering a road whose limit differs from where drivers come from.
  for (const node of at.keys()) {
    const arms = armsOf(node);
    if (arms.length < 2) continue;
    for (const a of arms) {
      if (!a.leave || a.road.roundabout) continue;
      const v = limitOf(a.road);
      if (v === undefined || !(v in LIMIT_TILE) || v === 90) continue;
      const others = arms.filter((o) => o !== a && o.approach && o.road !== a.road);
      if (!others.length) continue;
      const ov = others.map((o) => limitOf(o.road) ?? 50);
      if (!ov.some((x) => x !== v)) continue; // nothing changes here
      // The "50" only ends a restricted stretch (30, 40, 60, 70, 80); plain 50 -> 50 needs no sign.
      if (v === 50 && !ov.some((x) => x !== 50 && x !== 90)) continue;
      const key = `${Math.round(a.x / 15)},${Math.round(a.z / 15)},${v}`;
      if (placedLimit.has(key)) continue;
      placedLimit.add(key);
      // Entering drivers travel away from the junction (direction a.d), so the face looks back at them.
      roadside(a.x, a.z, a.dx, a.dz, a.road.w, [LIMIT_TILE[v]]);
    }
  }

  // One-way streets: IP4a at the entrance, "no entry" at the exit end (facing wrong-way drivers).
  for (const r of roads) {
    if (r.flow === 0 || r.roundabout || r.rank < 1 || r.way.tags.highway.endsWith('_link')) continue;
    const n = r.p.length;
    const startN = r.way.nodes[0], endN = r.way.nodes[n - 1];
    const entry = r.flow === 1 ? 0 : n - 1, exit = r.flow === 1 ? n - 1 : 0;
    const entryNode = r.flow === 1 ? startN : endN, exitNode = r.flow === 1 ? endN : startN;
    const stepIn = r.flow === 1 ? 1 : -1;
    // A junction with another street, not just the next piece of the same one-way street.
    const name = r.way.tags.name;
    const hasOthers = (node: number) => (at.get(node) ?? []).some((e) => e.road !== r && !(name && e.road.way.tags.name === name && e.road.flow !== 0));
    if (hasOthers(entryNode)) {
      const a = along(r.p, entry, stepIn as 1 | -1, 5);
      roadside(a.x, a.z, a.dx, a.dz, r.w, [TILE.ip4]);
    }
    if (hasOthers(exitNode)) {
      const a = along(r.p, exit, (-stepIn) as 1 | -1, 4);
      // Wrong-way drivers enter here heading along (a.dx, a.dz), away from the junction.
      roadside(a.x, a.z, a.dx, a.dz, r.w, [TILE.b2]);
    }
  }

  // Pedestrian crossings: marked crossings get the zebra the ground painter draws and the IP6
  // signs (same 8 m de-duplication).
  // Only footways OSM maps as crossings (footway=crossing) that are marked, not "unmarked" ones.
  const walks = ways.filter((w) => w.tags.footway === 'crossing' && w.tags.crossing !== 'unmarked').map((w) => ({ p: w.pts.map(toGame) }));
  const CROSSABLE = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'primary_link', 'secondary_link', 'tertiary_link']);
  const crossings: Vec2[] = [];
  const hit = (a: Vec2, b: Vec2, c: Vec2, d: Vec2): number | null => {
    const r1x = b[0] - a[0], r1z = b[1] - a[1], r2x = d[0] - c[0], r2z = d[1] - c[1];
    const den = r1x * r2z - r1z * r2x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((c[0] - a[0]) * r2z - (c[1] - a[1]) * r2x) / den;
    const u = ((c[0] - a[0]) * r1z - (c[1] - a[1]) * r1x) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
  };
  for (const r of roads) {
    if (!CROSSABLE.has(r.way.tags.highway) || r.w < 5 || r.way.tags.bridge || r.way.tags.tunnel) continue;
    for (const wk of walks) {
      for (let i = 0; i + 1 < r.p.length; i++) {
        for (let j = 0; j + 1 < wk.p.length; j++) {
          const t = hit(r.p[i], r.p[i + 1], wk.p[j], wk.p[j + 1]);
          if (t === null) continue;
          const dx = r.p[i + 1][0] - r.p[i][0], dz = r.p[i + 1][1] - r.p[i][1], len = Math.hypot(dx, dz) || 1;
          const x = r.p[i][0] + dx * t, z = r.p[i][1] + dz * t;
          if (crossings.some(([ox, oz]) => Math.hypot(ox - x, oz - z) < 8)) continue;
          crossings.push([x, z]);
          const hx = dx / len, hz = dz / len;
          // One sign for each direction of traffic, on its right-hand kerb.
          roadside(x, z, hx, hz, r.w, [TILE.ip6]);
          roadside(x, z, -hx, -hz, r.w, [TILE.ip6]);
        }
      }
    }
  }

  // Level crossings: the St Andrew's cross 6 m before the rails on both approaches.
  for (const r of roads) {
    if (r.way.tags.bridge || r.way.tags.tunnel || r.rank < 1) continue;
    for (const rail of rails) {
      for (let i = 0; i + 1 < r.p.length; i++) {
        for (let j = 0; j + 1 < rail.length; j++) {
          const t = hit(r.p[i], r.p[i + 1], rail[j], rail[j + 1]);
          if (t === null) continue;
          const dx = r.p[i + 1][0] - r.p[i][0], dz = r.p[i + 1][1] - r.p[i][1], len = Math.hypot(dx, dz) || 1;
          const hx = dx / len, hz = dz / len;
          const x = r.p[i][0] + dx * t, z = r.p[i][1] + dz * t;
          roadside(x - hx * 6, z - hz * 6, hx, hz, r.w, [TILE.cross]);
          roadside(x + hx * 6, z + hz * 6, -hx, -hz, r.w, [TILE.cross]);
        }
      }
    }
  }

  // Car parks (at least 500 m2): IP11a at the point of the outline nearest to a street.
  for (const ring of parking) {
    let area = 0, cx = 0, cz = 0;
    const g = ring;
    for (let i = 0, j = g.length - 1; i < g.length; j = i, i++) {
      area += g[j][0] * g[i][1] - g[i][0] * g[j][1];
      cx += g[i][0];
      cz += g[i][1];
    }
    if (Math.abs(area / 2) < 500) continue;
    cx /= g.length;
    cz /= g.length;
    let best = Infinity, vx = 0, vz = 0, rx = 0, rz = 0;
    for (const v of g) for (const r of roads) {
      if (r.rank < 1) continue;
      for (let i = 0; i + 1 < r.p.length; i++) {
        const ax = r.p[i][0], az = r.p[i][1], dx = r.p[i + 1][0] - ax, dz = r.p[i + 1][1] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((v[0] - ax) * dx + (v[1] - az) * dz) / l2));
        const d = Math.hypot(ax + dx * t - v[0], az + dz * t - v[1]);
        if (d < best) { best = d; vx = v[0]; vz = v[1]; rx = ax + dx * t; rz = az + dz * t; }
      }
    }
    if (best > 25) continue;
    const nl = Math.hypot(rx - vx, rz - vz) || 1;
    const nx = (rx - vx) / nl, nz = (rz - vz) / nl;
    // Step 1 m into the car park (away from the street) and face the street.
    add(vx - nx * 1, vz - nz * 1, nx, nz, [TILE.ip11]);
    void cx; void cz;
  }

  return out;
}
