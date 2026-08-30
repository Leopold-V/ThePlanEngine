import type { SceneDefinition } from './scene.js'

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

// The built-in tasks live in `scenarios.ts`, re-exported here so every existing
// import keeps working. They are a body of content, not part of the contract.
export { BUILT_IN_SCENARIOS } from './scenarios.js'
