// Geometry for hand-placed landmark features (see world/scenes.ts): the château's clock tower,
// round bastion, gate portal and renaissance gable. Built from simple shapes with vertex colours.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Extra } from '../scenes.ts';
import type { HeightField } from '../HeightField.ts';

const WHITE = 0xf2f0ea, OCHRE = 0xc99c4a, ROOF = 0xa8462e, STONE = 0xb8b0a0, DARK = 0x2c2a28;

function col(g: THREE.BufferGeometry, hex: number | ((i: number) => number)): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    c.setHex(typeof hex === 'number' ? hex : hex(Math.floor(i / 3)));
    arr.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Local frame: +z = outward (the direction the feature faces), +x = along the facade. */
function clockTower(size: number): THREE.BufferGeometry {
  const h = 22, s = size;
  const parts = [
    col(new THREE.BoxGeometry(s, h, s).translate(0, h / 2, 0), WHITE),
    col(new THREE.BoxGeometry(s + 0.4, 0.35, s + 0.4).translate(0, h - 0.2, 0), OCHRE), // cornice
    col(new THREE.ConeGeometry(s * 0.78, 4.5, 4).rotateY(Math.PI / 4).translate(0, h + 2.25, 0), ROOF),
    col(new THREE.CylinderGeometry(0.06, 0.06, 2, 6).translate(0, h + 5.2, 0), DARK), // finial
  ];
  // Clock faces on all four sides and small windows below them.
  for (let k = 0; k < 4; k++) {
    const rot = (k * Math.PI) / 2;
    const face = new THREE.CircleGeometry(1.25, 24).translate(0, h - 3.2, s / 2 + 0.03);
    const ring = new THREE.RingGeometry(1.25, 1.5, 24).translate(0, h - 3.2, s / 2 + 0.02);
    const hand1 = new THREE.BoxGeometry(0.08, 0.9, 0.02).translate(0, h - 3.2 + 0.4, s / 2 + 0.05);
    const hand2 = new THREE.BoxGeometry(0.7, 0.08, 0.02).translate(0.3, h - 3.2, s / 2 + 0.05);
    const win = new THREE.BoxGeometry(0.9, 1.4, 0.05).translate(0, h - 7, s / 2 + 0.02);
    for (const [g, c] of [[face, 0xf5f3ee], [ring, DARK], [hand1, DARK], [hand2, DARK], [win, 0x2a3440]] as const) parts.push(col(g.rotateY(rot), c));
  }
  return mergeGeometries(parts)!;
}

function bastion(r: number): THREE.BufferGeometry {
  const h = 9;
  // Rough stone: per-triangle colour variation.
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stone = () => [0xb8b0a0, 0xaaa294, 0xc4bcac, 0x9f988b][Math.floor(rnd() * 4)];
  return mergeGeometries([
    col(new THREE.CylinderGeometry(r, r * 1.05, h, 28, 6).translate(0, h / 2, 0), stone),
    col(new THREE.CylinderGeometry(r + 0.15, r + 0.15, 0.5, 28).translate(0, h, 0), STONE),
    col(new THREE.CircleGeometry(r, 28).rotateX(-Math.PI / 2).translate(0, h + 0.26, 0), 0x6d6a62),
    col(new THREE.BoxGeometry(0.5, 1.4, 0.4).translate(0, 4.5, r - 0.05), DARK), // arrow slit
    col(new THREE.BoxGeometry(0.5, 1.4, 0.4).translate(0, 4.5, -r + 0.05).rotateY(Math.PI / 3), DARK),
  ])!;
}

function portal(): THREE.BufferGeometry {
  const w = 5, h = 5.6, d = 0.6;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(w / 2, h);
  shape.lineTo(-w / 2, h);
  shape.lineTo(-w / 2, 0);
  const hole = new THREE.Path();
  const ow = 3.2, oh = 3.0;
  hole.moveTo(-ow / 2, 0);
  hole.lineTo(-ow / 2, oh);
  hole.absarc(0, oh, ow / 2, Math.PI, 0, true);
  hole.lineTo(ow / 2, 0);
  shape.holes.push(hole);
  const frame = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  // Dark passage behind the arch and a small plaque above it.
  const opening = new THREE.ShapeGeometry(new THREE.Shape(hole.getPoints(24)));
  return mergeGeometries([
    col(frame, 0xd8cdb0),
    col(opening.translate(0, 0, 0.02), 0x1e1c1a),
    col(new THREE.BoxGeometry(1.4, 0.8, 0.1).translate(0, h - 0.1, d + 0.03), 0xcfc4a6),
  ])!;
}

/** Renaissance attic gable: a stepped wall with semicircular crests and small pinnacles. */
function gable(width: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const w = width * (1 - i / steps);
    parts.push(col(new THREE.BoxGeometry(w, 1.1, 0.5).translate(0, i * 1.1 + 0.55, 0), WHITE));
    parts.push(col(new THREE.BoxGeometry(w + 0.2, 0.15, 0.6).translate(0, i * 1.1 + 1.1, 0), OCHRE));
    for (const side of [-1, 1]) {
      // Semicircular crest and a pinnacle at each step end.
      const crest = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2);
      parts.push(col(crest.translate(side * (w / 2 - 0.3), i * 1.1 + 1.15, 0), WHITE));
      parts.push(col(new THREE.ConeGeometry(0.12, 0.8, 6).translate(side * (w / 2 - 0.3), i * 1.1 + 2, 0), DARK));
    }
  }
  // Small windows in the lower steps.
  for (let k = -1; k <= 1; k++) parts.push(col(new THREE.BoxGeometry(0.8, 0.8, 0.55).translate(k * 2.2, 1.3, 0), 0x2a3440));
  return mergeGeometries(parts)!;
}

/** Coloured cladding panel on a wall: local +z faces out, the panel sits from y = 0 up. */
function panel(width: number, height: number, colour: number): THREE.BufferGeometry {
  return col(new THREE.BoxGeometry(width, height, 0.25).translate(0, height / 2, 0.12), colour);
}

/** Flat entrance canopy sticking out of a wall, with two slim posts at the front. */
function canopy(width: number, height: number, colour: number): THREE.BufferGeometry {
  const depth = 3.2;
  return mergeGeometries([
    col(new THREE.BoxGeometry(width, 0.45, depth).translate(0, height + 0.22, depth / 2), colour),
    ...[-1, 1].map((sd) => col(new THREE.CylinderGeometry(0.1, 0.1, height, 8).translate(sd * (width / 2 - 0.4), height / 2, depth - 0.3), 0x8d9296)),
  ])!;
}

export function buildLandmarkExtras(extras: Extra[], heights: HeightField, material: THREE.Material) {
  const group = new THREE.Group();
  const boxes: number[] = [];
  const geos: THREE.BufferGeometry[] = [];
  for (const e of extras) {
    let geo: THREE.BufferGeometry;
    switch (e.kind) {
      case 'clockTower': geo = clockTower(e.size ?? 7); break;
      case 'bastion': geo = bastion(e.size ?? 5); break;
      case 'portal': geo = portal(); break;
      case 'gable': geo = gable(e.size ?? 12); break;
      case 'panel': geo = panel(e.size ?? 4, e.height ?? 3, e.colour ?? 0xffffff); break;
      case 'canopy': geo = canopy(e.size ?? 8, e.height ?? 3.2, e.colour ?? 0x3a3d40); break;
    }
    geo.computeVertexNormals();
    const ground = heights.sample(e.x, e.z);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(e.x, ground - 0.3 + (e.base ?? 0), e.z);
    mesh.rotation.y = e.yaw;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    geos.push(geo);
    if (e.kind === 'clockTower') boxes.push(e.x, ground + 11, e.z, e.yaw, (e.size ?? 7) / 2, 11, (e.size ?? 7) / 2);
    if (e.kind === 'bastion') boxes.push(e.x, ground + 4.5, e.z, 0, (e.size ?? 5) * 0.85, 4.5, (e.size ?? 5) * 0.85);
  }
  return { group, boxes, dispose: () => geos.forEach((g) => g.dispose()) };
}
