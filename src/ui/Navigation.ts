// GPS: shortest route over the road graph (A*) from the player to a waypoint, plus the next
// turn instruction. In a car one-way streets are respected; on foot they are not.
import type { RoadGraph } from '../world/format.ts';

interface Adj { to: number; edge: number; dir: 1 | -1; cost: number }

class Heap {
  private items: { n: number; f: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(n: number, f: number) {
    const a = this.items;
    a.push({ n, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.n;
  }
}

export interface Turn { dir: 'left' | 'right' | 'straight' | 'arrive'; dist: number }

export class Navigation {
  private adjCar: Adj[][];
  private adjFoot: Adj[][];
  private nx: Float32Array;
  private nz: Float32Array;

  constructor(private g: RoadGraph) {
    const n = g.nodes.length / 3;
    this.nx = new Float32Array(n);
    this.nz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.nx[i] = g.nodes[i * 3];
      this.nz[i] = g.nodes[i * 3 + 2];
    }
    this.adjCar = Array.from({ length: n }, () => []);
    this.adjFoot = Array.from({ length: n }, () => []);
    g.edges.forEach((e, i) => {
      if (e.kind === 'track') return;
      // Prefer bigger roads a little (like a real sat-nav).
      const k = e.kind === 'primary' || e.kind === 'secondary' ? 0.85 : e.kind === 'service' ? 1.4 : 1;
      const cost = e.len * k;
      const fwd = !e.oneway || !e.reverse, back = !e.oneway || !!e.reverse;
      if (fwd) this.adjCar[e.a].push({ to: e.b, edge: i, dir: 1, cost });
      if (back) this.adjCar[e.b].push({ to: e.a, edge: i, dir: -1, cost });
      this.adjFoot[e.a].push({ to: e.b, edge: i, dir: 1, cost: e.len });
      this.adjFoot[e.b].push({ to: e.a, edge: i, dir: -1, cost: e.len });
    });
  }

  /** Nearest graph node that has connections. */
  private nearest(x: number, z: number): number {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.nx.length; i++) {
      if (!this.adjFoot[i].length) continue;
      const d = (this.nx[i] - x) ** 2 + (this.nz[i] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Route as a flat [x, z, ...] polyline from (fx, fz) to (tx, tz), or null. */
  route(fx: number, fz: number, tx: number, tz: number, inCar: boolean): number[] | null {
    const s = this.nearest(fx, fz), t = this.nearest(tx, tz);
    if (s < 0 || t < 0) return null;
    const path = this.astar(s, t, inCar ? this.adjCar : this.adjFoot) ?? (inCar ? this.astar(s, t, this.adjFoot) : null);
    if (!path) return null;
    const out = [fx, fz];
    for (const step of path) {
      const p = this.g.edges[step.edge].pts, n = p.length / 3;
      for (let k = 0; k < n; k++) {
        const i = step.dir === 1 ? k : n - 1 - k;
        out.push(p[i * 3], p[i * 3 + 2]);
      }
    }
    out.push(tx, tz);
    return out;
  }

  private astar(s: number, t: number, adj: Adj[][]): Adj[] | null {
    const n = this.nx.length;
    const g = new Float64Array(n).fill(Infinity);
    const prev: (Adj | null)[] = new Array(n).fill(null);
    const from = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const h = (i: number) => Math.hypot(this.nx[i] - this.nx[t], this.nz[i] - this.nz[t]) * 0.85;
    const open = new Heap();
    g[s] = 0;
    open.push(s, h(s));
    while (open.size) {
      const u = open.pop();
      if (done[u]) continue;
      if (u === t) break;
      done[u] = 1;
      for (const a of adj[u]) {
        const ng = g[u] + a.cost;
        if (ng < g[a.to]) {
          g[a.to] = ng;
          prev[a.to] = a;
          from[a.to] = u;
          open.push(a.to, ng + h(a.to));
        }
      }
    }
    if (s !== t && from[t] < 0) return null;
    const path: Adj[] = [];
    for (let v = t; v !== s; v = from[v]) path.push(prev[v]!);
    return path.reverse();
  }
}

/** Length of a flat [x, z, ...] polyline. */
export function routeLength(r: number[]): number {
  let d = 0;
  for (let i = 2; i < r.length; i += 2) d += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]);
  return d;
}

/** The next turn along the route (first bend over ~40° at least 8 m ahead). */
export function nextTurn(r: number[]): Turn {
  let d = 0;
  for (let i = 2; i + 2 < r.length; i += 2) {
    const ax = r[i] - r[i - 2], az = r[i + 1] - r[i - 1];
    const bx = r[i + 2] - r[i], bz = r[i + 3] - r[i + 1];
    d += Math.hypot(ax, az);
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 0.5 || lb < 0.5) continue;
    const cross = (ax * bz - az * bx) / (la * lb), dot = (ax * bx + az * bz) / (la * lb);
    const ang = Math.atan2(cross, dot);
    if (Math.abs(ang) > 0.7 && d > 15) return { dir: ang > 0 ? 'right' : 'left', dist: d };
  }
  return { dir: 'arrive', dist: routeLength(r) };
}
