// Entry point. Phase 1: a 2D inspector for the generated world data.
import './style.css';
import { WorldData } from './world/WorldData.ts';
import { MapPreview, type LayerFlags } from './preview/MapPreview.ts';
import { renderAttribution } from './ui/attribution.ts';

const LAYER_LABELS: Record<keyof LayerFlags, string> = {
  hillshade: 'Terén (DMR 5G)', areas: 'Plochy', water: 'Voda', roads: 'Silnice', rails: 'Koleje',
  buildings: 'Budovy', trees: 'Stromy', grid: 'Dlaždice', pois: 'Body zájmu',
};

async function main() {
  const status = document.getElementById('status')!;
  const world = await WorldData.load();
  renderAttribution(document.getElementById('attribution')!, world.manifest.attribution);

  const preview = new MapPreview(document.getElementById('view') as HTMLCanvasElement, world);
  const layers = document.getElementById('layers')!;
  for (const key of Object.keys(LAYER_LABELS) as (keyof LayerFlags)[]) {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = preview.layers[key];
    box.onchange = () => {
      preview.layers[key] = box.checked;
      preview.draw();
    };
    label.append(box, ' ', LAYER_LABELS[key]);
    layers.append(label);
  }
  const hover = document.getElementById('hover')!;
  preview.onHover = (s) => (hover.textContent = s);
  const sel = document.getElementById('selection')!;
  preview.onSelect = (b) => {
    sel.innerHTML = b
      ? `<b>Budova</b> <a href="https://www.openstreetmap.org/${b.id > 0 ? 'way' : 'relation'}/${Math.abs(b.id)}" target="_blank">OSM ${b.id}</a><br>` +
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
    `${sum('buildings')} budov, ${sum('roads')} úseků silnic, ${sum('trees')} stromů · ` +
    `výška ${m.elevation.min}–${m.elevation.max} m. Kolečko = zoom, tažení = posun, klik = info o budově.`;
}

main().catch((err) => {
  document.getElementById('status')!.textContent = String(err.message ?? err);
  console.error(err);
});
