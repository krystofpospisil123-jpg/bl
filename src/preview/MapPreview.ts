// Phase 1 data inspector: draws all chunks as a 2D map (north up) so the generated
// data can be checked before the 3D world exists.
import type { WorldData, LoadedChunk } from '../world/WorldData.ts';
import type { Building } from '../world/format.ts';

const AREA_COLORS: Record<string, string> = {
  forest: '#4f7f45', scrub: '#7a9a5a', park: '#8cc47a', grass: '#a6d08c', sport: '#9fd3a8', farmland: '#e9e2b8',
  orchard: '#c7dd9b', allotments: '#d4e3b5', cemetery: '#a9c4a0', residential: '#e7dfd6', industrial: '#ddd0de',
  commercial: '#f0d6d0', railway: '#dcd6cc', construction: '#d7d1b6', parking: '#d9d9d9', plaza: '#ece8e0',
};
const ROAD_STYLE: Record<string, string> = {
  primary: '#f5b25a', secondary: '#f7d36b', tertiary: '#fdf2a6', residential: '#ffffff', unclassified: '#ffffff',
  living_street: '#f2f2f2', service: '#f7f7f7', pedestrian: '#eeeeee', track: '#c49a6c',
};

export interface LayerFlags {
  hillshade: boolean; areas: boolean; water: boolean; roads: boolean; rails: boolean;
  buildings: boolean; trees: boolean; grid: boolean; pois: boolean;
}

export class MapPreview {
  readonly layers: LayerFlags = {
    hillshade: true, areas: true, water: true, roads: true, rails: true, buildings: true, trees: true, grid: true, pois: true,
  };
  private ctx: CanvasRenderingContext2D;
  private chunks: LoadedChunk[] = [];
  private shade?: HTMLCanvasElement;
  // View transform: screen = (world - center) * scale + canvasCenter
  private center = { x: 0, z: 0 };
  private scale = 0.3;
  private selected?: Building;
  onHover?: (info: string) => void;
  onSelect?: (b: Building | undefined) => void;

  constructor(private canvas: HTMLCanvasElement, private world: WorldData) {
    this.ctx = canvas.getContext('2d')!;
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  async loadAll(onProgress: (done: number, total: number) => void) {
    const m = this.world.manifest;
    const total = m.chunks.length;
    let done = 0;
    this.chunks = await Promise.all(
      m.chunks.map((c) => this.world.loadChunk(c.cx, c.cz).then((lc) => (onProgress(++done, total), lc))),
    );
    this.buildHillshade();
    this.fit();
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.draw();
  }

  private fit() {
    const h = this.world.manifest.halfExtent;
    this.center = { x: 0, z: 0 };
    this.scale = Math.min(this.canvas.width, this.canvas.height) / (2 * h * 1.05);
    this.draw();
  }

  /** Builds a 1 px = heightStep m hillshade + hypsometric tint image. */
  private buildHillshade() {
    const m = this.world.manifest;
    const per = m.chunkSize / m.heightStep;
    const size = per * m.chunksPerSide + 1;
    const elev = new Float32Array(size * size);
    for (const c of this.chunks) {
      for (let j = 0; j < c.n; j++)
        for (let i = 0; i < c.n; i++) elev[(c.info.cz * per + j) * size + c.info.cx * per + i] = c.heights[j * c.n + i];
    }
    const cvs = document.createElement('canvas');
    cvs.width = cvs.height = size;
    const g = cvs.getContext('2d')!;
    const img = g.createImageData(size, size);
    const { min, max } = m.elevation;
    const s = m.heightStep;
    // Light from the north-west, 45° altitude.
    const lx = -0.5, ly = -0.5, lz = Math.SQRT1_2;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const e = elev[j * size + i];
        const ex = elev[j * size + Math.min(size - 1, i + 1)] - elev[j * size + Math.max(0, i - 1)];
        const ez = elev[Math.min(size - 1, j + 1) * size + i] - elev[Math.max(0, j - 1) * size + i];
        const nx = -ex / (2 * s), ny = -ez / (2 * s), nz = 1;
        const len = Math.hypot(nx, ny, nz);
        const shade = Math.max(0, (nx * lx + ny * ly + nz * lz) / len);
        const t = (e - min) / (max - min);
        const k = (j * size + i) * 4;
        img.data[k] = (150 + 90 * t) * shade + 20;
        img.data[k + 1] = (175 + 50 * t) * shade + 20;
        img.data[k + 2] = (140 + 70 * t) * shade + 20;
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.shade = cvs;
  }

  draw() {
    const { ctx, canvas } = this;
    const m = this.world.manifest;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#20242a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!this.chunks.length) return;
    const sc = this.scale;
    ctx.setTransform(sc, 0, 0, sc, canvas.width / 2 - this.center.x * sc, canvas.height / 2 - this.center.z * sc);
    const px = 1 / sc; // one screen pixel in metres
    const H = m.halfExtent;

    if (this.layers.hillshade && this.shade) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.shade, -H - m.heightStep / 2, -H - m.heightStep / 2, 2 * H + m.heightStep, 2 * H + m.heightStep);
    } else {
      ctx.fillStyle = '#d8d4c8';
      ctx.fillRect(-H, -H, 2 * H, 2 * H);
    }

    const alpha = this.layers.hillshade ? 0.55 : 1;
    if (this.layers.areas) {
      ctx.globalAlpha = alpha;
      for (const c of this.chunks) for (const a of c.data.areas) {
        ctx.fillStyle = AREA_COLORS[a.kind] ?? '#cccccc';
        ctx.fill(ringsPath(a.rings), 'evenodd');
      }
      ctx.globalAlpha = 1;
    }
    if (this.layers.water) {
      ctx.fillStyle = '#6fa8dc';
      ctx.strokeStyle = '#6fa8dc';
      ctx.lineCap = ctx.lineJoin = 'round';
      for (const c of this.chunks) {
        for (const w of c.data.water) ctx.fill(ringsPath(w.rings), 'evenodd');
        for (const w of c.data.waterways) {
          ctx.globalAlpha = w.tunnel ? 0.35 : 1;
          ctx.lineWidth = Math.max(w.w, 1.5 * px);
          ctx.stroke(linePath(w.pts));
        }
      }
      ctx.globalAlpha = 1;
    }
    if (this.layers.rails) {
      ctx.strokeStyle = '#555';
      for (const c of this.chunks) for (const r of c.data.rails) {
        ctx.setLineDash(r.kind === 'rail' ? [] : [6 * px, 4 * px]);
        ctx.lineWidth = Math.max(2.5, 1.5 * px);
        ctx.stroke(linePath(r.pts));
      }
      ctx.setLineDash([]);
    }
    if (this.layers.roads) {
      ctx.lineCap = ctx.lineJoin = 'round';
      // Two passes: casing, then fill, sorted so major roads are drawn last.
      const roads = this.chunks.flatMap((c) => c.data.roads).sort((a, b) => a.w - b.w);
      for (const pass of [0, 1]) for (const r of roads) {
        const path = linePath(r.pts);
        if (r.w <= 2.5) {
          if (pass === 1) {
            ctx.strokeStyle = r.kind === 'steps' ? '#c0504d' : '#b5652f';
            ctx.lineWidth = Math.max(r.w, 1 * px);
            ctx.setLineDash([3 * px, 2 * px]);
            ctx.stroke(path);
            ctx.setLineDash([]);
          }
          continue;
        }
        ctx.globalAlpha = r.tunnel ? 0.35 : 1;
        ctx.strokeStyle = pass === 0 ? (r.bridge ? '#222' : '#8a8a8a') : (ROAD_STYLE[r.kind] ?? '#fafafa');
        ctx.lineWidth = Math.max(r.w, 2 * px) + (pass === 0 ? Math.max(1, 1.5 * px) : 0);
        ctx.stroke(path);
      }
      ctx.globalAlpha = 1;
    }
    if (this.layers.buildings) {
      ctx.lineWidth = px;
      for (const c of this.chunks) for (const b of c.data.buildings) {
        // Tagged heights in a darker tone, estimated heights lighter; brightness by height.
        const t = Math.min(1, b.h / 25);
        ctx.fillStyle = b.tagged ? `hsl(18, 45%, ${62 - 30 * t}%)` : `hsl(30, 15%, ${72 - 30 * t}%)`;
        const p = ringsPath(b.rings);
        ctx.fill(p, 'evenodd');
        ctx.strokeStyle = b === this.selected ? '#ff00aa' : 'rgba(60,40,30,0.6)';
        if (b === this.selected) ctx.lineWidth = 3 * px;
        ctx.stroke(p);
        ctx.lineWidth = px;
      }
    }
    if (this.layers.trees) {
      for (const c of this.chunks) {
        const t = c.data.trees;
        for (let i = 0; i < t.length; i += 4) {
          ctx.fillStyle = t[i + 3] ? 'rgba(20,70,40,0.75)' : 'rgba(40,110,40,0.65)';
          const r = Math.max(t[i + 2] * 0.18, 0.8 * px);
          ctx.fillRect(t[i] - r, t[i + 1] - r, 2 * r, 2 * r);
        }
      }
    }
    if (this.layers.grid) {
      ctx.strokeStyle = 'rgba(255,0,0,0.45)';
      ctx.lineWidth = px;
      ctx.font = `${11 * px}px sans-serif`;
      ctx.fillStyle = 'rgba(200,0,0,0.8)';
      for (let i = 0; i <= m.chunksPerSide; i++) {
        const v = -H + i * m.chunkSize;
        ctx.beginPath();
        ctx.moveTo(v, -H); ctx.lineTo(v, H);
        ctx.moveTo(-H, v); ctx.lineTo(H, v);
        ctx.stroke();
      }
      for (const c of m.chunks) ctx.fillText(`${c.cx},${c.cz}`, -H + c.cx * m.chunkSize + 4 * px, -H + c.cz * m.chunkSize + 13 * px);
    }
    if (this.layers.pois) {
      ctx.font = `bold ${12 * px}px sans-serif`;
      ctx.textAlign = 'center';
      for (const p of m.pois) {
        ctx.fillStyle = p.kind === 'place' ? '#1d2b53' : '#7e2553';
        ctx.beginPath();
        ctx.arc(p.x, p.z, 3 * px, 0, Math.PI * 2);
        ctx.fill();
        if (p.kind === 'place' || sc > 0.8) ctx.fillText(p.name ?? '', p.x, p.z - 6 * px);
      }
      ctx.textAlign = 'start';
    }
    // Origin marker
    ctx.strokeStyle = '#ff00aa';
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.moveTo(-10 * px, 0); ctx.lineTo(10 * px, 0); ctx.moveTo(0, -10 * px); ctx.lineTo(0, 10 * px);
    ctx.stroke();
  }

  private screenToWorld(sx: number, sy: number) {
    const dpr = window.devicePixelRatio || 1;
    return {
      x: (sx * dpr - this.canvas.width / 2) / this.scale + this.center.x,
      z: (sy * dpr - this.canvas.height / 2) / this.scale + this.center.z,
    };
  }

  /** Bilinear elevation from loaded chunk data. */
  elevationAt(x: number, z: number): number | undefined {
    const m = this.world.manifest;
    const [cx, cz] = this.world.chunkCoordsAt(x, z);
    const c = this.chunks.find((k) => k.info.cx === cx && k.info.cz === cz);
    if (!c) return undefined;
    const fx = (x + m.halfExtent - cx * m.chunkSize) / m.heightStep;
    const fz = (z + m.halfExtent - cz * m.chunkSize) / m.heightStep;
    const i = Math.min(c.n - 2, Math.floor(fx)), j = Math.min(c.n - 2, Math.floor(fz));
    const tx = fx - i, tz = fz - j, h = c.heights, n = c.n;
    return (h[j * n + i] * (1 - tx) + h[j * n + i + 1] * tx) * (1 - tz) + (h[(j + 1) * n + i] * (1 - tx) + h[(j + 1) * n + i + 1] * tx) * tz;
  }

  private bindInput() {
    let drag: { x: number; y: number; moved: boolean } | null = null;
    const dpr = () => window.devicePixelRatio || 1;
    this.canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const w = this.screenToWorld(e.clientX - r.left, e.clientY - r.top);
      const el = this.elevationAt(w.x, w.z);
      const [cx, cz] = this.world.chunkCoordsAt(w.x, w.z);
      this.onHover?.(`x ${w.x.toFixed(0)} m, z ${w.z.toFixed(0)} m · chunk ${cx},${cz}` + (el !== undefined ? ` · ${el.toFixed(1)} m n. m.` : ''));
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      this.center.x -= (dx * dpr()) / this.scale;
      this.center.z -= (dy * dpr()) / this.scale;
      drag.x = e.clientX;
      drag.y = e.clientY;
      this.draw();
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) {
        const r = this.canvas.getBoundingClientRect();
        this.pick(this.screenToWorld(e.clientX - r.left, e.clientY - r.top));
      }
      drag = null;
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      const before = this.screenToWorld(e.clientX - r.left, e.clientY - r.top);
      this.scale = Math.min(20, Math.max(0.05, this.scale * Math.exp(-e.deltaY * 0.0015)));
      const after = this.screenToWorld(e.clientX - r.left, e.clientY - r.top);
      this.center.x += before.x - after.x;
      this.center.z += before.z - after.z;
      this.draw();
    }, { passive: false });
  }

  private pick(p: { x: number; z: number }) {
    const [cx, cz] = this.world.chunkCoordsAt(p.x, p.z);
    // Buildings are assigned by centroid, so also search neighbouring chunks.
    this.selected = undefined;
    for (const c of this.chunks) {
      if (Math.abs(c.info.cx - cx) > 1 || Math.abs(c.info.cz - cz) > 1) continue;
      for (const b of c.data.buildings) if (pointInFlatRing(p.x, p.z, b.rings[0])) this.selected = b;
    }
    this.onSelect?.(this.selected);
    this.draw();
  }
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

function pointInFlatRing(x: number, z: number, r: number[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
