/**
 * The robot's capability definition, as a serializable document.
 *
 * Deliberately NOT app settings: v0.3 compares models and prompts on the same
 * task, and a result only means something if the exact configuration that
 * produced it can be named. This document is that configuration.
 */

export interface SkillOverride {
  /** Absent means enabled. */
  enabled?: boolean
  /** Absent means the description defined in code. */
  description?: string
}

/**
 * Sensor parameters. Declared here rather than imported from `sim/` because
 * `shared/` stays free of simulation code; `resolveProfile` merges these over
 * the defaults in `sim/perception.ts`. All optional — absent means the default.
 */
export interface PerceptionSettings {
  /** How far the robot can see, in metres. */
  range?: number
  /** Half the field of view, in degrees either side of the heading. */
  halfAngleDeg?: number
  /** Whether objects can hide behind other objects. */
  occlusion?: boolean
  /**
   * How many metres away a 1-metre feature stays resolvable, so what the robot
   * can see scales with size rather than one flat distance.
   */
  acuity?: number
}

/**
 * How much the robot is told without having to look.
 *
 * - `full` — pose, grip, visible objects and remembered ones. Simulates a
 *   classical perception stack feeding a planner.
 * - `proprioceptive` — pose and grip only, which is what encoders and a gripper
 *   sensor give for free. Objects must be found with `look`, and memory lives in
 *   the model's own context rather than the engine's world model.
 *
 * The second is what a vision-language-action model actually gets, and it is
 * the only one that scales: a text manifest grows with the world, an image does
 * not.
 */
/**
 * `detections` is the middle ground, and the most honest one: a wide sensor
 * reports that something is there, how big it is and where — geometry, which is
 * all a depth sensor or a lidar returns. It cannot tell you a block is red.
 * Identity has to be earned by pointing the camera at the thing and looking,
 * which is exactly the split a real stack has between navigation and
 * recognition.
 */
export type ObservationDetail = 'full' | 'detections' | 'proprioceptive'

export interface RobotProfile {
  id: string
  name: string
  /** Bumped on every save; lets a future scoring run order configurations. */
  revision: number
  /** Absent means the system prompt defined in code. */
  systemPrompt?: string
  /**
   * Sparse, keyed by skill name. An absent key means "code default, enabled",
   * so `{}` is exactly the code defaults and a description improved in code
   * reaches every profile that did not explicitly override it.
   *
   * The code registry — not this map — is the source of truth for which skills
   * exist. Keys naming a removed skill resolve away; skills added in code
   * appear immediately without touching the profile.
   */
  skills: Record<string, SkillOverride>
  maxIterations?: number
  perception?: PerceptionSettings
  /** Absent means `full`, so existing profiles and scenarios are unchanged. */
  observationDetail?: ObservationDetail
}

export const DEFAULT_PROFILE: RobotProfile = {
  id: 'default',
  name: 'Default robot',
  revision: 1,
  skills: {}
}
