// Headless tuning test for the car physics: flat ground, scripted inputs.
import RAPIER from '@dimforge/rapier3d-compat';
import { CarPhysics } from '../../src/vehicle/CarPhysics.ts';

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
// Flat heightfield 500x500 m plus a wall at z = 400
const n = 50, h = new Float32Array((n + 1) * (n + 1)).fill(0);
world.createCollider(RAPIER.ColliderDesc.heightfield(n, n, h, { x: 1000, y: 1, z: 1000 }));
world.createCollider(RAPIER.ColliderDesc.cuboid(50, 5, 0.5).setTranslation(0, 5, 300));
const car = new CarPhysics(RAPIER, world, { x: 0, y: 1.2, z: 0 }, 0);
const dt = 1 / 60;
let t = 0;
const log = (label: string) => {
  const p = car.body.translation(), r = car.body.rotation();
  const yaw = Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
  const tilt = Math.acos(Math.min(1, 1 - 2 * (r.x * r.x + r.z * r.z))) * 57.3;
  console.log(`${label.padEnd(18)} t=${t.toFixed(1)} pos=(${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}) v=${(car.speed * 3.6).toFixed(0)} km/h yaw=${(yaw * 57.3).toFixed(0)}° tilt=${tilt.toFixed(1)}° contact=${[0,1,2,3].map(i=>car.vehicle.wheelIsInContact(i)?1:0).join('')}`);
};
const run = (secs: number, input: { throttle: number; brake: number; steer: number; handbrake: boolean }, label: string) => {
  for (let i = 0; i < secs / dt; i++) { car.update(input, dt); world.step(); t += dt; }
  log(label);
};
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false };
run(1.5, idle, 'settle');
run(3, { ...idle, throttle: 1 }, 'accel 3s');
run(4, { ...idle, throttle: 1 }, 'accel 7s');
run(2, { ...idle, throttle: 1, steer: 1 }, 'turn left 2s');
run(1, { ...idle, throttle: 0.3, steer: 0 }, 'straighten');
run(3, { ...idle, steer: 0, brake: 1 }, 'brake 3s');
run(2, { ...idle, throttle: 1 }, 'go');
run(2, { ...idle, throttle: 0.5, steer: -1 }, 'slow right turn');
run(3, { ...idle, brake: 1 }, 'reverse 3s');
run(2, { ...idle, throttle: 1 }, 'stop reverse');
car.reset({ x: 0, y: 1.2, z: 200 }, 0);
run(1, idle, 'reset');
run(4, { ...idle, throttle: 1 }, 'toward wall');
run(3, { ...idle, throttle: 1 }, 'into wall');
run(1, idle, 'after wall');
