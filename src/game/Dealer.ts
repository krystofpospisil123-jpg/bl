// Car dealership: the showroom of Top Autosalon Blansko (Svitavská), the real Škoda dealer in
// town. Inside, three cars turn slowly on lit podiums – the Liftback RS, the Stoccarda GT and the
// Rosso (original designs, no brands). Walk up to a car and press F: pick a colour, then buy it
// (it is saved in your garage) or take it for a free test drive. Built once high above the town
// like the other halls, with its own colliders.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PhysicsWorld } from '../physics/PhysicsWorld.ts';
import { CarModel } from '../vehicle/CarModel.ts';
import { CAR_GROUND, type CarType } from '../assets/models.ts';
import { PAINTS, TYPE_POWER } from '../vehicle/Tuning.ts';
import { HumanCrowd, idlePose, restPose } from '../character/HumanRig.ts';
import { formatKc } from '../combat/Arsenal.ts';

const ORIGIN = new THREE.Vector3(600, 1500, 0);
const X0 = -12.5, X1 = 12.5, Z0 = -9.5, Z1 = 9.5, H = 5.4;
const PODIUM_R = 2.95, PODIUM_H = 0.22;

export interface Offer {
  type: CarType;
  name: string;
  price: number;
  /** Short line for the sign and the menu. */
  blurb: string;
  /** Factory colour (shown on the podium) and the colours on offer. */
  color: number;
  colors: number[];
  /** km/h for the spec sheet. */
  top: number;
  /** 0-100 km/h in seconds. */
  accel: number;
}

const paint = (name: string) => PAINTS.find(([n]) => n === name)![1];

export const OFFERS: Offer[] = [
  {
    type: 'rs', name: 'Liftback RS', price: 35000, blurb: 'Rodinný sporťák: 5 dveří, velký kufr, ostrý podvozek.',
    color: 0x1f5fa8, colors: [0x1f5fa8, paint('Bílá'), paint('Černá'), paint('Červená'), paint('Stříbrná'), 0x9fcf2a], top: 250, accel: 6.7,
  },
  {
    type: 'gt', name: 'Stoccarda GT', price: 80000, blurb: 'Kupé s motorem vzadu: přesné, rychlé, na každý den.',
    color: 0xd8dcde, colors: [0xd8dcde, paint('Černá'), paint('Žlutá'), paint('Modrá'), paint('Matná šedá'), 0x2f6a5a], top: 293, accel: 4.2,
  },
  {
    type: 'rosso', name: 'Rosso', price: 120000, blurb: 'Supersport s motorem uprostřed. Nejrychlejší auto ve městě.',
    color: 0xc4161c, colors: [0xc4161c, paint('Žlutá'), paint('Černá'), paint('Bílá'), paint('Oranžová'), paint('Modrá')], top: 330, accel: 3.1,
  },
];

function colored(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  const n = ng.attributes.position.count, c = new THREE.Color(color), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Big polished tiles (60 cm) with thin grout lines. */
function floorTexture(): THREE.CanvasTexture {
  const t = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#d9dade';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        g.fillStyle = `hsl(220, 4%, ${84 + Math.random() * 4}%)`;
        g.fillRect(i * 64 + 1, j * 64 + 1, 62, 62);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set((X1 - X0) / 2.4, (Z1 - Z0) / 2.4);
  t.anisotropy = 8;
  return t;
}

/** Price board next to a podium. */
function priceTexture(o: Offer): THREE.CanvasTexture {
  return canvasTexture(512, 300, (g) => {
    g.fillStyle = '#10151c';
    g.fillRect(0, 0, 512, 300);
    g.fillStyle = '#4fd18b';
    g.fillRect(0, 0, 512, 10);
    g.fillStyle = '#fff';
    g.font = 'bold 54px system-ui, sans-serif';
    g.fillText(o.name, 28, 82);
    g.font = '26px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText(`${o.top} km/h · 0–100 za ${o.accel.toString().replace('.', ',')} s`, 28, 130);
    g.fillText(`výkon ×${(TYPE_POWER[o.type] ?? 1).toString().replace('.', ',')} oproti běžnému autu`, 28, 168);
    g.fillStyle = '#4fd18b';
    g.font = 'bold 64px system-ui, sans-serif';
    g.fillText(formatKc(o.price), 28, 256);
  });
}

export class Dealer {
  readonly group = new THREE.Group();
  readonly spawn = ORIGIN.clone().add(new THREE.Vector3(0, 0.1, Z1 - 2.4));
  readonly spawnYaw = Math.PI; // facing -z, into the showroom
  readonly exit = ORIGIN.clone().add(new THREE.Vector3(0, 0, Z1 - 0.9));
  private podiums: { turn: THREE.Group; car: CarModel; spot: THREE.Vector3; type: CarType; color: number }[] = [];
  private crowd = new HumanCrowd(4);
  private pose = restPose();
  private time = 0;
  private panel = document.createElement('div');
  private open = -1;
  private pick = 0;
  private msg = '';
  isOpen = false;
  /** Closed with the button: stays closed until the player walks away from the car. */
  private dismissed = -1;
  /** Buy (saved to the garage) or a test drive; returns a message (empty when it worked). */
  onBuy?: (o: Offer, color: number, testDrive: boolean) => Promise<string>;
  private busy = false;
  money: () => number = () => 0;

  constructor(phys: PhysicsWorld) {
    const R = phys.R, world = phys.world;
    const parts: THREE.BufferGeometry[] = [];
    const colliders: [number, number, number, number, number, number][] = [];
    const add = (g: THREE.BufferGeometry, color: number) => parts.push(colored(g, color));
    const solid = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, collide = true) => {
      add(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
      if (collide) colliders.push([x, y, z, w / 2, h / 2, d / 2]);
    };
    const W = X1 - X0, D = Z1 - Z0, CX = (X0 + X1) / 2, CZ = (Z0 + Z1) / 2;
    // Floor collider (the visible floor is the polished tile plane).
    colliders.push([CX, -0.1, CZ, W / 2, 0.1, D / 2]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.12, metalness: 0.05 }));
    floor.position.set(CX, 0, CZ);
    floor.receiveShadow = true;
    this.group.add(floor);
    // Walls: back wall dark grey with the lit name, white side walls, the front a glass facade.
    solid(W, H, 0.3, CX, H / 2, Z0, 0x2b3038);
    solid(0.3, H, D, X0, H / 2, CZ, 0xeeeeec);
    solid(0.3, H, D, X1, H / 2, CZ, 0xeeeeec);
    solid(W, H, 0.3, CX, H / 2, Z1 + 0.15, 0x6d7884);
    // Skirting and a green accent band along the back wall.
    add(new THREE.BoxGeometry(W - 0.4, 0.1, 0.04).translate(CX, 0.05, Z0 + 0.17), 0x1d2228);
    add(new THREE.BoxGeometry(W - 0.4, 0.12, 0.04).translate(CX, 3.0, Z0 + 0.17), 0x4fd18b);
    // Front glass facade (looks out to a bright day) with mullions, and the doors.
    const glassTex = canvasTexture(512, 128, (g) => {
      const sky = g.createLinearGradient(0, 0, 0, 128);
      sky.addColorStop(0, '#bcd8ef');
      sky.addColorStop(0.62, '#e8f2f8');
      sky.addColorStop(0.63, '#9aa59a');
      sky.addColorStop(1, '#7d8478');
      g.fillStyle = sky;
      g.fillRect(0, 0, 512, 128);
      g.fillStyle = 'rgba(70, 110, 70, 0.55)';
      for (let i = 0; i < 18; i++) {
        g.beginPath();
        g.ellipse(Math.random() * 512, 76, 14 + Math.random() * 20, 12 + Math.random() * 12, 0, 0, Math.PI * 2);
        g.fill();
      }
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.6, H - 0.4), new THREE.MeshBasicMaterial({ map: glassTex, toneMapped: false }));
    glass.rotation.y = Math.PI;
    glass.position.set(CX, (H - 0.4) / 2 + 0.05, Z1 - 0.02);
    this.group.add(glass);
    for (let x = X0 + 2.5; x < X1 - 1; x += 2.5) if (Math.abs(x) > 1.4) add(new THREE.BoxGeometry(0.08, H, 0.1).translate(x, H / 2, Z1 - 0.06), 0x3a4048);
    add(new THREE.BoxGeometry(W, 0.1, 0.12).translate(CX, 2.6, Z1 - 0.07), 0x3a4048);
    add(new THREE.BoxGeometry(2.6, 2.5, 0.06).translate(0, 1.25, Z1 - 0.08), 0x2a3038);
    add(new THREE.BoxGeometry(2.3, 2.3, 0.02).translate(0, 1.2, Z1 - 0.12), 0x8fb7cf);
    add(new THREE.BoxGeometry(0.04, 2.3, 0.03).translate(0, 1.2, Z1 - 0.14), 0x2a3038);
    // Ceiling with rows of light panels.
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd8d8d4 }));
    ceiling.position.set(CX, H, CZ);
    this.group.add(ceiling);
    const lamp = new THREE.MeshBasicMaterial({ color: 0xfffbf0, toneMapped: false });
    const lampGeo = new THREE.BoxGeometry(3.2, 0.05, 0.5);
    for (let x = -8; x <= 8; x += 8) for (const z of [-5, 0, 5]) {
      const m = new THREE.Mesh(lampGeo, lamp);
      m.position.set(x, H - 0.03, z);
      this.group.add(m);
    }
    // Back wall name (lit letters).
    const nameTex = canvasTexture(1024, 160, (g) => {
      g.fillStyle = '#2b3038';
      g.fillRect(0, 0, 1024, 160);
      g.fillStyle = '#4fd18b';
      g.font = 'bold 92px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('TOP AUTOSALON', 512, 66);
      g.fillStyle = '#fff';
      g.font = '600 34px system-ui, sans-serif';
      g.fillText('BLANSKO · PRODEJ · SERVIS · ZKUŠEBNÍ JÍZDY', 512, 132);
    });
    const name = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.4), new THREE.MeshBasicMaterial({ map: nameTex, toneMapped: false }));
    name.position.set(0, 3.9, Z0 + 0.17);
    this.group.add(name);
    // Reception desk (right of the door) with a screen, and a lounge on the left.
    solid(3.2, 1.05, 0.8, 8.6, 0.525, 5.6, 0xf2f2f0);
    add(new THREE.BoxGeometry(3.3, 0.05, 0.9).translate(8.6, 1.07, 5.6), 0x2b3038);
    add(new THREE.BoxGeometry(3.21, 0.12, 0.02).translate(8.6, 0.8, 5.19), 0x4fd18b);
    add(new THREE.BoxGeometry(0.6, 0.38, 0.03).translate(8.2, 1.3, 5.8), 0x15181c);
    add(new THREE.BoxGeometry(0.06, 0.2, 0.06).translate(8.2, 1.15, 5.8), 0x15181c);
    for (const [x, z, r] of [[-9.2, 5.2, 0], [-7.4, 6.6, Math.PI / 2]] as const) {
      const sofa = new THREE.BoxGeometry(1.9, 0.42, 0.85).translate(0, 0.21, 0);
      const back = new THREE.BoxGeometry(1.9, 0.45, 0.2).translate(0, 0.62, -0.33);
      for (const g of [sofa, back]) add(g.rotateY(r).translate(x, 0, z), 0x3a4452);
      colliders.push([x, 0.4, z, r ? 0.45 : 0.95, 0.4, r ? 0.95 : 0.45]);
    }
    solid(0.9, 0.42, 0.9, -8.7, 0.21, 6.7, 0x2b3038);
    // Plants in the corners.
    for (const [x, z] of [[-11.6, -8.6], [11.6, -8.6], [-11.6, 8.4], [11.6, 3.5]] as const) {
      solid(0.6, 0.6, 0.6, x, 0.3, z, 0xe8e6e0);
      add(new THREE.SphereGeometry(0.55, 10, 8).scale(1, 1.4, 1).translate(x, 1.25, z), 0x3f7a3a);
    }
    const room = new THREE.Mesh(mergeGeometries(parts, false)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
    room.receiveShadow = true;
    this.group.add(room);

    // Podiums: a dark turntable with a glowing green rim, the car on top, a price board in front.
    const discMat = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.25, metalness: 0.4 });
    const rimMat = new THREE.MeshBasicMaterial({ color: 0x4fd18b, toneMapped: false });
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.5 });
    OFFERS.forEach((o, i) => {
      const x = (i - 1) * 7.8, z = -2.6;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(PODIUM_R + 0.12, PODIUM_R + 0.18, PODIUM_H - 0.04, 48), discMat);
      base.position.set(x, (PODIUM_H - 0.04) / 2, z);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(PODIUM_R + 0.13, 0.03, 6, 64).rotateX(Math.PI / 2), rimMat);
      rim.position.set(x, PODIUM_H - 0.04, z);
      const turn = new THREE.Group();
      turn.position.set(x, 0, z);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(PODIUM_R, PODIUM_R, 0.04, 48), discMat);
      top.position.y = PODIUM_H - 0.02;
      top.receiveShadow = true;
      const car = new CarModel(o.color, o.type);
      car.root.position.y = PODIUM_H - CAR_GROUND;
      car.root.rotation.y = 0.6;
      car.wheelAnchors?.forEach((a, k) => car.wheels[k].position.copy(a));
      turn.add(top, car.root);
      // Price board on a post at the front edge of the podium.
      const board = new THREE.Group();
      board.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06).translate(0, 0.5, 0), boardMat));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.64), new THREE.MeshBasicMaterial({ map: priceTexture(o), toneMapped: false }));
      face.position.set(0, 1.25, 0.01);
      board.add(new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.7, 0.03).translate(0, 1.25, -0.02), boardMat), face);
      board.position.set(x + 1.6, 0, z + PODIUM_R + 0.7);
      board.rotation.y = -0.25;
      this.group.add(base, rim, turn, board);
      colliders.push([x, 0.6, z, PODIUM_R * 0.62, 0.6, PODIUM_R * 0.62]);
      this.podiums.push({ turn, car, spot: ORIGIN.clone().add(new THREE.Vector3(x, 0, z)), type: o.type, color: o.color });
    });

    // Salesman at the desk and a couple looking at the cars.
    this.group.add(this.crowd.group);
    this.crowd.setOutfit(0, { skin: 0xe8c0a0, hair: 0x2a1e16, top: 0x1d2a3a, legs: 0x1d2a3a, shoes: 0x111111, hairStyle: 'short', build: 0.2 });
    this.crowd.setOutfit(1, { skin: 0xf1d0b5, hair: 0x8a6236, top: 0xe7e2d6, legs: 0x4a5a7a, shoes: 0x8a1f1f, female: true, hairStyle: 'ponytail', build: 0.85 });
    this.crowd.setOutfit(2, { skin: 0xd6a684, hair: 0x1d1612, top: 0x3f6f3a, legs: 0x2e3442, shoes: 0x2a3550, hairStyle: 'cap', build: 0.1, shortSleeves: true });
    this.crowd.count = 3;

    this.group.position.copy(ORIGIN);
    for (const [x, y, z, hx, hy, hz] of colliders) world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(ORIGIN.x + x, ORIGIN.y + y, ORIGIN.z + z).setFriction(0.5));

    this.panel.id = 'dealer';
    this.panel.hidden = true;
    document.body.append(this.panel);
    this.panel.addEventListener('click', (e) => this.onClick(e));
  }

  near(p: THREE.Vector3, spot: THREE.Vector3, r: number): boolean {
    return Math.hypot(p.x - spot.x, p.z - spot.z) < r && Math.abs(p.y - spot.y) < 3;
  }

  /** Index of the car whose podium the player stands at, or -1. */
  offerAt(p: THREE.Vector3): number {
    return this.podiums.findIndex((d) => this.near(p, d.spot, PODIUM_R + 1.4));
  }

  /** The player walked up to a car (F) or away from it. */
  show(i: number) {
    if (this.isOpen && this.open === i) return;
    this.open = i;
    this.pick = 0;
    this.msg = '';
    this.isOpen = true;
    this.panel.hidden = false;
    document.exitPointerLock?.();
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.hidden = true;
    this.setPodiumColor(this.open, OFFERS[this.open].color);
    this.open = -1;
  }

  private setPodiumColor(i: number, color: number) {
    const d = this.podiums[i];
    if (!d || d.color === color) return;
    const turn = d.turn, old = d.car;
    const car = new CarModel(color, d.type);
    car.root.position.copy(old.root.position);
    car.root.rotation.copy(old.root.rotation);
    car.wheelAnchors?.forEach((a, k) => car.wheels[k].position.copy(a));
    turn.remove(old.root);
    turn.add(car.root);
    d.car = car;
    d.color = color;
  }

  private onClick(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (!b || this.open < 0) return;
    const o = OFFERS[this.open];
    switch (b.dataset.a) {
      case 'color':
        this.pick = Number(b.dataset.i);
        this.setPodiumColor(this.open, o.colors[this.pick]);
        this.msg = '';
        return this.render();
      case 'buy':
      case 'test': {
        if (this.busy || !this.onBuy) return;
        this.busy = true;
        void this.onBuy(o, o.colors[this.pick], b.dataset.a === 'test').then((res) => {
          this.busy = false;
          if (!res) return;
          this.msg = res;
          this.render();
        });
        return;
      }
      case 'close':
        this.dismissed = this.open;
        return this.close();
    }
  }

  /** Re-open after "close" only once the player has left that podium. */
  canOpen(i: number) {
    if (i !== this.dismissed) this.dismissed = -1;
    return i >= 0 && this.dismissed !== i;
  }

  render() {
    if (this.open < 0) return;
    const o = OFFERS[this.open];
    const money = this.money();
    const name = (c: number) => PAINTS.find(([, v]) => v === c)?.[0] ?? (c === o.color ? 'Tovární' : 'Speciální');
    const swatches = o.colors.map((c, i) => `<button data-a="color" data-i="${i}" class="sw${i === this.pick ? ' on' : ''}" title="${name(c)}" style="background:#${c.toString(16).padStart(6, '0')}"></button>`).join('');
    const bar = (v: number, max: number) => `<u style="width:${Math.round(Math.min(1, v / max) * 100)}%"></u>`;
    this.panel.innerHTML = `<header><small>TOP AUTOSALON BLANSKO</small><h2>${o.name}</h2><p>${o.blurb}</p></header>
      <div class="specs">
        <div class="stat"><span>Max. rychlost</span><i>${bar(o.top, 340)}</i><b>${o.top} km/h</b></div>
        <div class="stat"><span>Zrychlení</span><i>${bar(10 - o.accel, 7.5)}</i><b>${o.accel.toString().replace('.', ',')} s</b></div>
        <div class="stat"><span>Výkon</span><i>${bar(TYPE_POWER[o.type] ?? 1, 2.2)}</i><b>×${(TYPE_POWER[o.type] ?? 1).toString().replace('.', ',')}</b></div>
      </div>
      <p class="lbl">Barva: <b>${name(o.colors[this.pick])}</b></p>
      <div class="swatches">${swatches}</div>
      <div class="price"><span>Cena</span><b>${formatKc(o.price)}</b><small>máš ${formatKc(money)}</small></div>
      <div class="actions">
        <button data-a="buy" class="main" ${money < o.price ? 'disabled' : ''}>Koupit</button>
        <button data-a="test">Zkušební jízda zdarma</button>
        <button data-a="close" class="x">Zavřít</button>
      </div>
      ${this.msg ? `<p class="msg">${this.msg}</p>` : ''}
      <p class="hint">Koupené auto se uloží do tvé garáže (D na mapě) a čeká před salonem. Zkušební auto se do garáže neuloží.</p>`;
  }

  /** Turntables and people; only called while the player is inside. */
  update(dt: number) {
    this.time += dt;
    const t = this.time;
    for (const d of this.podiums) d.turn.rotation.y += dt * 0.18;
    const root = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    const people: [number, number, number][] = [[8.6, 6.4, Math.PI], [-6.2, 1.6, Math.PI + 0.5], [-5.3, 1.9, Math.PI - 0.3]];
    people.forEach(([x, z, yaw], i) => {
      idlePose(this.pose, t + i * 3.7);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      root.compose(new THREE.Vector3(x, 0, z), q, one);
      this.crowd.setPose(i, root, this.pose);
    });
    this.crowd.commit();
  }
}
