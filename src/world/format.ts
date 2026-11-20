// Data format shared by the preprocessing scripts and the game runtime.
//
// World frame (matches three.js): X = east, Y = up, Z = south (i.e. -north), metres,
// origin at ORIGIN in manifest.json. Flat point arrays are [x0, z0, x1, z1, ...].
// Polygon rings are closed implicitly (last vertex != first); rings[0] is the outer
// ring, further rings are holes. Outer rings are counter-clockwise on a north-up map.

export const FORMAT_VERSION = 1;

export interface Manifest {
  version: number;
  name: string;
  generated: string;
  origin: { lat: number; lon: number };
  /** Playable area: [-halfExtent, halfExtent] on both X and Z. */
  halfExtent: number;
  chunkSize: number;
  /** Chunks per side; chunk (cx, cz) covers x in [-half + cx*size, ...), z likewise. */
  chunksPerSide: number;
  /** Heightmap spacing in metres; each chunk heightmap has (chunkSize/heightStep + 1)^2 samples. */
  heightStep: number;
  /**
   * Heightmaps are lossless RGB PNGs holding uint16 values (R = high byte, G = low byte):
   * height = heightBase + uint16 * heightScale (metres above sea level).
   */
  heightBase: number;
  heightScale: number;
  elevation: { min: number; max: number };
  /** Coarse heightmap of the whole area (same PNG encoding), for distant terrain. */
  overview: { file: string; size: number; step: number };
  chunks: ChunkInfo[];
  pois: Poi[];
  attribution: string[];
}

export interface ChunkInfo {
  cx: number;
  cz: number;
  file: string;
  heightFile: string;
  counts: { buildings: number; roads: number; trees: number };
}

export interface Building {
  id: number;
  /** OSM building=* value. */
  kind: string;
  /** Building height (m); estimated when OSM has no height/levels data. */
  h: number;
  /** Height of the bottom above mean ground (m), > 0 for roofs/overhangs. */
  minH: number;
  /** Lowest terrain elevation under the footprint (m a.s.l.); walls start here. */
  ground: number;
  /** Absolute elevation of the roof top (m a.s.l.) = mean footprint elevation + h. */
  top: number;
  /** True if `h` came from OSM height / levels tags rather than an estimate. */
  tagged: boolean;
  roof?: string;
  name?: string;
  rings: number[][];
}

export interface Polyline {
  id: number;
  kind: string;
  /** Width in metres. */
  w: number;
  name?: string;
  bridge?: boolean;
  tunnel?: boolean;
  layer?: number;
  oneway?: boolean;
  pts: number[];
  /** Bridges only: deck elevation (m a.s.l.) for each point. */
  elev?: number[];
}

export interface Area {
  id: number;
  kind: string;
  rings: number[][];
}

export interface Poi {
  id: number;
  kind: string;
  name?: string;
  x: number;
  z: number;
}

/**
 * Polylines are stored in every chunk their (widened) segments overlap, so the same
 * OSM way can appear in several chunks; use `id` to de-duplicate when needed.
 */
export interface ChunkData {
  v: number;
  cx: number;
  cz: number;
  buildings: Building[];
  roads: Polyline[];
  rails: Polyline[];
  waterways: Polyline[];
  water: Area[];
  areas: Area[];
  /** Flat [x, z, height, type, ...]; type 0 = deciduous, 1 = conifer. */
  trees: number[];
  pois: Poi[];
}
