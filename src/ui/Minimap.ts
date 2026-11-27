// GTA-style radar and pause map. The map is painted into two large canvases covering the
// whole town: a ground layer (land, parks, forest, water, buildings – added chunk by chunk as
// they load) and a road layer (drive and walk networks, drawn once). The radar is a rounded
// rectangle that turns with the camera, tilted a little in 3D, with blips (shops, garages,
// club, bowling, your car, police, other players), the GPS route in purple and a health bar.
// The big map (M or a tap on the radar) is north-up, can be dragged and zoomed, and a click
// sets a waypoint (click it again to remove it).
import * as THREE from 'three';
import type { ChunkData, RoadGraphs } from '../world/format.ts';

/** Longest side of the painted map canvases (px). */
const BASE = 4096;
/** Metres from the player to the top edge of the radar. */
const RANGE = 190;

export interface MapMark {
  pos: THREE.Vector3;
  label: string;
  color: string;
  /** Place name (shown in the phone's map app and the big map). */
  name?: string;
}

const C = {
  land: '#2f3a3c', building: '#4a5557', park: '#33503a', forest: '#2c4630', water: '#3f86b8', farm: '#384437',
  road: '#a3a9ad', roadMain: '#c9ccc6', walk: '#4d5859', route: '#b45cff', routeEdge: '#3a1468',
};

export class Minimap {
  readonly canvas = document.createElement('canvas');
  private ground: HTMLCanvasElement;
  private roads: HTMLCanvasElement;
  private scale: number;
  private frame = 0;
  private painted = new Set<string>();
  /** Big map open. */
  expanded = false;
  private big = document.createElement('div');
  private bigCanvas = document.createElement('canvas');
  private bigInfo = document.createElement('div');
  private bigCenter = new THREE.Vector2();
  private bigRange = 650;
  /** Last player position / marks, for the big map. */
  private last: { player: THREE.Vector3; yaw: number; car: THREE.Vector3 | null; police: THREE.Vector3[]; marks: MapMark[]; players: THREE.Vector3[] } | null = null;
  waypoint: { x: number; z: number } | null = null;
  /** GPS route as flat [x, z, ...] (from the player to the waypoint). */
  route: number[] | null = null;
  /** Text over the radar (next turn, distance). */
  gps = '';
  health = 100;
  onWaypoint?: (p: { x: number; z: number } | null) => void;

  private ox: number;
  private oz: number;
  private cw: number;
  private ch: number;

  constructor(graphs: RoadGraphs, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, private size: number) {
    this.canvas.id = 'minimap';
    const bw = bounds.maxX - bounds.minX, bh = bounds.maxZ - bounds.minZ;
    this.scale = Math.min(1, BASE / Math.max(bw, bh));
    this.ox = bounds.minX;
    this.oz = bounds.minZ;
    this.cw = Math.round(bw * this.scale);
    this.ch = Math.round(bh * this.scale);
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = this.cw;
      c.height = this.ch;
      return c;
    };
    this.ground = mk();
    this.roads = mk();
    const g0 = this.ground.getContext('2d')!;
    g0.fillStyle = C.land;
    g0.fillRect(0, 0, this.cw, this.ch);
    const g = this.roads.getContext('2d')!;
    g.lineCap = g.lineJoin = 'round';
    const draw = (graph: RoadGraphs['drive'], color: string, width: (kind: string) => number, filter: (kind: string) => boolean = () => true) => {
      g.strokeStyle = color;
      for (const e of graph.edges) {
        if (!filter(e.kind)) continue;
        g.lineWidth = Math.max(1.2, width(e.kind) * this.scale);
        g.beginPath();
        for (let i = 0; i < e.pts.length; i += 3) {
          const x = (e.pts[i] - this.ox) * this.scale, y = (e.pts[i + 2] - this.oz) * this.scale;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    };
    const w = (k: string) => (k === 'primary' || k === 'secondary' ? 12 : k === 'tertiary' ? 10 : k === 'service' ? 5 : 7.5);
    draw(graphs.walk, C.walk, () => 2.4);
    // Dark outline under the roads, then the roads, main roads brighter on top.
    draw(graphs.drive, '#1e2628', (k) => w(k) + 4);
    draw(graphs.drive, C.road, w);
    draw(graphs.drive, C.roadMain, w, (k) => k === 'primary' || k === 'secondary');
    this.resize();
    // Tap / click on the radar opens the big map.
    this.canvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.toggle(true);
    });
    this.buildBig();
    document.body.append(this.canvas, this.big);
  }

  /** Paints a loaded chunk's land use, water and buildings into the ground layer. */
  paintChunk(data: ChunkData) {
    const key = `${data.cx},${data.cz}`;
    if (this.painted.has(key)) return;
    this.painted.add(key);
    const g = this.ground.getContext('2d')!;
    const s = this.scale, ox = this.ox, oz = this.oz;
    const poly = (rings: number[][], color: string) => {
      g.fillStyle = color;
      g.beginPath();
      for (const r of rings) {
        for (let i = 0; i < r.length; i += 2) {
          const x = (r[i] - ox) * s, y = (r[i + 1] - oz) * s;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.closePath();
      }
      g.fill('evenodd');
    };
    for (const a of data.areas) {
      const col = a.kind === 'forest' || a.kind === 'scrub' ? C.forest : /park|grass|cemetery|sport|allotments|orchard/.test(a.kind) ? C.park : a.kind === 'farmland' ? C.farm : null;
      if (col) poly(a.rings, col);
    }
    for (const wa of data.water) poly(wa.rings, C.water);
    g.strokeStyle = C.water;
    g.lineCap = 'round';
    for (const w of data.waterways) {
      g.lineWidth = Math.max(1.5, w.w * s);
      g.beginPath();
      for (let i = 0; i < w.pts.length; i += 2) {
        const x = (w.pts[i] - ox) * s, y = (w.pts[i + 1] - oz) * s;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    for (const b of data.buildings) poly(b.rings, C.building);
  }

  toggle(open = !this.expanded) {
    this.expanded = open;
    this.big.hidden = !open;
    if (open) {
      document.exitPointerLock?.();
      if (this.last) this.bigCenter.set(this.last.player.x, this.last.player.z);
      this.drawBig();
    }
  }

  private resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(this.size * 1.45), h = this.size;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.frame = 0;
  }

  /** Sets (or clears) the waypoint. */
  setWaypoint(p: { x: number; z: number } | null) {
    this.waypoint = p;
    if (!p) {
      this.route = null;
      this.gps = '';
    }
    this.onWaypoint?.(p);
    if (this.expanded) this.drawBig();
  }

  // ------------------------------------------------------------------ drawing helpers

  /** Draws the map layers into `c` so that world point (cx, cz) lands at canvas (ox, oy), with `k` px per metre. */
  private drawLayers(c: CanvasRenderingContext2D, cx: number, cz: number, k: number) {
    const s = k / this.scale;
    const x = -(cx - this.ox) * this.scale * s, y = -(cz - this.oz) * this.scale * s;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.ground, x, y, this.cw * s, this.ch * s);
    c.drawImage(this.roads, x, y, this.cw * s, this.ch * s);
  }

  private drawRoute(c: CanvasRenderingContext2D, cx: number, cz: number, k: number, width: number) {
    const r = this.route;
    if (!r || r.length < 4) return;
    c.lineCap = c.lineJoin = 'round';
    for (const [col, w] of [[C.routeEdge, width + 3], [C.route, width]] as const) {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.beginPath();
      for (let i = 0; i < r.length; i += 2) {
        const x = (r[i] - cx) * k, y = (r[i + 1] - cz) * k;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
  }

  private blip(c: CanvasRenderingContext2D, x: number, y: number, label: string, color: string, ui: number) {
    c.save();
    c.translate(x, y);
    c.scale(ui, ui);
    c.fillStyle = '#111';
    c.beginPath();
    c.arc(0, 0, 11, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = color;
    c.beginPath();
    c.arc(0, 0, 9, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#111';
    c.font = 'bold 12px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, 0, 1);
    c.restore();
  }

  private waypointBlip(c: CanvasRenderingContext2D, x: number, y: number, ui: number) {
    c.save();
    c.translate(x, y);
    c.scale(ui, ui);
    c.fillStyle = '#1a0a2e';
    c.beginPath();
    c.moveTo(0, 4);
    c.arc(0, -10, 10, Math.PI * 0.8, Math.PI * 0.2);
    c.closePath();
    c.fill();
    c.fillStyle = C.route;
    c.beginPath();
    c.moveTo(0, 1);
    c.arc(0, -10, 8, Math.PI * 0.8, Math.PI * 0.2);
    c.closePath();
    c.fill();
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(0, -10, 3, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  private arrow(c: CanvasRenderingContext2D, x: number, y: number, rot: number, ui: number) {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.scale(ui, ui);
    c.fillStyle = '#f4f4f4';
    c.strokeStyle = '#222';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -12);
    c.lineTo(8, 9);
    c.lineTo(0, 4);
    c.lineTo(-8, 9);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }

  // ------------------------------------------------------------------ radar

  update(
    player: THREE.Vector3, viewYaw: number,
    car: THREE.Vector3 | null, police: THREE.Vector3[], wanted: number, marks: MapMark[] = [], players: THREE.Vector3[] = [],
  ) {
    this.last = { player: player.clone(), yaw: viewYaw, car: car?.clone() ?? null, police, marks, players };
    if (this.expanded && this.frame % 3 === 0) this.drawBig();
    if (this.frame++ % 2) return;
    const c = this.canvas.getContext('2d')!;
    const W = this.canvas.width, H = this.canvas.height;
    const ui = H / 170;
    const barH = Math.round(9 * ui);
    const mapH = H - barH - 3 * ui;
    // Player sits a bit below the middle so you see more ahead (like GTA).
    const px = W / 2, py = mapH * 0.62;
    const k = (mapH * 0.62) / RANGE;
    c.clearRect(0, 0, W, H);
    c.save();
    c.beginPath();
    c.roundRect(0, 0, W, mapH, 6 * ui);
    c.clip();
    c.fillStyle = C.land;
    c.fillRect(0, 0, W, mapH);
    const heading = Math.atan2(Math.cos(viewYaw), Math.sin(viewYaw));
    const rot = -Math.PI / 2 - heading;
    c.save();
    c.translate(px, py);
    c.rotate(rot);
    this.drawLayers(c, player.x, player.z, k);
    this.drawRoute(c, player.x, player.z, k, 4.5 * ui);
    c.restore();
    // Blips are drawn upright; far ones stay at the edge of the radar.
    const toScreen = (x: number, z: number, clamp: boolean, pad = 12 * ui) => {
      const dx = (x - player.x) * k, dz = (z - player.z) * k;
      let sx = px + dx * Math.cos(rot) - dz * Math.sin(rot), sy = py + dx * Math.sin(rot) + dz * Math.cos(rot);
      if (clamp) {
        sx = Math.max(pad, Math.min(W - pad, sx));
        sy = Math.max(pad, Math.min(mapH - pad, sy));
      }
      return [sx, sy];
    };
    for (const m of marks) {
      const [x, y] = toScreen(m.pos.x, m.pos.z, true);
      this.blip(c, x, y, m.label, m.color, ui * 0.85);
    }
    if (car) {
      const [x, y] = toScreen(car.x, car.z, true);
      c.fillStyle = '#5fb7ff';
      c.strokeStyle = '#111';
      c.lineWidth = 2;
      c.beginPath();
      c.roundRect(x - 6 * ui, y - 4 * ui, 12 * ui, 8 * ui, 2 * ui);
      c.fill();
      c.stroke();
    }
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    for (const p of police) {
      const [x, y] = toScreen(p.x, p.z, wanted > 0, 8 * ui);
      c.fillStyle = wanted > 0 ? (blink ? '#ff3b3b' : '#3b6bff') : '#3b6bff';
      c.beginPath();
      c.arc(x, y, 5 * ui, 0, Math.PI * 2);
      c.fill();
    }
    for (const p of players) {
      const [x, y] = toScreen(p.x, p.z, true, 8 * ui);
      c.fillStyle = '#4cd964';
      c.strokeStyle = '#111';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, y, 6 * ui, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    if (this.waypoint) {
      const [x, y] = toScreen(this.waypoint.x, this.waypoint.z, true, 14 * ui);
      this.waypointBlip(c, x, y + 6 * ui, ui);
    }
    // North marker on the edge.
    const [nx0, ny0] = toScreen(player.x, player.z - 1e4, false);
    const ang = Math.atan2(ny0 - py, nx0 - px);
    let nx = px + Math.cos(ang) * 1e4, ny = py + Math.sin(ang) * 1e4;
    const t = Math.min(Math.abs((W / 2 - 11 * ui) / (Math.cos(ang) || 1e-6)), Math.abs((ang < 0 ? py - 11 * ui : mapH - py - 11 * ui) / (Math.sin(ang) || 1e-6)));
    nx = px + Math.cos(ang) * t;
    ny = py + Math.sin(ang) * t;
    c.fillStyle = 'rgba(0,0,0,0.75)';
    c.beginPath();
    c.arc(nx, ny, 9 * ui, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fff';
    c.font = `bold ${Math.round(11 * ui)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('S', nx, ny + 0.5 * ui);
    this.arrow(c, px, py, 0, ui);
    // GPS text at the top.
    if (this.gps) {
      c.font = `bold ${Math.round(12 * ui)}px system-ui, sans-serif`;
      const tw = c.measureText(this.gps).width + 16 * ui;
      c.fillStyle = 'rgba(20, 8, 36, 0.85)';
      c.beginPath();
      c.roundRect(W / 2 - tw / 2, 5 * ui, tw, 20 * ui, 5 * ui);
      c.fill();
      c.fillStyle = '#e9d5ff';
      c.fillText(this.gps, W / 2, 15.5 * ui);
    }
    // Wanted: red flashing frame.
    if (wanted > 0 && blink) {
      c.strokeStyle = 'rgba(255, 60, 60, 0.9)';
      c.lineWidth = 4 * ui;
      c.strokeRect(0, 0, W, mapH);
    }
    c.restore();
    // Health bar under the radar (green, red when low).
    const hp = Math.max(0, Math.min(1, this.health / 100));
    c.fillStyle = 'rgba(0,0,0,0.65)';
    c.fillRect(0, H - barH, W, barH);
    c.fillStyle = hp > 0.3 ? '#4fa95a' : '#d33b32';
    c.fillRect(2 * ui, H - barH + 2 * ui, (W - 4 * ui) * hp, barH - 4 * ui);
  }

  // ------------------------------------------------------------------ big map

  private buildBig() {
    this.big.id = 'bigmap';
    this.big.hidden = true;
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = '✕';
    close.title = 'Zavřít (M)';
    close.addEventListener('click', () => this.toggle(false));
    const zoom = document.createElement('div');
    zoom.className = 'zoom';
    zoom.innerHTML = '<button data-z="0.7">+</button><button data-z="1.4">−</button><button data-c>◎</button>';
    zoom.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.z) this.bigRange = THREE.MathUtils.clamp(this.bigRange * Number(b.dataset.z), 120, 1600);
      if (b.dataset.c !== undefined && this.last) this.bigCenter.set(this.last.player.x, this.last.player.z);
      this.drawBig();
    });
    this.bigInfo.className = 'info';
    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = '<span><i style="background:#f1c232">Z</i>Zbraně</span><span><i style="background:#ff9a2e">G</i>Tuning</span><span><i style="background:#34d17a">D</i>Moje garáž</span><span><i style="background:#ff4fb8">K</i>Klub</span><span><i style="background:#ff8a2e">B</i>Bowling</span><span><i class="wp"></i>Cíl</span>';
    this.big.append(this.bigCanvas, close, zoom, this.bigInfo, legend);
    // Drag to pan, wheel / pinch to zoom, click (without dragging) to set the waypoint.
    let down: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    this.bigCanvas.addEventListener('pointerdown', (e) => {
      this.bigCanvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
      down = { x: e.clientX, y: e.clientY, cx: this.bigCenter.x, cz: this.bigCenter.y, moved: false };
    });
    this.bigCanvas.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.bigRange = THREE.MathUtils.clamp(this.bigRange * (pinch / d), 120, 1600);
        pinch = d;
        if (down) down.moved = true;
        this.drawBig();
        return;
      }
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.hypot(dx, dy) > 6) down.moved = true;
      if (down.moved) {
        const mpp = this.bigRange / (Math.min(this.bigCanvas.clientWidth, this.bigCanvas.clientHeight) / 2);
        this.bigCenter.set(down.cx - dx * mpp, down.cz - dy * mpp);
        this.drawBig();
      }
    });
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      if (!down || pts.size) return;
      if (!down.moved) {
        const r = this.bigCanvas.getBoundingClientRect();
        const mpp = this.bigRange / (Math.min(r.width, r.height) / 2);
        const wx = this.bigCenter.x + (e.clientX - r.left - r.width / 2) * mpp;
        const wz = this.bigCenter.y + (e.clientY - r.top - r.height / 2) * mpp;
        const wp = this.waypoint;
        // Clicking the waypoint again removes it.
        if (wp && Math.hypot(wp.x - wx, wp.z - wz) < 14 * mpp) this.setWaypoint(null);
        else this.setWaypoint({ x: wx, z: wz });
      }
      down = null;
    };
    this.bigCanvas.addEventListener('pointerup', up);
    this.bigCanvas.addEventListener('pointercancel', (e) => {
      pts.delete(e.pointerId);
      down = null;
    });
    this.bigCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.bigRange = THREE.MathUtils.clamp(this.bigRange * (e.deltaY > 0 ? 1.15 : 0.87), 120, 1600);
      this.drawBig();
    }, { passive: false });
    window.addEventListener('resize', () => this.expanded && this.drawBig());
  }

  private drawBig() {
    const cv = this.bigCanvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || window.innerWidth, h = cv.clientHeight || window.innerHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const c = cv.getContext('2d')!;
    const W = cv.width, H = cv.height, ui = dpr;
    const k = Math.min(W, H) / 2 / this.bigRange;
    const cx = this.bigCenter.x, cz = this.bigCenter.y;
    c.fillStyle = '#1c2426';
    c.fillRect(0, 0, W, H);
    c.save();
    c.translate(W / 2, H / 2);
    this.drawLayers(c, cx, cz, k);
    this.drawRoute(c, cx, cz, k, 5 * ui);
    const L = this.last;
    const at = (x: number, z: number): [number, number] => [(x - cx) * k, (z - cz) * k];
    if (L) {
      for (const m of L.marks) {
        const [x, y] = at(m.pos.x, m.pos.z);
        this.blip(c, x, y, m.label, m.color, ui * 1.1);
      }
      if (L.car) {
        const [x, y] = at(L.car.x, L.car.z);
        c.fillStyle = '#5fb7ff';
        c.strokeStyle = '#111';
        c.lineWidth = 2;
        c.beginPath();
        c.roundRect(x - 7 * ui, y - 5 * ui, 14 * ui, 10 * ui, 2 * ui);
        c.fill();
        c.stroke();
      }
      for (const p of L.players) {
        const [x, y] = at(p.x, p.z);
        c.fillStyle = '#4cd964';
        c.beginPath();
        c.arc(x, y, 6 * ui, 0, Math.PI * 2);
        c.fill();
      }
      const heading = Math.atan2(Math.cos(L.yaw), Math.sin(L.yaw));
      const [x, y] = at(L.player.x, L.player.z);
      this.arrow(c, x, y, heading + Math.PI / 2, ui * 1.2);
    }
    if (this.waypoint) {
      const [x, y] = at(this.waypoint.x, this.waypoint.z);
      this.waypointBlip(c, x, y, ui * 1.4);
    }
    c.restore();
    // Scale bar.
    const metres = this.bigRange > 700 ? 500 : this.bigRange > 300 ? 200 : 100;
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.fillRect(16 * ui, H - 40 * ui, metres * k + 20 * ui, 26 * ui);
    c.fillStyle = '#fff';
    c.fillRect(26 * ui, H - 22 * ui, metres * k, 3 * ui);
    c.font = `${12 * ui}px system-ui, sans-serif`;
    c.fillText(`${metres} m`, 26 * ui, H - 28 * ui);
    this.bigInfo.textContent = this.waypoint ? (this.gps ? `Navigace: ${this.gps}` : 'Hledám cestu…') : 'Klikni do mapy a nastav cíl · táhni = posun · kolečko = přiblížení';
  }

  // ------------------------------------------------------------------ phone map

  /** North-up rectangular map for the phone's Mapa app; `range` = metres from centre to the shorter edge. */
  drawRect(canvas: HTMLCanvasElement, player: THREE.Vector3, viewYaw: number, range: number,
    car: THREE.Vector3 | null, police: THREE.Vector3[], wanted: number, marks: MapMark[], players: THREE.Vector3[] = []) {
    const c = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const k = Math.min(W, H) / 2 / range;
    const ui = W / 260;
    c.save();
    c.fillStyle = C.land;
    c.fillRect(0, 0, W, H);
    c.translate(W / 2, H / 2);
    this.drawLayers(c, player.x, player.z, k);
    this.drawRoute(c, player.x, player.z, k, 3.5 * ui);
    const at = (p: { x: number; z: number }, pad: number): [number, number] => [
      Math.max(-W / 2 + pad, Math.min(W / 2 - pad, (p.x - player.x) * k)), Math.max(-H / 2 + pad, Math.min(H / 2 - pad, (p.z - player.z) * k)),
    ];
    for (const m of marks) {
      const [x, y] = at(m.pos, 11 * ui);
      this.blip(c, x, y, m.label, m.color, ui * 0.8);
    }
    if (car) {
      const [x, y] = at(car, 8 * ui);
      c.fillStyle = '#5fb7ff';
      c.strokeStyle = '#111';
      c.lineWidth = 2 * ui;
      c.beginPath();
      c.roundRect(x - 6 * ui, y - 4 * ui, 12 * ui, 8 * ui, 2 * ui);
      c.fill();
      c.stroke();
    }
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    for (const p of police) {
      const [x, y] = at(p, 7 * ui);
      c.fillStyle = wanted > 0 && blink ? '#ff3b3b' : '#3b6bff';
      c.beginPath();
      c.arc(x, y, 5 * ui, 0, Math.PI * 2);
      c.fill();
    }
    for (const p of players) {
      const [x, y] = at(p, 7 * ui);
      c.fillStyle = '#4cd964';
      c.beginPath();
      c.arc(x, y, 6 * ui, 0, Math.PI * 2);
      c.fill();
    }
    if (this.waypoint) {
      const [x, y] = at(this.waypoint, 14 * ui);
      this.waypointBlip(c, x, y, ui);
    }
    const heading = Math.atan2(Math.cos(viewYaw), Math.sin(viewYaw));
    this.arrow(c, 0, 0, heading + Math.PI / 2, ui);
    c.restore();
  }

  /** Phone map: canvas pixel -> world point (for setting a waypoint by tapping). */
  static rectToWorld(canvas: HTMLCanvasElement, px: number, py: number, player: THREE.Vector3, range: number) {
    const k = Math.min(canvas.clientWidth, canvas.clientHeight) / 2 / range;
    return { x: player.x + (px - canvas.clientWidth / 2) / k, z: player.z + (py - canvas.clientHeight / 2) / k };
  }
}
