/**
 * Scene contents as pure data. Lives in `shared/` because scenarios are
 * documents the main process stores and the renderer simulates — the runtime
 * `WorldObject` that wraps a spec stays in `sim/`.
 */

import type { TerrainSpec } from './terrain.js'

export type ObjectKind = 'block' | 'table' | 'marker' | 'boulder'

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
 * A world described by the seed that produces it rather than by its contents.
 *
 * The whole point of storing this instead of an object list: a generated
 * landscape is thousands of numbers, and a scenario has to stay a small,
 * readable, reproducible document. Same spec, same world, always — which is
 * what keeps a run record attributable to a world you can regenerate.
 */
export interface WorldGenSpec {
  seed: number
  /** Metres from centre to edge. */
  halfExtent: number
  /** 0 is flat, 1 rolling, 2 dramatic. */
  hilliness: number
  /** Roughly how many props per 100m². */
  density: number
}

/**
 * Scene contents. Either enumerated (`objects`) or generated (`generate`) —
 * never both. `resolveScene` in `worldgen.ts` collapses the two into the same
 * shape, so nothing downstream needs to know which kind it was handed.
 */
export interface SceneDefinition {
  id: string
  name: string
  objects?: ObjectSpec[]
  generate?: WorldGenSpec
  /** Absent means the flat plane every scene written before terrain assumes. */
  terrain?: TerrainSpec
}

const table = (position: [number, number, number]): ObjectSpec => ({
  id: 'table',
  kind: 'table',
  color: 0x8b6b4a,
  size: [1.6, 0.75, 1.0],
  position,
  graspable: false,
  mass: 40,
  fixed: true
})

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
 * The world the app opens in: generated, so there is somewhere to go and
 * something to climb rather than a plane with five things on it.
 *
 * Four numbers, and they rebuild it identically anywhere. Change the seed for a
 * different world.
 */
export const DEFAULT_SCENE: SceneDefinition = {
  id: 'wilds',
  name: 'Generated wilds',
  generate: { seed: 1337, halfExtent: 30, hilliness: 1, density: 1.1 }
}

/**
 * The flat world every scenario written before terrain assumes. Kept because
 * their criteria were tuned against it, and because a level plane is still the
 * right place to test planning without navigation getting in the way.
 */
export const FLAT_SCENE: SceneDefinition = {
  id: 'blocks-and-table',
  name: 'Blocks and a table',
  objects: [
    table([5, 0.375, 1]),
    block('red_block', BLOCK_COLORS.red, [2, 0.15, 3]),
    block('blue_block', BLOCK_COLORS.blue, [-4, 0.15, 2]),
    block('green_block', BLOCK_COLORS.green, [-2, 0.15, -5]),
    {
      id: 'marker_post',
      kind: 'marker',
      color: 0xf5c451,
      size: [0.2, 1.4, 0.2],
      position: [7, 0.7, -6],
      graspable: false,
      mass: 5,
      fixed: true
    }
  ]
}

export { block as blockSpec, table as tableSpec }
