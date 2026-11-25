// Rapier world with colliders streamed around the player: terrain heightfields,
// building and bridge triangle meshes, plus walls around the playable area.
import RAPIER from '@dimforge/rapier3d-compat';
import type { Manifest } from '../world/format.ts';

export interface PhysicsChunkSource {
  heights: Float32Array; // row-major, row = z
  n: number; // samples per side
  minX: number;
  minZ: number;
  size: number;
  meshes: Float32Array[]; // non-indexed triangle positions (buildings, bridges)
  boxes?: number[]; // flat [x, y, z, yaw, hx, hy, hz, ...] (props, parked cars)
}

export const FIXED_DT = 1 / 60;

export class PhysicsWorld {
  readonly R = RAPIER;
  readonly world: RAPIER.World;
  private chunkColliders = new Map<string, RAPIER.Collider[]>();
  private acc = 0;
  /** Radius (m) around the focus point within which chunk colliders exist. */
  radius = 260;

  static async create(m: Manifest): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld(m);
  }

  private constructor(private m: Manifest) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    // Invisible walls along the edges of the generated area.
    const H = m.halfExtent, y = (m.elevation.min + m.elevation.max) / 2, hh = (m.elevation.max - m.elevation.min) / 2 + 200;
    for (const [x, z, hx, hz] of [[H + 1, 0, 1, H + 2], [-H - 1, 0, 1, H + 2], [0, H + 1, H + 2, 1], [0, -H - 1, H + 2, 1]]) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hh, hz).setTranslation(x, y, z));
    }
  }

  /**
   * Ensures colliders exist for chunks near `focus` and removes distant ones.
   * `source` returns null while a chunk's data or meshes are not ready yet.
   */
  updateStreaming(fx: number, fz: number, source: (cx: number, cz: number) => PhysicsChunkSource | null): boolean {
    const { halfExtent: H, chunkSize: S, chunksPerSide: N } = this.m;
    let focusReady = false;
    let built = 0; // limit collider builds per frame to keep frames short
    const wanted = new Set<string>();
    for (let cz = 0; cz < N; cz++)
      for (let cx = 0; cx < N; cx++) {
        const minX = -H + cx * S, minZ = -H + cz * S;
        const dx = Math.max(minX - fx, 0, fx - (minX + S)), dz = Math.max(minZ - fz, 0, fz - (minZ + S));
        if (Math.hypot(dx, dz) > this.radius) continue;
        const key = `${cx},${cz}`;
        wanted.add(key);
        const inside = dx === 0 && dz === 0;
        if (this.chunkColliders.has(key)) {
          if (inside) focusReady = true;
          continue;
        }
        if (built >= 2 && !inside) continue;
        const src = source(cx, cz);
        if (!src) continue;
        built++;
        this.chunkColliders.set(key, this.buildChunk(src));
        if (inside) focusReady = true;
      }
    for (const [key, cols] of this.chunkColliders) {
      if (wanted.has(key)) continue;
      for (const c of cols) this.world.removeCollider(c, false);
      this.chunkColliders.delete(key);
    }
    return focusReady;
  }

  private buildChunk(src: PhysicsChunkSource): RAPIER.Collider[] {
    const cols: RAPIER.Collider[] = [];
    const n = src.n, cells = n - 1;
    // Rapier heightfields are column-major with rows along Z: index = x * n + z.
    const hf = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hf[i * n + j] = src.heights[j * n + i];
    cols.push(
      this.world.createCollider(
        RAPIER.ColliderDesc.heightfield(cells, cells, hf, { x: src.size, y: 1, z: src.size })
          .setTranslation(src.minX + src.size / 2, 0, src.minZ + src.size / 2)
          .setFriction(1.0),
      ),
    );
    for (const pos of src.meshes) {
      if (pos.length < 9) continue;
      const idx = new Uint32Array(pos.length / 3);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
      const desc = RAPIER.ColliderDesc.trimesh(pos, idx);
      if (desc) cols.push(this.world.createCollider(desc.setFriction(0.4)));
    }
    const b = src.boxes ?? [];
    for (let i = 0; i + 6 < b.length; i += 7) {
      const yaw = b[i + 3];
      cols.push(
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(b[i + 4], b[i + 5], b[i + 6])
            .setTranslation(b[i], b[i + 1], b[i + 2])
            .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
            .setFriction(0.5),
        ),
      );
    }
    return cols;
  }

  /** Advances the simulation with a fixed step; `beforeStep` runs before every sub-step. */
  /**
   * How far the render time is between the last two physics steps (0..1). Rendered poses are
   * blended by this so motion stays smooth when the frame rate is not exactly 60 Hz.
   */
  get alpha(): number {
    return Math.min(1, this.acc / FIXED_DT);
  }

  step(dt: number, beforeStep: (dt: number) => void) {
    this.acc = Math.min(this.acc + dt, FIXED_DT * 5);
    while (this.acc >= FIXED_DT) {
      beforeStep(FIXED_DT);
      this.world.timestep = FIXED_DT;
      this.world.step();
      this.acc -= FIXED_DT;
    }
  }

  /** Distance along a ray to the first static obstacle (for camera collision), or `max`. */
  castRay(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, max: number, exclude?: RAPIER.RigidBody): number {
    const hit = this.world.castRay(new RAPIER.Ray(origin, dir), max, true, undefined, undefined, undefined, exclude);
    return hit ? hit.timeOfImpact : max;
  }
}
