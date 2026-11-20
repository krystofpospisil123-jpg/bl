// Entry point: 3D game by default, 2D data inspector at #mapa.
import './style.css';
import { WorldData } from './world/WorldData.ts';
import { renderAttribution } from './ui/attribution.ts';
import { startPreview } from './preview/startPreview.ts';
import { Game } from './game/Game.ts';

async function main() {
  const world = await WorldData.load();
  renderAttribution(document.getElementById('attribution')!, world.manifest.attribution);
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  if (location.hash === '#mapa') {
    document.body.classList.add('map-mode');
    await startPreview(canvas, world);
  } else {
    const game = new Game(canvas, world);
    (window as unknown as { game: unknown }).game = game; // handy for debugging in the console
  }
}

// Switching between the map and the 3D view reloads the page with the other mode.
window.addEventListener('hashchange', () => location.reload());

main().catch((err) => {
  const hud = document.getElementById('hud')!;
  hud.textContent = String(err?.message ?? err);
  console.error(err);
});
