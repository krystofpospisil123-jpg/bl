// Phase 1 2D data inspector, available at #mapa.
import type { WorldData } from '../world/WorldData.ts';
import { MapPreview, type LayerFlags } from './MapPreview.ts';

const LAYER_LABELS: Record<keyof LayerFlags, string> = {
  hillshade: 'Terén (DMR 5G)', areas: 'Plochy', water: 'Voda', roads: 'Silnice', rails: 'Koleje',
  buildings: 'Budovy', trees: 'Stromy', grid: 'Dlaždice', pois: 'Body zájmu',
};

export async function startPreview(canvas: HTMLCanvasElement, world: WorldData) {
  const hud = document.getElementById('hud')!;
  hud.innerHTML = `<h1>Blansko: Open World <small>2D mapa dat</small></h1>
    <div id="status">Načítám…</div><div id="layers"></div><div id="hover"></div><div id="selection"></div>
    <a href="#" class="back">← zpět do 3D</a>`;
  const status = hud.querySelector('#status')!;
  const preview = new MapPreview(canvas, world);
  const layers = hud.querySelector('#layers')!;
  for (const key of Object.keys(LAYER_LABELS) as (keyof LayerFlags)[]) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = `layer-${key}`;
    box.checked = preview.layers[key];
    box.onchange = () => {
      preview.layers[key] = box.checked;
      preview.draw();
    };
    label.append(box, ' ', LAYER_LABELS[key]);
    layers.append(label);
  }
  const hover = hud.querySelector('#hover')!;
  preview.onHover = (s) => (hover.textContent = s);
  const sel = hud.querySelector('#selection')!;
  preview.onSelect = (b) => {
    sel.innerHTML = b
      ? `<b>Budova</b> <a href="https://www.openstreetmap.org/${b.id > 0 ? 'way' : 'relation'}/${Math.abs(b.id)}" target="_blank" rel="noopener">OSM ${b.id}</a><br>` +
        `typ: ${b.kind}${b.name ? ` · ${b.name}` : ''}<br>výška: ${b.h} m (${b.tagged ? 'z OSM' : 'odhad'})<br>` +
        `terén: ${b.ground} m n. m., střecha ${b.top} m n. m.`
      : '';
  };
  const t0 = performance.now();
  await preview.loadAll((d, t) => (status.textContent = `Načítám dlaždice ${d}/${t}…`));
  const m = world.manifest;
  const sum = (k: 'buildings' | 'roads' | 'trees') => m.chunks.reduce((s, c) => s + c.counts[k], 0);
  status.textContent =
    `${m.chunks.length} dlaždic (${m.chunkSize} m) za ${((performance.now() - t0) / 1000).toFixed(1)} s · ` +
    `${sum('buildings')} budov, ${sum('trees')} stromů · výška ${m.elevation.min}–${m.elevation.max} m. ` +
    `Kolečko = zoom, tažení = posun, klik = info o budově.`;
}
