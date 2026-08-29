/**
 * Scene contents as pure data. Lives in `shared/` because scenarios are
 * documents the main process stores and the renderer simulates — the runtime
 * `WorldObject` that wraps a spec stays in `sim/`.
 */

export type ObjectKind = 'block' | 'table' | 'marker'

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

export interface SceneDefinition {
  id: string
  name: string
  objects: ObjectSpec[]
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
 * Objects are spread well beyond a single field of view, so finding them is a
 * real part of the task rather than a formality.
 */
export const DEFAULT_SCENE: SceneDefinition = {
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
