// Gun shops: a glowing ring on the pavement with a "ZBRANĚ" sign. Standing in the ring opens
// the shop window (buy weapons and ammo). Fictional shops placed on footpaths in town.
import * as THREE from 'three';
import type { RoadGraph } from '../world/format.ts';
import { WEAPONS, WEAPON_ORDER, formatKc, type Arsenal } from '../combat/Arsenal.ts';

/** Rough spots for the shops; each snaps to the nearest footpath node. */
const SPOTS: [number, number, string][] = [
  [-35, 205, 'Zbraně u náměstí'],
  [-170, -790, 'Zbraně Na Řadech'],
  [40, 690, 'Zbraně Fügnerova'],
];

function signTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#20252b';
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#f1c232';
  g.fillRect(0, 84, 256, 12);
  g.fillStyle = '#ffffff';
  g.font = 'bold 52px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 42);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Shops {
  readonly group = new THREE.Group();
  readonly spots: { pos: THREE.Vector3; name: string }[] = [];
  private panel = document.createElement('div');
  private open: number | null = null;
  private ring: THREE.MeshBasicMaterial;
  onMessage?: (text: string) => void;

  constructor(walk: RoadGraph, ground: (x: number, z: number) => number, private arsenal: Arsenal) {
    const nodes = walk.nodes;
    const tex = signTexture('ZBRANĚ');
    const signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x55595e, metalness: 0.5, roughness: 0.4 });
    this.ring = new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
    for (const [x, z, name] of SPOTS) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < nodes.length / 3; i++) {
        const d = (nodes[i * 3] - x) ** 2 + (nodes[i * 3 + 2] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      const px = nodes[best * 3], pz = nodes[best * 3 + 2];
      const pos = new THREE.Vector3(px, ground(px, pz), pz);
      this.spots.push({ pos, name });
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 32).rotateX(-Math.PI / 2), this.ring);
      ring.position.copy(pos).add(new THREE.Vector3(0, 0.06, 0));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), poleMat);
      pole.position.copy(pos).add(new THREE.Vector3(1.9, 1.3, 0));
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.08), signMat);
      sign.position.copy(pos).add(new THREE.Vector3(1.9, 2.75, 0));
      this.group.add(ring, pole, sign);
    }
    this.panel.id = 'shop';
    this.panel.hidden = true;
    document.body.append(this.panel);
  }

  /** Opens the shop when the player stands in a ring (on foot), closes it when they leave. */
  update(player: THREE.Vector3, onFoot: boolean, time: number) {
    this.ring.opacity = 0.45 + Math.sin(time * 4) * 0.2;
    let inside: number | null = null;
    if (onFoot) this.spots.forEach((s, i) => {
      if (Math.hypot(s.pos.x - player.x, s.pos.z - player.z) < 1.6) inside = i;
    });
    if (inside !== this.open) {
      this.open = inside;
      this.panel.hidden = inside === null;
      if (inside !== null) {
        document.exitPointerLock?.();
        this.render();
      }
    }
  }

  get isOpen() {
    return this.open !== null;
  }

  render() {
    if (this.open === null) return;
    const a = this.arsenal;
    const rows = WEAPON_ORDER.map((id) => {
      const w = WEAPONS[id];
      const own = a.owned.has(id);
      return `<div class="row"><b>${w.name}</b><span>${own ? `náboje: ${a.ammo[id]}` : formatKc(w.price)}</span>
        ${own ? '' : `<button data-buy="${id}">Koupit</button>`}
        <button data-ammo="${id}" ${own ? '' : 'disabled'}>Náboje ×${w.ammoPack} · ${formatKc(w.ammoPrice)}</button></div>`;
    }).join('');
    this.panel.innerHTML = `<h2>${this.spots[this.open].name}</h2><p>Peníze: <b>${formatKc(a.money)}</b></p>${rows}
      <p class="hint">Odejdi z kruhu pro zavření obchodu.</p>`;
    this.panel.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.addEventListener('click', () => {
        const msg = b.dataset.buy ? a.buyWeapon(b.dataset.buy as never) : a.buyAmmo(b.dataset.ammo as never);
        this.onMessage?.(msg);
        this.render();
      });
    });
  }
}
