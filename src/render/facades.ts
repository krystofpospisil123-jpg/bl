// Procedural facade atlas: 8 styles x 3 rows (upper floor / ground floor / ground-floor
// entrance). One tile = one window bay (3.2 m) x one floor (3 m). Walls are painted in
// light greys so per-building vertex colours tint them; glass stays dark. A matching
// roughness atlas makes windows glossy, and the shader varies each window (curtains,
// lights, reflections) and adds weathering near the ground.
import * as THREE from 'three';

export const FACADE = {
  plaster: 0,
  panel: 1,
  oldtown: 2,
  industrial: 3,
  glass: 4, // offices; ground rows = shop storefront
  supermarket: 5,
  ornate: 6, // church / château
  blank: 7, // garages, sheds
  sorela: 8, // 1950s residential blocks: plaster, white windows, balconies
} as const;

export const ATLAS_COLS = 9;
const ROWS = 4;
const T = 256; // tile size in px

type Row = 'upper' | 'balcony' | 'ground' | 'door';
type Painter = (g: CanvasRenderingContext2D, r: CanvasRenderingContext2D, x: number, y: number, row: Row) => void;

/** Fills a rect in the colour canvas and the matching roughness (0..1) in the roughness canvas. */
function rect(g: CanvasRenderingContext2D, r: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, rough: number) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
  const v = Math.round(rough * 255);
  r.fillStyle = `rgb(${v},${v},${v})`;
  r.fillRect(x, y, w, h);
}

function shade(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha: number) {
  g.fillStyle = `rgba(0,0,0,${alpha})`;
  g.fillRect(x, y, w, h);
}

function plasterNoise(g: CanvasRenderingContext2D, x: number, y: number, base: number, spread: number, n = 1600) {
  for (let i = 0; i < n; i++) {
    const v = base + Math.floor((Math.random() - 0.5) * spread);
    g.fillStyle = `rgb(${v},${v},${v})`;
    const s = Math.random() < 0.8 ? 2 : 3;
    g.fillRect(x + Math.random() * T, y + Math.random() * T, s, s);
  }
}

/** Glass with sky gradient; roughness low so it reflects the environment. */
function glass(g: CanvasRenderingContext2D, r: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, '#62788c');
  grad.addColorStop(0.5, '#2e3b48');
  grad.addColorStop(1, '#1b232c');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  r.fillStyle = 'rgb(18,18,18)';
  r.fillRect(x, y, w, h);
}

/**
 * A recessed window: reveal shadow, frame, glass with mullions and a transom, sill below.
 */
function windowAt(g: CanvasRenderingContext2D, r: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  o: { frame?: string; mullions?: number; transom?: boolean; sill?: boolean; surround?: string } = {}) {
  const frame = o.frame ?? '#ececec';
  if (o.surround) rect(g, r, x - 12, y - 12, w + 24, h + 20, o.surround, 0.85);
  // Reveal (the wall's thickness) in shadow, deeper at top and left (sun from above).
  rect(g, r, x - 4, y - 4, w + 8, h + 8, '#9b9b9b', 0.9);
  shade(g, x - 4, y - 4, w + 8, 8, 0.25);
  shade(g, x - 4, y - 4, 6, h + 8, 0.15);
  rect(g, r, x, y, w, h, frame, 0.55);
  const f = 5;
  glass(g, r, x + f, y + f, w - 2 * f, h - 2 * f);
  g.fillStyle = frame;
  const mullions = o.mullions ?? 1;
  for (let i = 1; i <= mullions; i++) g.fillRect(x + (w * i) / (mullions + 1) - 3, y, 6, h);
  if (o.transom ?? true) g.fillRect(x, y + h * 0.3, w, 6);
  if (o.sill ?? true) {
    rect(g, r, x - 8, y + h + 4, w + 16, 8, '#d7d7d7', 0.7);
    shade(g, x - 8, y + h + 12, w + 16, 6, 0.18);
  }
}

function door(g: CanvasRenderingContext2D, r: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, glazed = true) {
  rect(g, r, x - 6, y - 6, w + 12, h + 6, '#9d9d9d', 0.9);
  shade(g, x - 6, y - 6, w + 12, 8, 0.25);
  rect(g, r, x, y, w, h, color, 0.6);
  if (glazed) glass(g, r, x + 10, y + 12, w - 20, h * 0.55);
  rect(g, r, x + w - 18, y + h * 0.55, 6, 14, '#c8c8c8', 0.3); // handle
  rect(g, r, x - 10, y + h, w + 20, 6, '#bdbdbd', 0.9); // step
}

/** Balcony slab with a railing drawn in front of the lower part of the tile. */
function balcony(g: CanvasRenderingContext2D, r: CanvasRenderingContext2D, x: number, y: number, rail = '#cfd2d4') {
  // Shadow cast on the wall above and the slab's underside.
  shade(g, x + 18, y + 150, T - 36, 12, 0.22);
  rect(g, r, x + 14, y + 232, T - 28, 14, '#bfbfbf', 0.85);
  shade(g, x + 14, y + 246, T - 28, 10, 0.3);
  g.fillStyle = rail;
  g.fillRect(x + 14, y + 162, T - 28, 6);
  for (let i = 18; i < T - 18; i += 13) g.fillRect(x + i, y + 168, 3, 64);
  r.fillStyle = 'rgb(90,90,90)';
  r.fillRect(x + 14, y + 162, T - 28, 6);
}

const STYLES: Painter[] = [
  // 0 plaster: classic residential house / block
  (g, r, x, y, row) => {
    rect(g, r, x, y, T, T, '#f1f1f1', 0.93);
    plasterNoise(g, x, y, 236, 18);
    if (row === 'upper') {
      windowAt(g, r, x + 72, y + 52, 112, 128);
    } else {
      rect(g, r, x, y + 196, T, 60, '#c9c9c9', 0.95); // plinth
      shade(g, x, y + 196, T, 4, 0.2);
      if (row === 'door') door(g, r, x + 78, y + 56, 100, 140, '#6e5a48');
      else windowAt(g, r, x + 72, y + 60, 112, 108);
    }
  },
  // 1 panel block: insulated panels, wide windows, balcony slab with railing
  (g, r, x, y, row) => {
    rect(g, r, x, y, T, T, '#ececec', 0.9);
    plasterNoise(g, x, y, 230, 14, 1000);
    rect(g, r, x, y + T - 6, T, 6, '#c4c4c4', 0.9); // panel joint
    rect(g, r, x + T - 4, y, 4, T, '#cccccc', 0.9);
    if (row === 'upper') {
      windowAt(g, r, x + 26, y + 40, 204, 116, { mullions: 2, transom: false, sill: false, frame: '#f4f4f4' });
      // Balcony / loggia parapet in front of the lower part
      rect(g, r, x + 8, y + 168, T - 16, 64, '#d2d2d2', 0.85);
      shade(g, x + 8, y + 160, T - 16, 8, 0.3);
      for (let i = 16; i < T - 16; i += 14) rect(g, r, x + i, y + 172, 4, 56, '#bdbdbd', 0.6);
    } else {
      rect(g, r, x, y + 210, T, 46, '#bdbdbd', 0.95);
      if (row === 'door') door(g, r, x + 70, y + 60, 116, 150, '#7b8790');
      else windowAt(g, r, x + 40, y + 70, 176, 96, { mullions: 2, transom: false, frame: '#f4f4f4' });
    }
  },
  // 2 old town: tall windows in stucco surrounds, cornice band, rusticated ground floor
  (g, r, x, y, row) => {
    rect(g, r, x, y, T, T, '#f4efe6', 0.94);
    plasterNoise(g, x, y, 238, 18);
    if (row === 'upper') {
      rect(g, r, x, y, T, 10, '#ddd6c8', 0.9);
      shade(g, x, y + 10, T, 4, 0.15);
      rect(g, r, x + 62, y + 22, 132, 18, '#ddd6c8', 0.85); // window head / pediment
      shade(g, x + 62, y + 40, 132, 4, 0.2);
      windowAt(g, r, x + 82, y + 50, 92, 160, { surround: '#e6dfd1', frame: '#f1ece2' });
    } else {
      rect(g, r, x, y, T, T, '#e4ddcf', 0.95);
      for (let i = 0; i < 7; i++) shade(g, x, y + 30 + i * 32, T, 3, 0.12); // rustication grooves
      if (row === 'door') door(g, r, x + 74, y + 46, 108, 172, '#5b3f2c', false);
      else windowAt(g, r, x + 80, y + 56, 96, 128, { frame: '#f1ece2' });
    }
  },
  // 3 industrial: corrugated cladding, strip windows high up, roller doors below
  (g, r, x, y, row) => {
    rect(g, r, x, y, T, T, '#e1e4e7', 0.5);
    for (let i = 0; i < T; i += 12) {
      rect(g, r, x + i, y, 4, T, '#cdd1d5', 0.45);
      shade(g, x + i + 4, y, 2, T, 0.06);
    }
    if (row === 'upper') windowAt(g, r, x + 10, y + 40, 236, 50, { mullions: 3, transom: false, sill: false, frame: '#d4d8db' });
    else if (row === 'door') {
      rect(g, r, x + 24, y + 70, 208, 186, '#b2b7bc', 0.55);
      for (let i = 0; i < 186; i += 12) shade(g, x + 24, y + 70 + i, 208, 3, 0.12);
    } else {
      rect(g, r, x, y + 220, T, 36, '#a9adb1', 0.8);
    }
  },
  // 4 glass: curtain-wall offices; ground rows are shop windows and a glazed entrance
  (g, r, x, y, row) => {
    if (row === 'upper') {
      glass(g, r, x, y, T, T);
      rect(g, r, x, y + T - 26, T, 26, '#cfd3d6', 0.45); // spandrel
      rect(g, r, x, y, 6, T, '#c7cbcf', 0.4);
      rect(g, r, x + 125, y, 6, T, '#c7cbcf', 0.4);
    } else {
      rect(g, r, x, y, T, T, '#d6d6d6', 0.6);
      rect(g, r, x, y, T, 36, '#8f8f8f', 0.5); // fascia for the sign
      shade(g, x, y + 36, T, 6, 0.25);
      if (row === 'door') {
        glass(g, r, x + 12, y + 50, T - 24, 206);
        rect(g, r, x + 124, y + 50, 8, 206, '#bdbdbd', 0.4);
        rect(g, r, x + 12, y + 140, T - 24, 6, '#bdbdbd', 0.4);
      } else {
        windowAt(g, r, x + 10, y + 52, 236, 176, { mullions: 1, transom: false, sill: false, frame: '#c4c4c4' });
        rect(g, r, x, y + 236, T, 20, '#b0b0b0', 0.8);
      }
    }
  },
  // 5 supermarket: horizontal metal cassettes, glazed front on the ground floor
  (g, r, x, y, row) => {
    rect(g, r, x, y, T, T, '#e8e8e8', 0.4);
    for (let i = 0; i < T; i += 32) {
      rect(g, r, x, y + i, T, 3, '#cdcdcd', 0.4);
      shade(g, x, y + i + 3, T, 2, 0.06);
    }
    for (let i = 0; i < T; i += 128) rect(g, r, x + i, y, 3, T, '#d2d2d2', 0.4);
    if (row !== 'upper') {
      glass(g, r, x + 4, y + 30, T - 8, 226);
      g.fillStyle = '#bdbdbd';
      for (let i = 0; i <= 2; i++) g.fillRect(x + 4 + (i * (T - 12)) / 2, y + 30, 4, 226);
      if (row === 'door') rect(g, r, x + 60, y + 120, 136, 6, '#9a9a9a', 0.4); // sliding door rail
    }
  },
  // 6 ornate stone: churches, château
  (g, r, x, y, row) => {
    rect(g, r, x, y, T, T, '#f0e9d6', 0.95);
    plasterNoise(g, x, y, 232, 24, 2400);
    rect(g, r, x, y + T - 14, T, 14, '#d8cdb2', 0.9);
    shade(g, x, y + T - 14, T, 3, 0.15);
    if (row === 'door') {
      // Arched portal
      const wx = x + 68, wy = y + 40, w = 120, h = 216;
      rect(g, r, wx - 12, wy - 12, w + 24, h + 12, '#ddd2b6', 0.85);
      g.fillStyle = '#4a3324';
      g.beginPath();
      g.moveTo(wx, wy + h);
      g.lineTo(wx, wy + w / 2);
      g.arc(wx + w / 2, wy + w / 2, w / 2, Math.PI, 0);
      g.lineTo(wx + w, wy + h);
      g.closePath();
      g.fill();
      return;
    }
    const wx = x + 84, wy = y + (row === 'ground' ? 70 : 40), w = 88, h = row === 'ground' ? 140 : 170;
    rect(g, r, wx - 10, wy - 10, w + 20, h + 20, '#ddd2b6', 0.85);
    g.fillStyle = '#26303b';
    g.beginPath();
    g.moveTo(wx, wy + h);
    g.lineTo(wx, wy + w / 2);
    g.arc(wx + w / 2, wy + w / 2, w / 2, Math.PI, 0);
    g.lineTo(wx + w, wy + h);
    g.closePath();
    g.fill();
    r.fillStyle = 'rgb(25,25,25)';
    r.fill();
    rect(g, r, wx + w / 2 - 3, wy + 20, 6, h - 20, '#ddd2b6', 0.8);
    rect(g, r, wx - 14, wy + h + 6, w + 28, 10, '#d3c8ac', 0.85);
  },
  // (8 sorela is appended below)
  // 7 blank: garages, sheds
  (g, r, x, y, row) => {
    rect(g, r, x, y, T, T, '#ebebeb', 0.95);
    plasterNoise(g, x, y, 228, 18);
    if (row !== 'upper') {
      rect(g, r, x, y + 220, T, 36, '#c6c6c6', 0.95);
      {
        rect(g, r, x + 34, y + 60, 188, 196, '#c2c6c9', 0.55); // garage door
        for (let i = 0; i < 196; i += 16) shade(g, x + 34, y + 60 + i, 188, 3, 0.12);
      }
    }
  },
  // 8 sorela: 1950s blocks (like náměstí Republiky): smooth plaster, white double windows,
  // stacked balconies with a balcony door, dark plinth on the ground floor.
  (g, r, x, y, row) => {
    rect(g, r, x, y, T, T, '#f3f3f1', 0.93);
    plasterNoise(g, x, y, 240, 12, 900);
    if (row === 'upper') {
      windowAt(g, r, x + 70, y + 50, 116, 120, { frame: '#fbfbfb', mullions: 1, transom: true });
    } else if (row === 'balcony') {
      // Balcony door next to a smaller window.
      windowAt(g, r, x + 52, y + 40, 70, 192, { frame: '#fbfbfb', mullions: 0, transom: true, sill: false });
      windowAt(g, r, x + 138, y + 50, 70, 100, { frame: '#fbfbfb', mullions: 0, transom: false });
      balcony(g, r, x, y);
    } else {
      rect(g, r, x, y + 170, T, 86, '#6e6862', 0.95); // dark plinth (tinted to brown)
      shade(g, x, y + 170, T, 5, 0.25);
      if (row === 'door') door(g, r, x + 78, y + 40, 100, 160, '#7a6450');
      else {
        windowAt(g, r, x + 70, y + 46, 116, 100, { frame: '#fbfbfb' });
        rect(g, r, x + 100, y + 196, 56, 34, '#3a3d40', 0.6); // cellar window
      }
    }
  },
];

export interface FacadeAtlas {
  map: THREE.Texture;
  roughness: THREE.Texture;
}

export function makeFacadeAtlas(): FacadeAtlas {
  const make = () => {
    const c = document.createElement('canvas');
    c.width = T * ATLAS_COLS;
    c.height = T * ROWS;
    return c;
  };
  const cc = make(), rc = make();
  const g = cc.getContext('2d')!, r = rc.getContext('2d')!;
  // Canvas rows top to bottom: upper floor, upper floor with balcony, ground floor, entrance.
  const rows: Row[] = ['upper', 'balcony', 'ground', 'door'];
  STYLES.forEach((paint, col) => rows.forEach((row, ri) => {
    const x = col * T, y = ri * T;
    if (row !== 'balcony' || col === FACADE.sorela) {
      paint(g, r, x, y, row);
    } else {
      // Other styles: plain upper floor, plus a balcony where such buildings have them.
      paint(g, r, x, y, 'upper');
      if (col === FACADE.plaster || col === FACADE.panel) balcony(g, r, x, y);
    }
  }));
  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughness = new THREE.CanvasTexture(rc);
  for (const t of [map, roughness]) {
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  return { map, roughness };
}

/**
 * Patches a MeshStandardMaterial so `uv` (bays, floors) is mapped into the atlas using the
 * per-vertex `facade` attribute (x = upper-floor style, y = ground-floor style).
 */
export function applyFacadeAtlas(mat: THREE.MeshStandardMaterial) {
  const rowH = (1 / ROWS).toFixed(5);
  const colW = (1 / ATLAS_COLS).toFixed(5);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 facade;\nvarying vec2 vFacade;\nvarying vec2 vFacadeUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFacade = facade;\nvFacadeUv = uv;');
    const atlasFn = /* glsl */ `
      varying vec2 vFacade;
      varying vec2 vFacadeUv;
      float facadeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      vec2 facadeAtlasUv() {
        vec2 cell = floor(vFacadeUv);
        vec2 f = fract(vFacadeUv);
        bool ground = cell.y < 0.5;
        float col = ground ? vFacade.y : vFacade.x;
        // Canvas row 0 (upper floors) is at the top of the texture (v near 1).
        float row = 0.0;
        if (ground) row = facadeHash(vec2(cell.x, col + 7.0)) < 0.22 ? 3.0 : 2.0;
        else row = facadeHash(vec2(cell.x, col + 19.0)) < 0.34 ? 1.0 : 0.0; // balconies stack per bay
        float vBase = 1.0 - (row + 1.0) * ${rowH};
        return vec2((col + 0.005 + f.x * 0.99) * ${colW}, vBase + (0.004 + f.y * 0.992) * ${rowH});
      }`;
    const grad = `dFdx(vFacadeUv) * vec2(${colW}, ${rowH}), dFdy(vFacadeUv) * vec2(${colW}, ${rowH})`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + atlasFn)
      .replace(
        '#include <map_fragment>',
        `vec2 atlasUv = facadeAtlasUv();
        vec4 sampledDiffuseColor = textureGrad(map, atlasUv, ${grad});
        float glassMask = 1.0 - smoothstep(0.08, 0.2, textureGrad(roughnessMap, atlasUv, ${grad}).g);
        // Each window looks a little different: curtains, darker rooms, brighter reflections.
        float wh = facadeHash(floor(vFacadeUv) + vec2(vFacade.x * 13.0, 3.0));
        vec3 curtain = mix(vec3(1.0), vec3(1.9, 1.7, 1.4), step(0.78, wh) * 0.6);
        sampledDiffuseColor.rgb *= mix(vec3(1.0), curtain * (0.75 + 0.5 * wh), glassMask);
        // Walls get dirtier towards the ground.
        float grime = mix(0.84, 1.0, smoothstep(-0.2, 0.9, vFacadeUv.y));
        sampledDiffuseColor.rgb *= mix(grime, 1.0, glassMask);
        diffuseColor *= sampledDiffuseColor;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;\nroughnessFactor *= textureGrad(roughnessMap, atlasUv, ${grad}).g;`,
      );
  };
  mat.customProgramCacheKey = () => 'facade-atlas-v3';
}
