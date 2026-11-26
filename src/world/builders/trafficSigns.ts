// Czech traffic signs (see scripts/lib/signs.ts for where they stand): round plates with a
// canvas atlas of 16 designs, posts, all instanced per chunk (two draw calls).
//   0-6 B20a speed limits 20..80, 7 P2 priority road, 8 P4 give way, 9 P6 stop, 10 IP6 pedestrian
//   crossing, 11 IP4a one-way street, 12 B2 no entry, 13 IP11a parking, 14 C1 roundabout,
//   15 the St Andrew's cross at level crossings.
import * as THREE from 'three';
import type { HeightField } from '../HeightField.ts';

const T = 256, COLS = 4, ROWS = 4;
/** Plate size (m) per tile; keep in sync with SIZE in scripts/lib/signs.ts. */
const SIZE = [0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.9, 0.75, 0.6, 0.6, 0.7, 0.6, 0.7, 0.9];
const RED = '#d2191f', BLUE = '#1457a5', YELLOW = '#f5c400';

type G = CanvasRenderingContext2D;

function disc(g: G, r: number, fill: string) {
  g.fillStyle = fill;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
}

function poly(g: G, pts: number[][], fill: string, stroke?: string, lw = 0) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.lineJoin = 'round';
    g.stroke();
  }
}

function roundRect(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const DRAW: ((g: G) => void)[] = [];

// Speed limits: white disc, red ring, black number.
[20, 30, 40, 50, 60, 70, 80].forEach((v, i) => {
  DRAW[i] = (g) => {
    disc(g, 124, RED);
    disc(g, 124 - 26, '#ffffff');
    g.fillStyle = '#111';
    g.font = '900 108px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(v), 0, 6);
  };
});

// P2: priority road, yellow diamond with white and black edges.
DRAW[7] = (g) => {
  poly(g, [[0, -122], [122, 0], [0, 122], [-122, 0]], '#ffffff');
  poly(g, [[0, -112], [112, 0], [0, 112], [-112, 0]], '#111');
  poly(g, [[0, -100], [100, 0], [0, 100], [-100, 0]], YELLOW);
};

// P4: give way, inverted triangle with a red border.
DRAW[8] = (g) => {
  poly(g, [[-122, -100], [122, -100], [0, 112]], RED);
  poly(g, [[-88, -76], [88, -76], [0, 76]], '#ffffff');
};

// P6: stop, red octagon with a white border and the word STOP.
DRAW[9] = (g) => {
  const oct = (r: number) => Array.from({ length: 8 }, (_, k) => [r * Math.cos(Math.PI / 8 + (k * Math.PI) / 4), r * Math.sin(Math.PI / 8 + (k * Math.PI) / 4)]);
  poly(g, oct(126), '#ffffff');
  poly(g, oct(112), RED);
  g.fillStyle = '#ffffff';
  g.font = '900 64px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('STOP', 0, 4);
};

// IP6: pedestrian crossing, blue square with a white triangle, a walking person on stripes.
DRAW[10] = (g) => {
  roundRect(g, -122, -122, 244, 244, 18);
  g.fillStyle = BLUE;
  g.fill();
  roundRect(g, -116, -116, 232, 232, 14);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 5;
  g.stroke();
  poly(g, [[0, -98], [92, 72], [-92, 72]], '#ffffff');
  poly(g, [[0, -72], [66, 58], [-66, 58]], BLUE);
  // Stripes
  g.fillStyle = '#ffffff';
  for (let k = -3; k <= 3; k += 2) g.fillRect(k * 11 - 5, 38, 11, 20);
  // Person
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(2, -34, 8, 0, Math.PI * 2);
  g.fill();
  g.lineCap = 'round';
  g.strokeStyle = '#ffffff';
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(2, -22);
  g.lineTo(-2, 12);
  g.moveTo(-2, 12);
  g.lineTo(-14, 36);
  g.moveTo(-2, 12);
  g.lineTo(12, 34);
  g.moveTo(1, -16);
  g.lineTo(-16, 4);
  g.moveTo(1, -16);
  g.lineTo(18, -2);
  g.stroke();
};

// IP4a: one-way street, blue rectangle with a big white arrow pointing up.
DRAW[11] = (g) => {
  roundRect(g, -122, -122, 244, 244, 18);
  g.fillStyle = BLUE;
  g.fill();
  roundRect(g, -116, -116, 232, 232, 14);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 5;
  g.stroke();
  poly(g, [[0, -92], [64, -6], [28, -6], [28, 92], [-28, 92], [-28, -6], [-64, -6]], '#ffffff');
};

// B2: no entry, red disc with a white bar.
DRAW[12] = (g) => {
  disc(g, 124, RED);
  g.fillStyle = '#ffffff';
  g.fillRect(-92, -22, 184, 44);
};

// IP11a: parking, blue square with a white P.
DRAW[13] = (g) => {
  roundRect(g, -122, -122, 244, 244, 18);
  g.fillStyle = BLUE;
  g.fill();
  roundRect(g, -116, -116, 232, 232, 14);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 5;
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = '900 190px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('P', 0, 12);
};

// C1: roundabout, blue disc with three white arrows chasing each other.
DRAW[14] = (g) => {
  disc(g, 124, BLUE);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(0, 0, 118, 0, Math.PI * 2);
  g.stroke();
  for (let k = 0; k < 3; k++) {
    const a0 = -Math.PI / 2 + (k * 2 * Math.PI) / 3 + 0.25, a1 = a0 + 1.5;
    g.beginPath();
    g.lineWidth = 22;
    g.lineCap = 'butt';
    g.arc(0, 0, 66, a0, a1);
    g.stroke();
    // Arrow head at the end of the arc (clockwise).
    const x = 66 * Math.cos(a1), y = 66 * Math.sin(a1), tx = -Math.sin(a1), ty = Math.cos(a1), nx = Math.cos(a1), ny = Math.sin(a1);
    poly(g, [[x + tx * 34, y + ty * 34], [x + nx * 30, y + ny * 30], [x - nx * 30, y - ny * 30]], '#ffffff');
  }
};

// St Andrew's cross: white arms with red borders, crossed.
DRAW[15] = (g) => {
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    g.save();
    g.rotate(a);
    g.fillStyle = RED;
    g.fillRect(-126, -34, 252, 68);
    g.fillStyle = '#ffffff';
    g.fillRect(-116, -24, 232, 48);
    g.restore();
  }
};

let atlas: THREE.CanvasTexture | null = null;

function makeAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const c = document.createElement('canvas');
  c.width = T * COLS;
  c.height = T * ROWS;
  const g = c.getContext('2d')!;
  DRAW.forEach((draw, i) => {
    g.save();
    g.translate((i % COLS) * T + T / 2, Math.floor(i / COLS) * T + T / 2);
    draw(g);
    g.restore();
  });
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 8;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  return atlas;
}

let plateMat: THREE.MeshStandardMaterial | null = null;
/** Material of the sign plates (alpha cut-out atlas; the back of every plate is plain steel grey). */
export function signMaterial(): THREE.MeshStandardMaterial {
  if (plateMat) return plateMat;
  const m = new THREE.MeshStandardMaterial({ map: makeAtlas(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.05 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float tile;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        #ifdef USE_MAP
          // Pick the tile of the 4 x 4 atlas (tile 0 is at the top left).
          vMapUv = vec2((uv.x + mod(tile, ${COLS}.0)) / ${COLS}.0, (uv.y + ${ROWS - 1}.0 - floor(tile / ${COLS}.0)) / ${ROWS}.0);
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.55, 0.57, 0.6);`,
    );
  };
  m.customProgramCacheKey = () => 'traffic-signs-v1';
  return m;
}

const postMat = new THREE.MeshStandardMaterial({ color: 0x8b9096, roughness: 0.5, metalness: 0.6 });
let plateGeo: THREE.PlaneGeometry | null = null;
let postGeo: THREE.CylinderGeometry | null = null;

/** How long a knocked-over sign lies on the ground before it is put back (s). */
const RESTORE_AFTER = 45;

interface SignItem {
  x: number; y: number; z: number; yaw: number; h: number; size: number;
  /** Index in the post mesh, or -1 for a plate without its own post. */
  post: number;
  /** 0 standing .. 1 lying on the ground. */
  fall: number;
  /** Knocked over: falls towards (dx, dz); `downFor` counts the time on the ground. */
  down: boolean;
  dx: number;
  dz: number;
  downFor: number;
}

export interface ChunkSigns {
  group: THREE.Group;
  /** Knocks over the signs within `radius` of (x, z), falling along (dx, dz). Returns how many. */
  knock(x: number, z: number, radius: number, dx: number, dz: number): number;
  /** Falling and standing-up animation; call every frame. */
  update(dt: number): void;
  dispose(): void;
}

/**
 * Builds the signs of a chunk from its flat `signs` data [x, z, yaw, tile, plateHeight, post, ...].
 * Signs have no collider: a car drives through them and knocks them over; they stand up again
 * after a while.
 */
export function buildTrafficSigns(signs: number[], heights: HeightField): ChunkSigns | null {
  const n = signs.length / 6;
  if (!n) return null;
  plateGeo ??= new THREE.PlaneGeometry(1, 1);
  postGeo ??= new THREE.CylinderGeometry(0.035, 0.035, 1, 6).translate(0, 0.5, 0);
  const group = new THREE.Group();
  const plates = new THREE.InstancedMesh(plateGeo, signMaterial(), n);
  const tileAttr = new Float32Array(n);
  let posts = 0;
  for (let i = 0; i < n; i++) if (signs[i * 6 + 5]) posts++;
  const postMesh = new THREE.InstancedMesh(postGeo, postMat, Math.max(1, posts));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), tilt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const off = new THREE.Vector3(), axis = new THREE.Vector3(), base = new THREE.Vector3();
  const items: SignItem[] = [];
  let pi = 0;
  for (let i = 0; i < n; i++) {
    const [x, z, yaw, tile, h, post] = signs.slice(i * 6, i * 6 + 6);
    items.push({ x, y: heights.sample(x, z), z, yaw, h, size: SIZE[tile] ?? 0.7, post: post ? pi++ : -1, fall: 0, down: false, dx: 0, dz: 0, downFor: 0 });
    tileAttr[i] = tile;
  }
  /** Writes the matrices of sign i: rotated about the foot of the post by its fall. */
  const place = (i: number) => {
    const s = items[i];
    // Ease: the sign tips slowly, then drops.
    const a = Math.pow(s.fall, 1.6) * (Math.PI / 2 - 0.06);
    axis.set(s.dz, 0, -s.dx).normalize();
    if (axis.lengthSq() < 0.5) axis.set(1, 0, 0);
    tilt.setFromAxisAngle(axis, a);
    base.set(s.x, s.y, s.z);
    // The plate sits just in front of the post (towards the driver).
    q.setFromAxisAngle(up, s.yaw).premultiply(tilt);
    off.set(Math.sin(s.yaw) * 0.05, s.h, Math.cos(s.yaw) * 0.05).applyQuaternion(tilt).add(base);
    m.compose(off, q, new THREE.Vector3(s.size, s.size, 1));
    plates.setMatrixAt(i, m);
    if (s.post >= 0) {
      off.set(0, -0.1, 0).applyQuaternion(tilt).add(base);
      m.compose(off, tilt, new THREE.Vector3(1, s.h + 0.5, 1));
      postMesh.setMatrixAt(s.post, m);
    }
  };
  for (let i = 0; i < n; i++) place(i);
  postMesh.count = pi;
  plates.geometry = plateGeo.clone();
  plates.geometry.setAttribute('tile', new THREE.InstancedBufferAttribute(tileAttr, 1));
  postMesh.castShadow = true;
  plates.frustumCulled = postMesh.frustumCulled = false; // spread over the whole chunk
  group.add(plates, postMesh);
  return {
    group,
    knock(x, z, radius, dx, dz) {
      let hit = 0;
      const len = Math.hypot(dx, dz) || 1;
      for (const s of items) {
        if (s.down || s.fall > 0.02) continue;
        if (Math.hypot(s.x - x, s.z - z) > radius) continue;
        s.down = true;
        s.downFor = 0;
        s.dx = dx / len;
        s.dz = dz / len;
        hit++;
      }
      return hit;
    },
    update(dt) {
      let changed = false;
      for (let i = 0; i < n; i++) {
        const s = items[i];
        if (s.down) {
          s.downFor += dt;
          if (s.fall < 1) {
            s.fall = Math.min(1, s.fall + dt * 2.6);
            place(i);
            changed = true;
          } else if (s.downFor > RESTORE_AFTER) s.down = false;
        } else if (s.fall > 0) {
          // Back up (as if the road crew put it back).
          s.fall = Math.max(0, s.fall - dt * 0.8);
          place(i);
          changed = true;
        }
      }
      if (changed) {
        plates.instanceMatrix.needsUpdate = true;
        postMesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose: () => {
      plates.geometry.dispose();
      plates.dispose();
      postMesh.dispose();
    },
  };
}
