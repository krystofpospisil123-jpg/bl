// Invented supermarket brands that imitate the colours and layout of the real chains on the
// town's big stores, without copying their marks: different names and symbols (a cart, a sun,
// a coin). Drawn as vector shapes on a canvas, so signs stay sharp up close.

export interface Brand {
  /** Name drawn on the sign. */
  name: string;
  draw(g: CanvasRenderingContext2D, w: number, h: number): void;
}

const FONT = '"Inter", "Segoe UI", system-ui, sans-serif';

/** Fits `text` into `maxW` by shrinking the font; returns the size used. */
function fit(g: CanvasRenderingContext2D, text: string, maxW: number, start: number, weight = 800, italic = ''): number {
  let size = start;
  g.font = `${italic} ${weight} ${size}px ${FONT}`;
  while (g.measureText(text).width > maxW && size > 10) {
    size -= 2;
    g.font = `${italic} ${weight} ${size}px ${FONT}`;
  }
  return size;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Shopping cart symbol centred at (cx, cy) fitting into a box of `s` pixels. */
function cart(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  g.save();
  g.translate(cx, cy);
  g.scale(s / 100, s / 100);
  g.lineCap = g.lineJoin = 'round';
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(-42, -30);
  g.lineTo(-28, -30);
  g.lineTo(-16, 18);
  g.lineTo(30, 18);
  g.lineTo(38, -14);
  g.lineTo(-24, -14);
  g.stroke();
  for (const x of [-10, 24]) {
    g.beginPath();
    g.arc(x, 34, 7, 0, Math.PI * 2);
    g.fill();
  }
  // Three bars of goods in the basket.
  g.lineWidth = 6;
  for (const x of [-4, 8, 20]) {
    g.beginPath();
    g.moveTo(x, -8);
    g.lineTo(x + 2, 11);
    g.stroke();
  }
  g.restore();
}

/** "Nakupland": red square with a white cart, dark lettering on white (hypermarket, dark grey hall). */
const NAKUPLAND: Brand = {
  name: 'Nakupland',
  draw(g, w, h) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    const tall = w < h * 1.6;
    const sq = tall ? Math.min(w * 0.62, h * 0.55) : h * 0.82;
    const sx = tall ? (w - sq) / 2 : w * 0.06, sy = tall ? h * 0.1 : (h - sq) / 2;
    g.fillStyle = '#d6232a';
    g.fillRect(sx, sy, sq, sq);
    g.strokeStyle = g.fillStyle = '#ffffff';
    g.lineWidth = Math.max(2, sq * 0.04);
    g.strokeRect(sx + sq * 0.05, sy + sq * 0.05, sq * 0.9, sq * 0.9);
    cart(g, sx + sq / 2, sy + sq / 2, sq * 0.7);
    g.fillStyle = '#26292e';
    g.textBaseline = 'middle';
    if (tall) {
      g.textAlign = 'center';
      fit(g, 'Nakupland', w * 0.9, h * 0.14);
      g.fillText('Nakupland', w / 2, sy + sq + (h - sy - sq) / 2);
    } else {
      g.textAlign = 'left';
      const x = sx + sq + w * 0.04;
      fit(g, 'Nakupland', w - x - w * 0.04, h * 0.5);
      g.fillText('Nakupland', x, h / 2 + 2);
    }
  },
};

/** "Levno": blue field with a yellow sun disc and an orange ring (discounter, blue/yellow). */
const LEVNO: Brand = {
  name: 'Levno',
  draw(g, w, h) {
    g.fillStyle = '#0a4ea3';
    g.fillRect(0, 0, w, h);
    const tall = w < h * 1.6;
    const d = tall ? Math.min(w * 0.86, h * 0.62) : h * 0.86;
    const cx = tall ? w / 2 : w * 0.5, cy = tall ? h * 0.42 : h / 2;
    g.fillStyle = '#ee7d1a';
    g.beginPath();
    g.arc(cx, cy, d / 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffd400';
    g.beginPath();
    g.arc(cx, cy, d / 2 - d * 0.045, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0a4ea3';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fit(g, 'Levno', d * 0.78, d * 0.42, 900);
    g.fillText('Levno', cx, cy + d * 0.02);
    if (tall) {
      g.fillStyle = '#ffffff';
      fit(g, 'každý den levně', w * 0.9, h * 0.07, 700);
      g.fillText('každý den levně', w / 2, h * 0.86);
    }
  },
};

/** "Halíř": red field with big yellow italic lettering and a white swoosh (discounter, red/yellow). */
const HALIR: Brand = {
  name: 'Halíř',
  draw(g, w, h) {
    g.fillStyle = '#cf1f2e';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath();
    g.moveTo(0, h * 0.78);
    g.quadraticCurveTo(w * 0.5, h * 0.55, w, h * 0.86);
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffd21f';
    g.strokeStyle = '#7d0d17';
    const size = fit(g, 'Halíř', w * 0.84, h * 0.6, 900, 'italic');
    g.lineWidth = Math.max(2, size * 0.07);
    g.lineJoin = 'round';
    g.strokeText('Halíř', w / 2, h * 0.42);
    g.fillText('Halíř', w / 2, h * 0.42);
    g.fillStyle = '#ffd21f';
    g.beginPath();
    g.arc(w * 0.9, h * 0.15, Math.min(w, h) * 0.07, 0, Math.PI * 2);
    g.fill();
  },
};

const BY_LABEL: Record<string, Brand> = { Kaufland: NAKUPLAND, Lidl: LEVNO, Penny: HALIR };

/** The invented brand that stands in for a real chain's name on signs, if there is one. */
export function brandFor(label: string): Brand | undefined {
  return BY_LABEL[label];
}

/** Text shown in the interior banner and on the sign when logos cannot be drawn. */
export const brandName = (label: string): string => BY_LABEL[label]?.name ?? label;

export { roundRect };
