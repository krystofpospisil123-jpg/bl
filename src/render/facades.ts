// Procedural facade atlas: 8 styles x 2 rows (upper floors / ground floor).
// One tile = one window bay (3.2 m) x one floor (3 m). Painted mostly in light greys so
// per-building vertex colours tint the walls; glass stays dark. A matching roughness
// atlas makes windows glossy (they reflect the sky through the environment map).
import * as THREE from 'three';

export const FACADE = {
  plaster: 0,
  panel: 1,
  oldtown: 2,
  industrial: 3,
  glass: 4, // offices; ground row = shop storefront
  supermarket: 5,
  ornate: 6, // church / château
  blank: 7, // garages, sheds
} as const;

export const ATLAS_COLS = 8;
const T = 128; // tile size in px

type Painter = (g: CanvasRenderingContext2D, r: CanvasRenderingContext2D, x: number, y: number, ground: boolean) => void;

/** Fills a rect in the colour canvas and the matching roughness value (0..1) in the roughness canvas. */
function rect(g: CanvasRenderingContext2D, r: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, rough: number) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
  const v = Math.round(rough * 255);
  r.fillStyle = `rgb(${v},${v},${v})`;
  r.fillRect(x, y, w, h);
}

function noise(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: number, spread: number, n = 500) {
  for (let i = 0; i < n; i++) {
    const v = base + Math.floor((Math.random() - 0.5) * spread);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x + Math.random() * w, y + Math.random() * h, 2, 2);
  }
}

/** A window with frame, glass gradient and mullions. */
function windowAt(g: CanvasRenderingContext2D, r: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frame = '#e6e6e6', mullions = 1, transom = true) {
  rect(g, r, x - 3, y - 3, w + 6, h + 6, frame, 0.6);
  const grad = g.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, '#5c6f80');
  grad.addColorStop(0.55, '#2c3844');
  grad.addColorStop(1, '#1d252e');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  r.fillStyle = 'rgb(20,20,20)';
  r.fillRect(x, y, w, h);
  g.fillStyle = frame;
  for (let i = 1; i <= mullions; i++) g.fillRect(x + (w * i) / (mullions + 1) - 1.5, y, 3, h);
  if (transom) g.fillRect(x, y + h * 0.3, w, 3);
}

const STYLES: Painter[] = [
  // 0 plaster: classic residential
  (g, r, x, y, ground) => {
    rect(g, r, x, y, T, T, '#f2f2f2', 0.92);
    noise(g, x, y, T, T, 236, 22);
    if (ground) {
      rect(g, r, x, y + 92, T, 36, '#d0d0d0', 0.95); // plinth
      windowAt(g, r, x + 36, y + 34, 56, 50);
    } else {
      windowAt(g, r, x + 36, y + 30, 56, 64);
      rect(g, r, x + 30, y + 96, 68, 6, '#cfcfcf', 0.8); // sill
    }
  },
  // 1 panel block (panelák): horizontal joints, wide windows, loggia band
  (g, r, x, y, ground) => {
    rect(g, r, x, y, T, T, '#ebebeb', 0.9);
    noise(g, x, y, T, T, 228, 18);
    rect(g, r, x, y + T - 4, T, 4, '#b8b8b8', 0.9);
    rect(g, r, x + T - 3, y, 3, T, '#c4c4c4', 0.9);
    if (ground) {
      windowAt(g, r, x + 20, y + 40, 88, 44, '#d8d8d8', 2, false);
    } else {
      windowAt(g, r, x + 14, y + 26, 100, 58, '#d8d8d8', 2, false);
      rect(g, r, x, y + 92, T, 22, '#c9c9c9', 0.85); // balcony parapet band
    }
  },
  // 2 old town: tall windows with surrounds and a cornice
  (g, r, x, y, ground) => {
    rect(g, r, x, y, T, T, '#f4f0e8', 0.93);
    noise(g, x, y, T, T, 238, 20);
    rect(g, r, x, y, T, 6, '#d9d3c6', 0.9);
    if (ground) {
      rect(g, r, x, y + 6, T, T - 6, '#e2dccf', 0.95);
      for (let i = 0; i < 6; i++) rect(g, r, x, y + 20 + i * 18, T, 2, '#cfc8b8', 0.95); // rustication
      windowAt(g, r, x + 38, y + 30, 52, 64, '#ece6da', 1, true);
    } else {
      rect(g, r, x + 30, y + 14, 68, 10, '#d6cfbf', 0.85); // pediment
      windowAt(g, r, x + 40, y + 28, 48, 76, '#ece6da', 1, true);
      rect(g, r, x + 34, y + 106, 60, 6, '#d6cfbf', 0.8);
    }
  },
  // 3 industrial: corrugated cladding, high strip windows
  (g, r, x, y, ground) => {
    rect(g, r, x, y, T, T, '#e0e3e6', 0.55);
    for (let i = 0; i < T; i += 8) rect(g, r, x + i, y, 3, T, '#c8ccd0', 0.5);
    if (ground) {
      rect(g, r, x + 14, y + 40, 100, 88, '#aeb3b8', 0.6); // roller door
      for (let i = 0; i < 88; i += 7) rect(g, r, x + 14, y + 40 + i, 100, 2, '#9aa0a6', 0.6);
    } else {
      windowAt(g, r, x + 6, y + 20, 116, 26, '#cfd3d6', 3, false);
    }
  },
  // 4 glass: offices upstairs, shop storefront on the ground floor
  (g, r, x, y, ground) => {
    if (ground) {
      rect(g, r, x, y, T, T, '#d8d8d8', 0.6);
      rect(g, r, x, y, T, 18, '#9a9a9a', 0.5); // fascia
      windowAt(g, r, x + 6, y + 24, 116, 100, '#c9c9c9', 1, false);
    } else {
      rect(g, r, x, y, T, T, '#2f3c48', 0.08);
      const grad = g.createLinearGradient(0, y, 0, y + T);
      grad.addColorStop(0, '#6c8094');
      grad.addColorStop(1, '#25303b');
      g.fillStyle = grad;
      g.fillRect(x, y, T, T);
      rect(g, r, x, y + T - 14, T, 14, '#c8ccd0', 0.5);
      rect(g, r, x, y, 4, T, '#c8ccd0', 0.4);
      rect(g, r, x + 62, y, 4, T, '#c8ccd0', 0.4);
    }
  },
  // 5 supermarket: metal cladding, big glazed entrance on the ground floor
  (g, r, x, y, ground) => {
    rect(g, r, x, y, T, T, '#e6e6e6', 0.45);
    for (let i = 0; i < T; i += 16) rect(g, r, x, y + i, T, 2, '#cfcfcf', 0.45);
    if (ground) windowAt(g, r, x + 2, y + 18, 124, 110, '#bdbdbd', 2, false);
  },
  // 6 ornate stone: churches, château
  (g, r, x, y, ground) => {
    rect(g, r, x, y, T, T, '#f1ead8', 0.95);
    noise(g, x, y, T, T, 232, 26, 700);
    rect(g, r, x, y + T - 8, T, 8, '#d8cdb2', 0.9);
    // Arched window
    const wx = x + 42, wy = y + (ground ? 40 : 22), w = 44, h = ground ? 70 : 82;
    rect(g, r, wx - 4, wy - 4, w + 8, h + 8, '#dcd2b8', 0.85);
    g.fillStyle = '#2a3440';
    g.beginPath();
    g.moveTo(wx, wy + h);
    g.lineTo(wx, wy + w / 2);
    g.arc(wx + w / 2, wy + w / 2, w / 2, Math.PI, 0);
    g.lineTo(wx + w, wy + h);
    g.closePath();
    g.fill();
    r.fillStyle = 'rgb(30,30,30)';
    r.fill();
    rect(g, r, wx + w / 2 - 1.5, wy + 10, 3, h - 10, '#dcd2b8', 0.8);
  },
  // 7 blank: garages, sheds (door on the ground floor)
  (g, r, x, y, ground) => {
    rect(g, r, x, y, T, T, '#ececec', 0.95);
    noise(g, x, y, T, T, 230, 20);
    if (ground) {
      rect(g, r, x + 20, y + 30, 88, 98, '#bfc3c6', 0.6);
      for (let i = 0; i < 98; i += 9) rect(g, r, x + 20, y + 30 + i, 88, 2, '#a9adb0', 0.6);
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
    c.height = T * 2;
    return c;
  };
  const cc = make(), rc = make();
  const g = cc.getContext('2d')!, r = rc.getContext('2d')!;
  STYLES.forEach((paint, col) => {
    paint(g, r, col * T, 0, false);
    paint(g, r, col * T, T, true);
  });
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
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 facade;\nvarying vec2 vFacade;\nvarying vec2 vFacadeUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFacade = facade;\nvFacadeUv = uv;');
    const atlasFn = /* glsl */ `
      varying vec2 vFacade;
      varying vec2 vFacadeUv;
      vec2 facadeAtlasUv() {
        float floorIdx = floor(vFacadeUv.y);
        vec2 f = fract(vFacadeUv);
        bool ground = floorIdx < 0.5;
        float col = ground ? vFacade.y : vFacade.x;
        float rowBase = ground ? 0.0 : 0.5;
        return vec2((col + 0.01 + f.x * 0.98) / ${ATLAS_COLS.toFixed(1)}, rowBase + (0.005 + f.y * 0.99) * 0.5);
      }`;
    const grad = `dFdx(vFacadeUv) * vec2(${(1 / ATLAS_COLS).toFixed(4)}, 0.5), dFdy(vFacadeUv) * vec2(${(1 / ATLAS_COLS).toFixed(4)}, 0.5)`;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + atlasFn)
      .replace(
        '#include <map_fragment>',
        `vec2 atlasUv = facadeAtlasUv();\nvec4 sampledDiffuseColor = textureGrad(map, atlasUv, ${grad});\ndiffuseColor *= sampledDiffuseColor;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;\nroughnessFactor *= textureGrad(roughnessMap, atlasUv, ${grad}).g;`,
      );
  };
  mat.customProgramCacheKey = () => 'facade-atlas';
}
