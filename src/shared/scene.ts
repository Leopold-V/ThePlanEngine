/**
 * Scene contents as pure data. Lives in `shared/` because scenarios are
 * documents the main process stores and the renderer simulates — the runtime
 * `WorldObject` that wraps a spec stays in `sim/`.
 */

import { DEFAULT_VOXEL, type VoxelSpec } from './voxel.js'

export type ObjectKind = 'block' | 'table' | 'marker' | 'boulder' | 'wall' | 'pillar' | 'tree'

export interface ObjectSpec {
  /** The handle the model uses. Keep it readable: `red_block`, not `obj_7`. */
  id: string
  kind: ObjectKind
  color: number
  /** Full extents in metres. */
  size: [number, number, number]
  /** Centre position at spawn. */
  position: [number, number, number]
  graspable: boolean
  mass: number
  /**
   * Fixed in place. Furniture should not slide when the robot brushes past it —
   * a drifting table is unrealistic and, worse, a moving reference point in a
   * benchmark.
   */
  fixed?: boolean
}

/**
 * A scene: a volume of blocks, and the props standing on it.
 *
 * `voxel` is required rather than optional, so "a scene always has ground" is
 * true by construction. It is also a seed and a handful of numbers, which is
 * what keeps a scenario a small reproducible document while describing a whole
 * landscape — the same spec rebuilds the identical world anywhere.
 */
export interface SceneDefinition {
  id: string
  name: string
  objects?: ObjectSpec[]
  voxel: VoxelSpec
}

const block = (
  id: string,
  color: number,
  position: [number, number, number]
): ObjectSpec => ({
  id,
  kind: 'block',
  color,
  size: [0.3, 0.3, 0.3],
  position,
  graspable: true,
  mass: 1
})

export const BLOCK_COLORS = { red: 0xe0524d, blue: 0x4c7dff, green: 0x38d39f } as const

/**
 * The world the app opens in.
 *
 * The seed is rolled fresh each launch, so the sandbox is somewhere new every
 * time — which is the whole point of generating it. Scenarios do the opposite
 * and pin their seeds, because a task whose world changes underneath it cannot
 * be compared between runs.
 */
export const DEFAULT_SCENE: SceneDefinition = {
  id: 'sector',
  name: 'Generated sector',
  voxel: { ...DEFAULT_VOXEL, seed: Math.floor(Math.random() * 1e9) }
}

export { block as blockSpec }

// ---------------------------------------------------------------------------
// The sector: props for scenarios set in the voxel world
// ---------------------------------------------------------------------------

/**
 * A flat plain of blocks — the voxel equivalent of the old empty plane.
 *
 * Scenarios that test planning rather than navigation want ground that does
 * not interfere. Zero relief gives exactly that, and keeps every scene on one
 * representation instead of two.
 */
export const FLAT_VOXEL: VoxelSpec = {
  ...DEFAULT_VOXEL,
  seed: 1,
  relief: 0,
  seaDepth: 0,
  caves: false,
  clearingRadius: 0
}

/** Colour-coded so a task can name one crate among several. */
export const CRATE_COLORS = { amber: 0xd08a2e, cyan: 0x2fb6c0, magenta: 0xc0417f } as const

/** Cargo, and the only thing in the sector worth carrying. */
export const crateSpec = (
  id: string,
  color: number,
  at: [number, number]
): ObjectSpec => ({
  id,
  kind: 'block',
  color,
  size: [0.4, 0.4, 0.4],
  position: [at[0], 0.2, at[1]],
  graspable: true,
  mass: 1
})

/** A loading platform. Waist height, so a crate has to be lifted onto it. */
export const platformSpec = (id: string, at: [number, number]): ObjectSpec => ({
  id,
  kind: 'table',
  color: 0x5a6472,
  size: [1.6, 0.75, 1.0],
  position: [at[0], 0.375, at[1]],
  graspable: false,
  mass: 40,
  fixed: true
})

/** Emissive marker. Tall and lit, so it reads through the haze at distance. */
export const beaconSpec = (id: string, at: [number, number], height = 2.2): ObjectSpec => ({
  id,
  kind: 'marker',
  color: 0x2ff0e0,
  size: [0.25, height, 0.25],
  position: [at[0], height / 2, at[1]],
  graspable: false,
  mass: 5,
  fixed: true
})

/** A run of barrier. Taller than the robot, so it is routed around, not over. */
export const barrierSpec = (
  id: string,
  at: [number, number],
  size: [number, number, number]
): ObjectSpec => ({
  id,
  kind: 'wall',
  color: 0x6c7480,
  size,
  position: [at[0], size[1] / 2, at[1]],
  graspable: false,
  mass: 400,
  fixed: true
})

/** A block of structure to climb onto. Vertical sides: no way up but a jump. */
export const gantrySpec = (
  id: string,
  at: [number, number],
  height = 0.9
): ObjectSpec => ({
  id,
  kind: 'wall',
  color: 0x7d848c,
  size: [2.6, height, 2.6],
  position: [at[0], height / 2, at[1]],
  graspable: false,
  mass: 800,
  fixed: true
})
