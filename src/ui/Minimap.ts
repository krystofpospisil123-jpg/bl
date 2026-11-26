// Round minimap: the road and footpath network drawn once into a large canvas, shown around
// the player and rotated so the camera's view points up. Markers: player arrow, the player's
// parked car, police cars (flashing red/blue) and a north mark.
import * as THREE from 'three';
import type { RoadGraphs } from '../world/format.ts';

const BASE = 2048;
/** Metres shown from the centre to the edge of the minimap. */
const RANGE = 170;
/** Range of the enlarged map (M or a tap on the minimap). */
const BIG_RANGE = 650;

export interface MapMark {
  pos: THREE.Vector3;
  label: string;
  color: string;
  /** Place name (shown in the phone's map app). */
  name?: string;
}

export class Minimap {
  readonly canvas = document.createElement('canvas');
  private base: HTMLCanvasElement;
  private scale: number;
  private frame = 0;
  /** Enlarged, north-up map in the middle of the screen. */
  expanded = false;

  constructor(graphs: RoadGraphs, private half: number, private size: number) {
    this.canvas.id = 'minimap';
    this.resize();
    this.canvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    this.scale = BASE / (2 * half);
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = BASE;
    const g = this.base.getContext('2d')!;
    g.fillStyle = '#4c5a3f';
    g.fillRect(0, 0, BASE, BASE);
    g.lineCap = g.lineJoin = 'round';
    const draw = (graph: RoadGraphs['drive'], color: string, width: (kind: string) => number) => {
      g.strokeStyle = color;
      for (const e of graph.edges) {
        g.lineWidth = width(e.kind) * this.scale;
        g.beginPath();
        for (let i = 0; i < e.pts.length; i += 3) {
          const x = (e.pts[i] + half) * this.scale, y = (e.pts[i + 2] + half) * this.scale;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
    };
    draw(graphs.walk, '#8c8a7c', () => 2.5);
    draw(graphs.drive, '#d9d6cc', (k) => (k === 'primary' || k === 'secondary' ? 11 : k === 'tertiary' ? 9 : k === 'service' ? 4 : 6.5));
    document.body.append(this.canvas);
  }

  toggle() {
    this.expanded = !this.expanded;
    this.canvas.classList.toggle('big', this.expanded);
    this.resize();
  }

  private resize() {
    const size = this.expanded ? Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.84) : this.size;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.canvas.height = Math.round(size * dpr);
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.frame = 0;
  }

  /** North-up rectangular map for the phone's Mapa app; `range` = metres from centre to the shorter edge. */
  drawRect(canvas: HTMLCanvasElement, player: THREE.Vector3, viewYaw: number, range: number,
    car: THREE.Vector3 | null, police: THREE.Vector3[], wanted: number, marks: MapMark[]) {
    const c = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const k = Math.min(W, H) / 2 / range;
    const ui = W / 260;
    c.save();
    c.fillStyle = '#3c4733';
    c.fillRect(0, 0, W, H);
    c.translate(W / 2, H / 2);
    const s = k / this.scale;
    c.drawImage(this.base, -(player.x + this.half) * this.scale * s, -(player.z + this.half) * this.scale * s, BASE * s, BASE * s);
    const toMap = (p: THREE.Vector3) => [(p.x - player.x) * k, (p.z - player.z) * k];
    const inside = (x: number, y: number, pad: number) => [Math.max(-W / 2 + pad, Math.min(W / 2 - pad, x)), Math.max(-H / 2 + pad, Math.min(H / 2 - pad, y))];
    for (const m of marks) {
      const [x, y] = inside(...(toMap(m.pos) as [number, number]), 11 * ui);
      c.fillStyle = m.color;
      c.strokeStyle = '#000';
      c.lineWidth = 1.5 * ui;
      c.fillRect(x - 8 * ui, y - 8 * ui, 16 * ui, 16 * ui);
      c.strokeRect(x - 8 * ui, y - 8 * ui, 16 * ui, 16 * ui);
      c.fillStyle = '#111';
      c.font = `bold ${12 * ui}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(m.label, x, y + ui);
    }
    if (car) {
      const [x, y] = inside(...(toMap(car) as [number, number]), 8 * ui);
      c.fillStyle = '#fff';
      c.strokeStyle = '#222';
      c.lineWidth = 2 * ui;
      c.fillRect(x - 5 * ui, y - 5 * ui, 10 * ui, 10 * ui);
      c.strokeRect(x - 5 * ui, y - 5 * ui, 10 * ui, 10 * ui);
    }
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    for (const p of police) {
      const [x, y] = inside(...(toMap(p) as [number, number]), 7 * ui);
      c.fillStyle = wanted > 0 && blink ? '#ff3b3b' : '#3b6bff';
      c.beginPath();
      c.arc(x, y, 5 * ui, 0, Math.PI * 2);
      c.fill();
    }
    // You are here: a blue dot with a view cone, like a phone map.
    const heading = Math.atan2(Math.cos(viewYaw), Math.sin(viewYaw));
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 34 * ui);
    g.addColorStop(0, 'rgba(60, 150, 255, 0.55)');
    g.addColorStop(1, 'rgba(60, 150, 255, 0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, 34 * ui, heading - 0.55, heading + 0.55);
    c.fill();
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(0, 0, 8 * ui, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#1a7cff';
    c.beginPath();
    c.arc(0, 0, 5.5 * ui, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  update(
    player: THREE.Vector3, viewYaw: number,
    car: THREE.Vector3 | null, police: THREE.Vector3[], wanted: number, marks: MapMark[] = [],
  ) {
    if (this.frame++ % 2) return; // every other frame is plenty
    const c = this.canvas.getContext('2d')!;
    const W = this.canvas.width, R = W / 2;
    const k = (R / (this.expanded ? BIG_RANGE : RANGE)); // canvas px per metre
    const ui = W / (this.expanded ? 420 : 180); // marker scale
    c.save();
    c.clearRect(0, 0, W, W);
    c.beginPath();
    c.arc(R, R, R - 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#3c4733';
    c.fillRect(0, 0, W, W);
    // Rotate so the camera's forward direction (sin yaw, cos yaw) in map space points up.
    // Small map: rotates with the camera. Big map: north up, the arrow turns instead.
    const heading = Math.atan2(Math.cos(viewYaw), Math.sin(viewYaw));
    const rot = this.expanded ? 0 : -Math.PI / 2 - heading;
    const arrow = this.expanded ? heading + Math.PI / 2 : 0;
    c.translate(R, R);
    c.rotate(rot);
    const toMap = (p: THREE.Vector3) => [(p.x - player.x) * k, (p.z - player.z) * k];
    const s = k / this.scale;
    c.drawImage(this.base, -(player.x + this.half) * this.scale * s, -(player.z + this.half) * this.scale * s, BASE * s, BASE * s);
    if (car) {
      const [x, y] = toMap(car);
      c.fillStyle = '#ffffff';
      c.fillRect(x - 5 * ui, y - 5 * ui, 10 * ui, 10 * ui);
      c.strokeStyle = '#222';
      c.lineWidth = 2;
      c.strokeRect(x - 5 * ui, y - 5 * ui, 10 * ui, 10 * ui);
    }
    // Places (gun shops, garages): labelled squares; far ones stay at the rim.
    for (const m of marks) {
      let [x, y] = toMap(m.pos);
      const d = Math.hypot(x, y), maxD = R - 12 * ui;
      if (d > maxD) { x *= maxD / d; y *= maxD / d; }
      c.save();
      c.translate(x, y);
      c.rotate(-rot);
      c.scale(ui, ui);
      c.fillStyle = m.color;
      c.strokeStyle = '#000';
      c.lineWidth = 2;
      c.fillRect(-9, -9, 18, 18);
      c.strokeRect(-9, -9, 18, 18);
      c.fillStyle = '#111';
      c.font = 'bold 14px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(m.label, 0, 1);
      c.restore();
    }
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    for (const p of police) {
      let [x, y] = toMap(p);
      const d = Math.hypot(x, y), maxD = R - 10;
      if (d > maxD) { x *= maxD / d; y *= maxD / d; } // keep chasing cars at the edge
      c.fillStyle = wanted > 0 ? (blink ? '#ff3b3b' : '#3b6bff') : '#3b6bff';
      c.beginPath();
      c.arc(x, y, 6 * ui, 0, Math.PI * 2);
      c.fill();
    }
    // North mark ("S" = sever) on the rim.
    const nAngle = rot; // map north (-z) direction after the rotation
    c.restore();
    c.save();
    c.translate(R, R);
    const north = [Math.cos(-Math.PI / 2 + nAngle) * (R - 16), Math.sin(-Math.PI / 2 + nAngle) * (R - 16)];
    c.fillStyle = '#fff';
    c.font = `bold ${Math.round(W / 11)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('S', north[0], north[1]);
    // Player arrow (points the way the camera looks).
    c.save();
    c.rotate(arrow);
    c.scale(ui, ui);
    c.fillStyle = '#ffd23a';
    c.strokeStyle = '#000';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -11);
    c.lineTo(8, 9);
    c.lineTo(0, 4);
    c.lineTo(-8, 9);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    // Rim
    c.beginPath();
    c.arc(0, 0, R - 2, 0, Math.PI * 2);
    c.strokeStyle = wanted > 0 && blink ? '#ff5050' : 'rgba(255,255,255,0.7)';
    c.lineWidth = 3;
    c.stroke();
    c.restore();
  }
}
