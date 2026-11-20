// Streams chunks in and out around the viewer and switches their level of detail.
import * as THREE from 'three';
import type { WorldData, LoadedChunk } from './WorldData.ts';
import type { HeightField } from './HeightField.ts';
import type { Materials } from '../render/materials.ts';
import { buildTerrainGeometry } from './builders/terrain.ts';
import { paintGround } from './builders/groundTexture.ts';
import { buildBuildingsGeometry } from './builders/buildings.ts';
import { ChunkTrees } from './builders/trees.ts';
import { buildWaterGeometry, buildBridgeGeometry } from './builders/water.ts';
import type { PhysicsChunkSource } from '../physics/PhysicsWorld.ts';

/** LOD settings: terrain sample stride, ground texture size, tree detail. */
const LODS = [
  { maxDist: 260, stride: 1, tex: 1024, trees: 0 },
  { maxDist: 650, stride: 5, tex: 256, trees: 1 },
  { maxDist: Infinity, stride: 5, tex: 128, trees: 1 },
];
const HYSTERESIS = 40;

interface ChunkState {
  cx: number;
  cz: number;
  rect: { minX: number; minZ: number; maxX: number; maxZ: number };
  data?: LoadedChunk;
  loading: boolean;
  lod: number; // currently built LOD, -1 = not built
  wantLod: number;
  group?: THREE.Group;
  terrain?: THREE.Mesh;
  trees?: ChunkTrees;
  /** Triangle positions used for collision (buildings, bridges). */
  collisionMeshes: Float32Array[];
  disposables: { dispose(): void }[];
}

export interface ChunkStats {
  loaded: number;
  queued: number;
  lodCounts: number[];
}

export class ChunkManager {
  /** Chunks closer than this (to the chunk's nearest edge) are kept loaded. */
  viewDistance = 1500;
  /** Per-frame time budget for building meshes, in ms. */
  budgetMs = 6;
  readonly root = new THREE.Group();
  private states = new Map<string, ChunkState>();
  private terrainMaterials = new Map<string, THREE.MeshLambertMaterial>();

  constructor(private world: WorldData, private heights: HeightField, private mats: Materials) {}

  update(viewer: THREE.Vector3) {
    const m = this.world.manifest;
    const H = m.halfExtent, S = m.chunkSize, N = m.chunksPerSide;
    // 1. Decide which chunks are wanted and at which LOD.
    for (let cz = 0; cz < N; cz++) {
      for (let cx = 0; cx < N; cx++) {
        const minX = -H + cx * S, minZ = -H + cz * S;
        const dx = Math.max(minX - viewer.x, 0, viewer.x - (minX + S));
        const dz = Math.max(minZ - viewer.z, 0, viewer.z - (minZ + S));
        const d = Math.hypot(dx, dz);
        const key = `${cx},${cz}`;
        let st = this.states.get(key);
        if (d > this.viewDistance + (st ? HYSTERESIS : 0)) {
          if (st) this.unload(key, st);
          continue;
        }
        if (!st) {
          st = { cx, cz, rect: { minX, minZ, maxX: minX + S, maxZ: minZ + S }, loading: false, lod: -1, wantLod: 0, collisionMeshes: [], disposables: [] };
          this.states.set(key, st);
        }
        // LOD with hysteresis around the current level.
        let lod = LODS.findIndex((l) => d < l.maxDist);
        if (st.lod >= 0 && lod !== st.lod) {
          const keep = lod > st.lod ? d < LODS[st.lod].maxDist + HYSTERESIS : d > LODS[lod].maxDist - HYSTERESIS;
          if (keep) lod = st.lod;
        }
        st.wantLod = lod;
        if (!st.data && !st.loading) this.load(st);
      }
    }

    // 2. Build the most urgent chunks within the time budget.
    const pending = [...this.states.values()]
      .filter((s) => s.data && s.lod !== s.wantLod)
      .sort((a, b) => a.wantLod - b.wantLod || dist2(a, viewer) - dist2(b, viewer));
    const t0 = performance.now();
    for (const st of pending) {
      this.build(st);
      if (performance.now() - t0 > this.budgetMs) break;
    }
  }

  /** Collision data for a chunk once it has been built (null until then). */
  physicsSource(cx: number, cz: number): PhysicsChunkSource | null {
    const st = this.states.get(`${cx},${cz}`);
    if (!st || !st.data || st.lod < 0) return null;
    return {
      heights: st.data.heights, n: st.data.n, minX: st.rect.minX, minZ: st.rect.minZ,
      size: this.world.manifest.chunkSize, meshes: st.collisionMeshes,
    };
  }

  stats(): ChunkStats {
    const lodCounts = LODS.map(() => 0);
    let loaded = 0, queued = 0;
    for (const s of this.states.values()) {
      if (s.lod >= 0) {
        loaded++;
        lodCounts[s.lod]++;
      }
      if (s.lod !== s.wantLod) queued++;
    }
    return { loaded, queued, lodCounts };
  }

  private load(st: ChunkState) {
    st.loading = true;
    this.world.loadChunk(st.cx, st.cz).then(
      (data) => {
        st.loading = false;
        if (this.states.get(`${st.cx},${st.cz}`) !== st) return; // unloaded meanwhile
        st.data = data;
        this.heights.setChunk(st.cx, st.cz, data.heights);
      },
      (err) => {
        st.loading = false;
        console.error(`Chunk ${st.cx},${st.cz} failed to load`, err);
      },
    );
  }

  private build(st: ChunkState) {
    const data = st.data!;
    const lod = LODS[st.wantLod];
    const m = this.world.manifest;
    const { minX, minZ } = st.rect;

    if (!st.group) {
      // First build: static content that does not depend on LOD.
      st.group = new THREE.Group();
      st.group.name = `chunk ${st.cx},${st.cz}`;
      const bGeo = buildBuildingsGeometry(data.data.buildings);
      if (bGeo) {
        const mesh = new THREE.Mesh(bGeo, [this.mats.walls, this.mats.roofs, this.mats.flatRoofs]);
        mesh.castShadow = mesh.receiveShadow = true;
        st.group.add(mesh);
        st.disposables.push(bGeo);
        st.collisionMeshes.push(bGeo.attributes.position.array as Float32Array);
      }
      const wGeo = buildWaterGeometry(data.data, st.rect, this.heights);
      if (wGeo) {
        const mesh = new THREE.Mesh(wGeo, this.mats.water);
        mesh.receiveShadow = true;
        mesh.renderOrder = 1;
        st.group.add(mesh);
        st.disposables.push(wGeo);
      }
      const brGeo = buildBridgeGeometry(data.data, st.rect);
      if (brGeo) {
        const mesh = new THREE.Mesh(brGeo, [this.mats.bridgeDeck, this.mats.bridge]);
        mesh.castShadow = mesh.receiveShadow = true;
        st.group.add(mesh);
        st.disposables.push(brGeo);
        st.collisionMeshes.push(brGeo.attributes.position.array as Float32Array);
      }
      st.trees = new ChunkTrees(data.data.trees, this.heights, this.mats.trees, lod.trees);
      st.group.add(st.trees.group);
      this.root.add(st.group);
    } else {
      st.trees?.setLod(lod.trees);
    }

    // Terrain mesh and ground texture depend on the LOD.
    const prevLod = st.lod >= 0 ? LODS[st.lod] : undefined;
    if (!prevLod || prevLod.stride !== lod.stride || prevLod.tex !== lod.tex) {
      const geo = buildTerrainGeometry(data, minX, minZ, m.heightStep, lod.stride);
      let mat = st.terrain?.material as THREE.MeshLambertMaterial | undefined;
      if (!prevLod || prevLod.tex !== lod.tex) {
        const tex = paintGround(data.data, minX, minZ, m.chunkSize, lod.tex);
        if (mat) {
          mat.map?.dispose();
          mat.map = tex;
          mat.needsUpdate = true;
        } else {
          mat = new THREE.MeshLambertMaterial({ map: tex });
          this.terrainMaterials.set(`${st.cx},${st.cz}`, mat);
        }
      }
      if (st.terrain) {
        st.terrain.geometry.dispose();
        st.terrain.geometry = geo;
      } else {
        st.terrain = new THREE.Mesh(geo, mat);
        st.terrain.receiveShadow = true;
        st.group.add(st.terrain);
      }
    }
    st.lod = st.wantLod;
  }

  private unload(key: string, st: ChunkState) {
    this.states.delete(key);
    this.heights.setChunk(st.cx, st.cz, undefined);
    this.world.unloadChunk(st.cx, st.cz);
    if (st.group) this.root.remove(st.group);
    st.terrain?.geometry.dispose();
    const mat = this.terrainMaterials.get(key);
    if (mat) {
      mat.map?.dispose();
      mat.dispose();
      this.terrainMaterials.delete(key);
    }
    st.trees?.dispose();
    for (const d of st.disposables) d.dispose();
  }
}

function dist2(s: ChunkState, v: THREE.Vector3) {
  const x = (s.rect.minX + s.rect.maxX) / 2 - v.x, z = (s.rect.minZ + s.rect.maxZ) / 2 - v.z;
  return x * x + z * z;
}
