// Headless test for the on-foot controller: walking, curb step, wall, jump, pushing a car.
import RAPIER from '@dimforge/rapier3d-compat';
import { CharacterPhysics } from '../../src/character/CharacterPhysics.ts';
import { CarPhysics } from '../../src/vehicle/CarPhysics.ts';

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const n = 50, h = new Float32Array((n + 1) * (n + 1)).fill(0);
world.createCollider(RAPIER.ColliderDesc.heightfield(n, n, h, { x: 400, y: 1, z: 400 }));
world.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.075, 5).setTranslation(0, 0.075, 10)); // 15 cm curb at z 5..15
world.createCollider(RAPIER.ColliderDesc.cuboid(5, 3, 0.5).setTranslation(0, 3, 30)); // wall at z 29.5
const car = new CarPhysics(RAPIER, world, { x: 10, y: 1.2, z: 0 }, Math.PI / 2);
const ch = new CharacterPhysics(RAPIER, world, { x: 0, y: 0.5, z: 0 });
const dt = 1 / 60;
let t = 0;
const run = (secs: number, input: { x: number; z: number; sprint: boolean; jump: boolean }, label: string) => {
  let maxY = -1e9;
  for (let i = 0; i < secs / dt; i++) {
    car.update({ throttle: 0, brake: 0, steer: 0, handbrake: true }, dt);
    ch.update(input, dt);
    world.step();
    t += dt;
    maxY = Math.max(maxY, ch.feet.y);
  }
  const f = ch.feet;
  const c = car.body.translation();
  console.log(`${label.padEnd(16)} t=${t.toFixed(1)} feet=(${f.x.toFixed(2)}, ${f.y.toFixed(2)}, ${f.z.toFixed(2)}) v=${ch.speed.toFixed(1)} grounded=${ch.grounded} maxFeetY=${maxY.toFixed(2)} car=(${c.x.toFixed(2)}, ${c.z.toFixed(2)})`);
};
const none = { x: 0, z: 0, sprint: false, jump: false };
run(1, none, 'settle');
run(2, { ...none, z: 1 }, 'walk +z 2s');
run(3, { ...none, z: 1 }, 'onto curb/wall');
run(1, { ...none, z: 1, jump: true }, 'jump at wall');
run(1, none, 'land');
run(3, { ...none, z: -1, sprint: true }, 'sprint back');
ch.teleport({ x: 4, y: 0, z: 0 });
run(0.5, none, 'teleport near car');
run(2, { ...none, x: 1 }, 'push car +x');
