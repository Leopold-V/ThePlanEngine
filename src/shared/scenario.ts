import { BLOCK_COLORS, blockSpec, tableSpec, type SceneDefinition } from './scene.js'

/**
 * Success conditions as data predicates, checked against world state when a run
 * ends.
 *
 * Deliberately a small vocabulary rather than arbitrary code or an LLM judge: a
 * benchmark number has to be deterministic, free to compute, and reproducible
 * from the document alone. The vocabulary grows one entry at a time.
 */
export type Criterion =
  | { type: 'object_on'; object: string; surface: string }
  | { type: 'object_near'; object: string; x: number; z: number; within: number }
  | { type: 'robot_near'; x: number; z: number; within: number }
  | { type: 'holding'; object: string | null }
  | { type: 'object_upright'; object: string }

/**
 * Plain world state for scoring. Lives here rather than beside the evaluator so
 * that `sim/` can produce one without depending on `engine/` — data-only, with
 * no three.js, Rapier, or renderer in sight.
 */
export interface WorldSnapshot {
  robot: { x: number; z: number; holding: string | null }
  objects: ObjectSnapshot[]
}

export interface ObjectSnapshot {
  id: string
  x: number
  y: number
  z: number
  size: [number, number, number]
  /** The body's local up axis in world space, for detecting a toppled object. */
  up: { x: number; y: number; z: number }
}

export interface CriterionResult {
  /** Human-readable restatement of the predicate. */
  label: string
  passed: boolean
  /** What was actually observed. A bare boolean cannot be diagnosed. */
  detail: string
}

export interface Scenario {
  id: string
  name: string
  /** Handed to the model verbatim as the instruction. */
  goal: string
  scene: SceneDefinition
  start: { x: number; z: number; headingDeg: number }
  criteria: Criterion[]
}

export interface RunRecord {
  id: string
  /** ISO timestamp. */
  at: string
  scenarioId: string
  scenarioName: string
  /** Which robot configuration produced this — see `engine/resolveProfile`. */
  configFingerprint: string
  providerId: string
  model: string
  passed: boolean
  criteria: CriterionResult[]
  /** Model round trips the task took. */
  steps: number
  durationMs: number
  transcript: { kind: string; text: string }[]
  error?: string
}

// ---------------------------------------------------------------------------
// Built-in scenarios
// ---------------------------------------------------------------------------

const TABLE_AT: [number, number, number] = [5, 0.375, 1]

export const BUILT_IN_SCENARIOS: Scenario[] = [
  {
    id: 'block-on-table',
    name: 'Block on table',
    goal: 'Put the red block on the table.',
    scene: {
      id: 'block-on-table',
      name: 'One block, one table',
      objects: [tableSpec(TABLE_AT), blockSpec('red_block', BLOCK_COLORS.red, [2, 0.15, 3])]
    },
    start: { x: 0, z: 0, headingDeg: 0 },
    criteria: [
      { type: 'object_on', object: 'red_block', surface: 'table' },
      { type: 'holding', object: null }
    ]
  },
  {
    // The blue block starts behind the robot and outside its field of view, so
    // this cannot be solved without looking around first.
    id: 'fetch-out-of-view',
    name: 'Fetch what you cannot see',
    goal: 'Find the blue block and put it on the table.',
    scene: {
      id: 'fetch-out-of-view',
      name: 'Block behind you',
      objects: [
        tableSpec(TABLE_AT),
        blockSpec('blue_block', BLOCK_COLORS.blue, [-3, 0.15, -4]),
        blockSpec('green_block', BLOCK_COLORS.green, [1, 0.15, 6])
      ]
    },
    start: { x: 0, z: 0, headingDeg: 0 },
    criteria: [
      { type: 'object_on', object: 'blue_block', surface: 'table' },
      { type: 'holding', object: null }
    ]
  },
  {
    id: 'tidy-two-blocks',
    name: 'Tidy up two blocks',
    goal: 'Put both the red block and the blue block on the table, and leave the marker post standing.',
    scene: {
      id: 'tidy-two-blocks',
      name: 'Two blocks and a marker',
      objects: [
        tableSpec(TABLE_AT),
        blockSpec('red_block', BLOCK_COLORS.red, [2, 0.15, 3]),
        blockSpec('blue_block', BLOCK_COLORS.blue, [-4, 0.15, 2]),
        {
          id: 'marker_post',
          kind: 'marker',
          color: 0xf5c451,
          size: [0.2, 1.4, 0.2],
          position: [3, 0.7, -3],
          graspable: false,
          mass: 5,
          fixed: true
        }
      ]
    },
    start: { x: 0, z: 0, headingDeg: 0 },
    criteria: [
      { type: 'object_on', object: 'red_block', surface: 'table' },
      { type: 'object_on', object: 'blue_block', surface: 'table' },
      { type: 'object_upright', object: 'marker_post' },
      { type: 'holding', object: null }
    ]
  },
  {
    // The first scenario set in a generated world. The scene is four numbers
    // rather than a list of objects, and they rebuild the same landscape —
    // same hills, same crate in the same place — on any machine, which is what
    // keeps the result comparable.
    id: 'fetch-from-the-wilds',
    name: 'Fetch from the wilds',
    goal:
      'Somewhere out in the landscape there is a crate called crate_1. Find it, carry it back ' +
      'to the clearing at the centre of the world, and put it down there.',
    scene: {
      id: 'wilds-fetch',
      name: 'Generated wilds',
      generate: { seed: 4242, halfExtent: 26, hilliness: 1, density: 0.9 }
    },
    start: { x: 0, z: 0, headingDeg: 0 },
    criteria: [
      { type: 'object_near', object: 'crate_1', x: 0, z: 0, within: 4 },
      { type: 'holding', object: null }
    ]
  }
]
