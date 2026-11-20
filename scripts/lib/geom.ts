// Small 2D geometry helpers used by the chunk builder.
export type Vec2 = [number, number];
export type Ring = Vec2[];

/** Signed area (positive = counter-clockwise in a y-up frame). */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a / 2;
}

export function centroid(ring: Ring): Vec2 {
  let x = 0, y = 0, a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    x += (ring[j][0] + ring[i][0]) * f;
    y += (ring[j][1] + ring[i][1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    // Degenerate: fall back to vertex average.
    const n = ring.length;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [x / (3 * a), y / (3 * a)];
}

/** Drops the duplicated closing vertex and consecutive duplicates. */
export function cleanRing(ring: Ring, eps = 0.05): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > eps || Math.abs(q[1] - p[1]) > eps) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps) out.pop();
    else break;
  }
  return out;
}

/** Makes the ring counter-clockwise (ccw = true) or clockwise. */
export function orient(ring: Ring, ccw: boolean): Ring {
  return signedArea(ring) > 0 === ccw ? ring : ring.slice().reverse();
}

export function pointInRing(p: Vec2, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** rings[0] is the outer ring, the rest are holes. */
export function pointInPolygon(p: Vec2, rings: Ring[]): boolean {
  if (!pointInRing(p, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(p, rings[i])) return false;
  return true;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function ringBounds(ring: Ring): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Sutherland–Hodgman clip of a ring against an axis-aligned rectangle. */
export function clipRingToRect(ring: Ring, r: Rect): Ring {
  type Edge = { inside: (p: Vec2) => boolean; cut: (a: Vec2, b: Vec2) => Vec2 };
  const lerpX = (a: Vec2, b: Vec2, x: number): Vec2 => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const lerpY = (a: Vec2, b: Vec2, y: number): Vec2 => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];
  const edges: Edge[] = [
    { inside: (p) => p[0] >= r.minX, cut: (a, b) => lerpX(a, b, r.minX) },
    { inside: (p) => p[0] <= r.maxX, cut: (a, b) => lerpX(a, b, r.maxX) },
    { inside: (p) => p[1] >= r.minY, cut: (a, b) => lerpY(a, b, r.minY) },
    { inside: (p) => p[1] <= r.maxY, cut: (a, b) => lerpY(a, b, r.maxY) },
  ];
  let out = ring;
  for (const e of edges) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const ci = e.inside(cur), pi = e.inside(prev);
      if (ci) {
        if (!pi) out.push(e.cut(prev, cur));
        out.push(cur);
      } else if (pi) {
        out.push(e.cut(prev, cur));
      }
    }
  }
  return out;
}

export function distPointSegmentSq(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/** Deterministic hash -> [0, 1). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Joins open way segments into closed rings (for multipolygon relations). */
export function assembleRings(parts: Ring[]): Ring[] {
  const key = (p: Vec2) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const rings: Ring[] = [];
  const open: Ring[] = [];
  for (const p of parts) {
    if (p.length < 2) continue;
    if (key(p[0]) === key(p[p.length - 1])) rings.push(p);
    else open.push(p.slice());
  }
  while (open.length) {
    let cur = open.pop()!;
    let progress = true;
    while (progress && key(cur[0]) !== key(cur[cur.length - 1])) {
      progress = false;
      const end = key(cur[cur.length - 1]);
      for (let i = 0; i < open.length; i++) {
        const o = open[i];
        if (key(o[0]) === end) cur = cur.concat(o.slice(1));
        else if (key(o[o.length - 1]) === end) cur = cur.concat(o.slice().reverse().slice(1));
        else continue;
        open.splice(i, 1);
        progress = true;
        break;
      }
    }
    // Unclosed chains (members outside the download area) are closed implicitly.
    if (cur.length >= 3) rings.push(cur);
  }
  return rings;
}
