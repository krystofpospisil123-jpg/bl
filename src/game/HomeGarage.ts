// The player's own garage: a fixed spot west of náměstí Republiky (D on the map). Stop in the
// green ring in a car to park it (saved with its tuning) or drive out another of your cars.
// The cars are saved in this browser (see Account).
import * as THREE from 'three';
import type { Account, GarageCar } from '../net/Account.ts';
import { GARAGE_SPACES } from '../net/Account.ts';
import { PAINTS, ENGINE } from '../vehicle/Tuning.ts';

/** Ring in front of the garage: on a short service road ~130 m west of the square. */
export const HOME_GARAGE = { x: -142.6, z: 224.5, yaw: Math.PI, radius: 3.2 };

const TYPE_NAMES: Record<string, string> = { hatch: 'Hatchback', liftback: 'Liftback', estate: 'Kombi', superb: 'Limuzína', suv: 'SUV', city: 'Městské auto' };

export function carTitle(c: { type: string; color: number }) {
  const paint = PAINTS.find(([, v]) => v === c.color)?.[0];
  return `${TYPE_NAMES[c.type] ?? 'Auto'}${paint ? ` · ${paint.toLowerCase()}` : ''}`;
}

export interface HomeGarageActions {
  /** The car you sit in right now (to park it). */
  current: () => { type: string; color: number; garageId: string | null };
  park: () => Promise<string>;
  takeOut: (car: GarageCar) => string;
  remove: (car: GarageCar) => Promise<string>;
}

export class HomeGarage {
  readonly group = new THREE.Group();
  private panel = document.createElement('div');
  private ring: THREE.Mesh;
  private beam: THREE.Mesh;
  isOpen = false;
  /** Closed with the button: stays closed until the car leaves the ring. */
  private dismissed = false;
  private msg = '';
  private busy = false;

  constructor(private account: Account, private actions: HomeGarageActions) {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x34d17a, transparent: true, opacity: 0.65, depthWrite: false }),
    );
    // A soft light column so the garage can be found from a distance.
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 40, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x34d17a, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
    );
    const label = document.createElement('canvas');
    label.width = 256;
    label.height = 96;
    const g = label.getContext('2d')!;
    g.fillStyle = 'rgba(16, 60, 36, 0.9)';
    g.beginPath();
    g.roundRect(8, 8, 240, 80, 18);
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('MOJE GARÁŽ', 128, 49);
    const tex = new THREE.CanvasTexture(label);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.scale.set(4, 1.5, 1);
    sprite.position.y = 5;
    this.beam.position.y = 20;
    this.group.add(this.ring, this.beam, sprite);
    this.panel.id = 'home-garage';
    this.panel.hidden = true;
    document.body.append(this.panel);
    this.panel.addEventListener('click', (e) => this.onClick(e));
  }

  /** Puts the marker on the ground (height of the terrain there). */
  place(groundY: number) {
    this.group.position.set(HOME_GARAGE.x, groundY + 0.06, HOME_GARAGE.z);
  }

  /** Distance check from the game; true when the car is stopped inside the ring. */
  inRing(p: THREE.Vector3) {
    return Math.hypot(p.x - HOME_GARAGE.x, p.z - HOME_GARAGE.z) < HOME_GARAGE.radius;
  }

  near(p: THREE.Vector3, d = 14) {
    return Math.hypot(p.x - HOME_GARAGE.x, p.z - HOME_GARAGE.z) < d;
  }

  update(t: number) {
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(t * 3) * 0.2;
  }

  open() {
    if (this.isOpen || this.dismissed) return;
    this.isOpen = true;
    this.msg = '';
    this.panel.hidden = false;
    document.exitPointerLock?.();
    this.render();
  }

  /** The car left the ring. */
  leave() {
    this.dismissed = false;
    this.close();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.hidden = true;
  }

  private async run(job: () => Promise<string> | string) {
    if (this.busy) return;
    this.busy = true;
    this.msg = 'Chvilku…';
    this.render();
    try {
      this.msg = await job();
    } catch (err) {
      this.msg = `Chyba: ${(err as Error).message}`;
    }
    this.busy = false;
    if (this.isOpen) this.render();
  }

  private onClick(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!b) return;
    const car = this.account.cars.find((c) => c.id === b.dataset.id);
    switch (b.dataset.a) {
      case 'park': return void this.run(() => this.actions.park());
      case 'out': if (car) void this.run(() => this.actions.takeOut(car)); return;
      case 'remove':
        if (car && confirm(`Opravdu vyhodit ${carTitle(car)} z garáže? Auto zmizí.`)) void this.run(() => this.actions.remove(car));
        return;
      case 'close':
        this.dismissed = true;
        return this.close();
    }
  }

  render() {
    const acc = this.account;
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const cur = this.actions.current();
    const saved = cur.garageId && acc.cars.some((c) => c.id === cur.garageId);
    const full = acc.cars.length >= GARAGE_SPACES;
    const rows = acc.cars.map((c) => {
      const active = c.id === cur.garageId;
      const parts = [c.tuning.engine ? ENGINE[c.tuning.engine].name.split(' (')[0] : '', c.tuning.neon != null ? 'neon' : '', c.tuning.spoiler ? 'křídlo' : '', c.tuning.lowered ? 'snížené' : ''].filter(Boolean);
      return `<div class="car${active ? ' active' : ''}"><i style="background:#${c.color.toString(16).padStart(6, '0')}"></i>
        <span><b>${esc(carTitle(c))}</b><small>${active ? 'právě jedeš tímhle' : parts.join(' · ') || 'sériové'}</small></span>
        ${active ? '' : `<button data-a="out" data-id="${c.id}">Vyjet</button>`}<button data-a="remove" data-id="${c.id}" class="x" title="Vyhodit">✕</button></div>`;
    }).join('');
    const empty = Array.from({ length: GARAGE_SPACES - acc.cars.length }, () => '<div class="car empty"><span><small>volné místo</small></span></div>').join('');
    this.panel.innerHTML = `<h2>Moje garáž <small>${acc.cars.length}/${GARAGE_SPACES}</small></h2>
      <div class="cars">${rows}${empty}</div>
      ${saved ? '<p class="hint">Auto, ve kterém sedíš, je tvoje: tuning se ukládá sám.</p>'
        : `<button data-a="park" class="opt main" ${full ? 'disabled' : ''}>Zaparkovat toto auto (${esc(carTitle(cur))})</button>${full ? '<p class="hint">Garáž je plná, nejdřív nějaké auto vyhoď.</p>' : ''}`}
      ${this.msg ? `<p class="msg">${esc(this.msg)}</p>` : ''}
      <p class="hint">Vyjeď z kroužku a menu se zavře.</p>`;
  }
}
