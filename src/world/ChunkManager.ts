// Streams chunks in and out around the viewer and switches their level of detail.
import * as THREE from 'three';
import type { WorldData, LoadedChunk } from './WorldData.ts';
import type { HeightField } from './HeightField.ts';
import type { Materials } from '../render/materials.ts';
import { buildTerrainGeometry } from './builders/terrain.ts';
import { GroundPainter } from './GroundPainter.ts';
import { buildBuildingsGeometry } from './builders/buildings.ts';
import { ChunkTrees } from './builders/trees.ts';
import { buildWaterGeometry, buildBridgeGeometry } from './builders/water.ts';
import type { PhysicsChunkSource } from '../physics/PhysicsWorld.ts';
import { buildSigns } from './builders/signs.ts';
import { buildLamps, type LampSpot } from './builders/props.ts';

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
  signs?: { group: THREE.Group; dispose: () => void };
  lamps: LampSpot[];
  /** Ground texture size currently shown / last requested from the worker. */
  texShown: number;
  texRequested: number;
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
  private terrainMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private painter = new GroundPainter();
  /** Ground textures painted by the worker, waiting to be uploaded (one per frame). */
  private readyTextures: { st: ChunkState; size: number; tex: THREE.Texture }[] = [];
  /** Uploads a texture to the GPU right away (set by the game; spreads upload cost over frames). */
  uploadTexture?: (t: THREE.Texture) => void;
  private placeholder: THREE.Texture;

  constructor(private world: WorldData, private heights: HeightField, private mats: Materials) {
    // 1x1 meadow-coloured texture so the ground material keeps the same shader while waiting.
    const data = new Uint8Array([111, 143, 74, 255]);
    this.placeholder = new THREE.DataTexture(data, 1, 1);
    this.placeholder.colorSpace = THREE.SRGBColorSpace;
    this.placeholder.needsUpdate = true;
  }

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
          st = { cx, cz, rect: { minX, minZ, maxX: minX + S, maxZ: minZ + S }, loading: false, lod: -1, wantLod: 0, collisionMeshes: [], lamps: [], texShown: 0, texRequested: 0, disposables: [] };
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

    // 2. Apply at most one finished ground texture per frame (GPU upload is the costly part).
    const ready = this.readyTextures.shift();
    if (ready) this.applyTexture(ready.st, ready.size, ready.tex);

    // 3. Build the most urgent chunks within the time budget.
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

  /** Rebuilds all name signs (after switching real/generic names). */
  rebuildSigns() {
    for (const st of this.states.values()) {
      if (!st.group || !st.data || !st.signs) continue;
      st.group.remove(st.signs.group);
      st.signs.dispose();
      st.signs = buildSigns(st.data.data);
      st.group.add(st.signs.group);
    }
  }

  /** Street lamp light positions in all built chunks (for night lighting). */
  lampSpots(): LampSpot[] {
    const out: LampSpot[] = [];
    for (const st of this.states.values()) out.push(...st.lamps);
    return out;
  }

  stats(): ChunkStats {
    const lodCounts = LODS.map(() => 0);
    let loaded = 0, queued = 0;
    for (const s of this.states.values()) {
      if (s.lod >= 0) {
        loaded++;
        lodCounts[s.lod]++;
      }
      if (s.lod !== s.wantLod || s.texShown !== s.texRequested) queued++;
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
      st.signs = buildSigns(data.data);
      st.group.add(st.signs.group);
      const lamps = buildLamps(data.data, st.rect, this.heights, this.mats.props);
      if (lamps.mesh) {
        st.group.add(lamps.mesh);
        st.disposables.push(lamps.mesh);
      }
      st.lamps = lamps.lamps;
      st.trees = new ChunkTrees(data.data.trees, this.heights, this.mats.trees, lod.trees);
      st.group.add(st.trees.group);
      this.root.add(st.group);
    } else {
      st.trees?.setLod(lod.trees);
    }

    // Terrain mesh and ground texture depend on the LOD.
    const prevLod = st.lod >= 0 ? LODS[st.lod] : undefined;
    if (!prevLod || prevLod.stride !== lod.stride) {
      const geo = buildTerrainGeometry(data, minX, minZ, m.heightStep, lod.stride);
      if (st.terrain) {
        st.terrain.geometry.dispose();
        st.terrain.geometry = geo;
      } else {
        const mat = this.mats.makeGround(this.placeholder);
        this.terrainMaterials.set(`${st.cx},${st.cz}`, mat);
        st.terrain = new THREE.Mesh(geo, mat);
        st.terrain.receiveShadow = true;
        st.group.add(st.terrain);
      }
    }
    if (st.texRequested !== lod.tex) {
      // Painted in a worker; applied later by update() so this frame stays short.
      const size = lod.tex;
      st.texRequested = size;
      this.painter.paint(data.data, minX, minZ, m.chunkSize, size).then((tex) => {
        if (this.states.get(`${st.cx},${st.cz}`) !== st || st.texRequested !== size) {
          tex.dispose();
          return;
        }
        this.readyTextures.push({ st, size, tex });
      });
    }
    st.lod = st.wantLod;
  }

  private applyTexture(st: ChunkState, size: number, tex: THREE.Texture) {
    const mat = this.terrainMaterials.get(`${st.cx},${st.cz}`);
    if (!mat || this.states.get(`${st.cx},${st.cz}`) !== st || st.texRequested !== size) {
      tex.dispose();
      return;
    }
    if (mat.map && mat.map !== this.placeholder) mat.map.dispose();
    // Same material features as before, so no shader recompile is needed.
    mat.map = tex;
    st.texShown = size;
    this.uploadTexture?.(tex);
  }

  private unload(key: string, st: ChunkState) {
    this.states.delete(key);
    this.heights.setChunk(st.cx, st.cz, undefined);
    this.world.unloadChunk(st.cx, st.cz);
    if (st.group) this.root.remove(st.group);
    st.terrain?.geometry.dispose();
    const mat = this.terrainMaterials.get(key);
    if (mat) {
      if (mat.map !== this.placeholder) mat.map?.dispose();
      mat.dispose();
      this.terrainMaterials.delete(key);
    }
    st.trees?.dispose();
    st.signs?.dispose();
    for (const d of st.disposables) d.dispose();
  }
}

function dist2(s: ChunkState, v: THREE.Vector3) {
  const x = (s.rect.minX + s.rect.maxX) / 2 - v.x, z = (s.rect.minZ + s.rect.maxZ) / 2 - v.z;
  return x * x + z * z;
}
