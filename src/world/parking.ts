// Parking slot layout shared by the ground painter (white slot lines) and the street props
// (parked cars), so the cars stand inside the painted bays. Pure functions: also used in the worker.

export function pointInRing(x: number, z: number, r: number[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export const inPolygon = (x: number, z: number, rings: number[][]) =>
  pointInRing(x, z, rings[0]) && !rings.slice(1).some((h) => pointInRing(x, z, h));

export interface Slot {
  x: number;
  z: number;
  /** Heading of the parked car (rad, 0 = facing +z). */
  yaw: number;
}

/** Perpendicular parking slots (2.5 x 5 m) aligned with the area's longest edge. */
export function parkingSlots(rings: number[][], out: Slot[] = []): Slot[] {
  const r = rings[0];
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    const l = Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]);
    if (l > best) { best = l; ux = (r[j] - r[i]) / l; uz = (r[j + 1] - r[i + 1]) / l; }
  }
  const vx = -uz, vz = ux;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    const u = r[i] * ux + r[i + 1] * uz, v = r[i] * vx + r[i + 1] * vz;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  // Rows: two rows of cars back to back, then a 6 m aisle.
  const pattern = [{ d: 5, face: 1 }, { d: 5, face: -1 }, { d: 6, face: 0 }];
  let v = minV, k = 0;
  while (v < maxV && out.length < 400) {
    const p = pattern[k++ % 3];
    if (p.face !== 0) {
      const vc = v + p.d / 2;
      for (let u = minU + 1.25; u < maxU; u += 2.5) {
        const fits = [[-1.1, -2.3], [1.1, -2.3], [-1.1, 2.3], [1.1, 2.3]].every(([du, dv]) => {
          const x = (u + du) * ux + (vc + dv) * vx, z = (u + du) * uz + (vc + dv) * vz;
          return inPolygon(x, z, rings);
        });
        if (!fits) continue;
        const x = u * ux + vc * vx, z = u * uz + vc * vz;
        out.push({ x, z, yaw: Math.atan2(vx * p.face, vz * p.face) });
      }
    }
    v += p.d;
  }
  return out;
}
