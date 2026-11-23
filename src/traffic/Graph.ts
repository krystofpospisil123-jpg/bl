// Runtime helpers for the drive/walk graphs: adjacency and sampling along edges.
import type { GraphEdge, RoadGraph } from '../world/format.ts';

/** A directed way to travel along an edge: dir = 1 means a -> b, -1 means b -> a. */
export interface Lane {
  edge: number;
  dir: 1 | -1;
}

export class Graph {
  readonly edges: GraphEdge[];
  readonly nodes: number[];
  /** Cumulative distance at each polyline point, per edge. */
  private cum: Float32Array[];
  /** Outgoing lanes per node. */
  readonly out: Lane[][];

  constructor(g: RoadGraph, directed: boolean) {
    this.edges = g.edges;
    this.nodes = g.nodes;
    this.cum = g.edges.map((e) => {
      const n = e.pts.length / 3;
      const c = new Float32Array(n);
      for (let i = 1; i < n; i++) {
        const dx = e.pts[i * 3] - e.pts[i * 3 - 3], dz = e.pts[i * 3 + 2] - e.pts[i * 3 - 1];
        c[i] = c[i - 1] + Math.hypot(dx, dz);
      }
      return c;
    });
    this.out = Array.from({ length: g.nodes.length / 3 }, () => []);
    g.edges.forEach((e, i) => {
      const fwdOk = !directed || !e.oneway || !e.reverse;
      const backOk = !directed || !e.oneway || !!e.reverse;
      if (fwdOk) this.out[e.a].push({ edge: i, dir: 1 });
      if (backOk && e.a !== e.b) this.out[e.b].push({ edge: i, dir: -1 });
    });
  }

  length(edge: number): number {
    const c = this.cum[edge];
    return c[c.length - 1];
  }

  /** Node a lane ends at. */
  endNode(l: Lane): number {
    const e = this.edges[l.edge];
    return l.dir === 1 ? e.b : e.a;
  }

  startNode(l: Lane): number {
    const e = this.edges[l.edge];
    return l.dir === 1 ? e.a : e.b;
  }

  nodePos(n: number): [number, number, number] {
    return [this.nodes[n * 3], this.nodes[n * 3 + 1], this.nodes[n * 3 + 2]];
  }

  /**
   * Samples a lane at distance s from its start: writes position (x, y, z) and the
   * unit travel direction (dx, dz) into `out`.
   */
  sample(l: Lane, s: number, out: { x: number; y: number; z: number; dx: number; dz: number }) {
    const e = this.edges[l.edge];
    const c = this.cum[l.edge];
    const total = c[c.length - 1];
    const d = Math.min(total, Math.max(0, l.dir === 1 ? s : total - s));
    // Binary search for the segment containing d.
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (c[mid] <= d) lo = mid;
      else hi = mid;
    }
    const seg = c[hi] - c[lo] || 1;
    const t = (d - c[lo]) / seg;
    const p = e.pts;
    const ax = p[lo * 3], ay = p[lo * 3 + 1], az = p[lo * 3 + 2];
    const bx = p[hi * 3], by = p[hi * 3 + 1], bz = p[hi * 3 + 2];
    out.x = ax + (bx - ax) * t;
    out.y = ay + (by - ay) * t;
    out.z = az + (bz - az) * t;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    out.dx = ((bx - ax) / len) * l.dir;
    out.dz = ((bz - az) / len) * l.dir;
  }

  /** Lanes leaving the end of `l`, excluding the U-turn unless it is the only option. */
  next(l: Lane): Lane[] {
    const n = this.endNode(l);
    const opts = this.out[n].filter((o) => !(o.edge === l.edge && o.dir !== l.dir));
    if (opts.length) return opts;
    if (this.out[n].length) return this.out[n];
    // Dead end (e.g. the far end of a one-way street): turn around on the same edge.
    return [{ edge: l.edge, dir: l.dir === 1 ? -1 : 1 }];
  }
}
