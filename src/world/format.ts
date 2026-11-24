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
  /** Blurred orthophoto of the whole area (north-up JPEG), drawn under the ground cover. */
  groundPhoto?: { file: string; size: number; step: number };
  /** Road graphs for traffic and pedestrians (see RoadGraphs). */
  graphFile: string;
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
  /** Purpose from OSM (e.g. "shop:supermarket", "amenity:place_of_worship", "historic:castle"). */
  use?: string;
  /** Sign text: the building's own name or the name of a shop/amenity inside it. */
  label?: string;
  /** Facade / roof colours from OSM (`building:colour`, `roof:colour`) as CSS colours. */
  colour?: string;
  roofColour?: string;
  /** Roof colour measured on the ČÚZK orthophoto. */
  roofPhoto?: string;
  levels?: number;
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
  /** Paved surface other than asphalt (sett, cobblestone, paving_stones). */
  surface?: string;
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
  /** Sub-type, e.g. the shop=* value. */
  sub?: string;
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
  /** Hand-placed road markings from world/scenes.ts: flat [x, z, yaw, kind, ...] (see MarkKind). */
  marks?: number[];
  /** Free-standing sign pylons from world/scenes.ts. */
  pylons?: Pylon[];
}

/** Painted ground markings: arrows (pointing along yaw) and dashes of an aisle centre line. */
export const MarkKind = { arrow: 0, arrowRight: 1, arrowLeft: 2, dash: 3 } as const;

/** Tall free-standing shop sign (totem) next to a car park. */
export interface Pylon {
  x: number;
  z: number;
  /** Direction the sign face looks (rad, 0 = +z). */
  yaw: number;
  /** Real name and the neutral one used when real names are off. */
  text: string;
  generic: string;
  /** Total height and the board size (m). */
  height: number;
  board: number;
  /** Pole/frame colour. */
  frame?: string;
  /** Smaller tenant panels stacked under the main board: [real, generic] names. */
  tenants?: [string, string][];
}

/** Edge between two junctions. `pts` is flat [x, y, z, ...] including both end nodes. */
export interface GraphEdge {
  a: number;
  b: number;
  kind: string;
  /** Length in metres. */
  len: number;
  pts: number[];
  /** Drive graph: traffic may only go a -> b (or b -> a when `reverse`). */
  oneway?: boolean;
  reverse?: boolean;
  lanes: number;
  /** Speed limit in m/s (drive graph), 0 for the walk graph. */
  speed: number;
}

/** Junction positions as flat [x, y, z, ...] plus edges. */
export interface RoadGraph {
  nodes: number[];
  edges: GraphEdge[];
}

export interface RoadGraphs {
  drive: RoadGraph;
  walk: RoadGraph;
}
