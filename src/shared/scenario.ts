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
   * The robot's feet end at least this high.
   *
   * Deliberately about height rather than about standing on a named thing: the
   * ground a generated world asks you to climb is terrain, and terrain has no
   * id to refer to.
   */
  | { type: 'robot_above'; height: number }

/**
 * Plain world state for scoring. Lives here rather than beside the evaluator so
 * that `sim/` can produce one without depending on `engine/` — data-only, with
 * no three.js, Rapier, or renderer in sight.
 */
export interface WorldSnapshot {
  robot: {
    x: number
    z: number
    /** Height of the feet above the world's base plane. */
    y: number
    holding: string | null
  }
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
    // Terrain, rather than an object, is the thing to be climbed — which is why
    // this needs a criterion about height and could not be expressed before.
    //
    // Seed 21 peaks at 1.71m with under 2% of the map above 1.5m, so the high
    // ground has to be found rather than stumbled onto. A flood fill confirms
    // 1.73m is reachable from the clearing, and reachable by walking as well as
    // by jumping: there is a way up for a model that looks for one and a
    // shortcut for a model that would rather jump.
    id: 'reach-high-ground',
    name: 'Reach the high ground',
    goal:
      'Get yourself up onto the high ground — at least 1.3 metres above where you are standing ' +
      'now. The landscape rises and falls; some slopes can be walked up and some ledges have to ' +
      'be jumped.',
    scene: {
      id: 'wilds-high',
      name: 'Generated wilds',
      generate: { seed: 21, halfExtent: 24, hilliness: 1, density: 0.8 }
    },
    start: { x: 0, z: 0, headingDeg: 0 },
    criteria: [{ type: 'robot_above', height: 1.3 }]
  },
  {
    // A solid twelve-metre wall with the crate directly behind it. Walking at
    // the crate is refused by steering, so the only way through is to route:
    // pick a waypoint past one end, then come back. That is the replanning loop
    // the app exists to exercise, and it is unsolvable without the wall's
    // footprint appearing in the observation.
    id: 'behind-the-wall',
    name: 'Behind the wall',
    goal:
      'There is a crate on the far side of the wall. Fetch it and bring it back to where you ' +
      'are standing now, then put it down.',
    scene: {
      id: 'walled-off',
      name: 'A wall, and a crate behind it',
      objects: [
        {
          id: 'wall_1',
          kind: 'wall',
          color: 0x9a8f7d,
          size: [12, 2.2, 0.6],
          position: [0, 1.1, 5],
          graspable: false,
          mass: 400,
          fixed: true
        },
        blockSpec('crate_1', BLOCK_COLORS.red, [0, 0.15, 9])
      ]
    },
    start: { x: 0, z: 0, headingDeg: 0 },
    criteria: [
      { type: 'object_near', object: 'crate_1', x: 0, z: 0, within: 3 },
      { type: 'holding', object: null }
    ]
  },
  {
    // The one place a jump is genuinely the only way. A block has vertical
    // sides, so unlike terrain there is no walkable approach to find — the
    // model either jumps or fails.
    id: 'up-on-the-block',
    name: 'Up on the block',
    goal: 'Climb up onto the stone platform and stay standing on top of it.',
    scene: {
      id: 'one-platform',
      name: 'A platform to jump onto',
      objects: [
        {
          id: 'platform',
          kind: 'wall',
          color: 0x9a8f7d,
          size: [2.6, 0.9, 2.6],
          position: [0, 0.45, 5],
          graspable: false,
          mass: 800,
          fixed: true
        }
      ]
    },
    start: { x: 0, z: 0, headingDeg: 0 },
    criteria: [{ type: 'robot_above', height: 0.75 }]
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
