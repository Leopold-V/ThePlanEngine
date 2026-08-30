import type { Robot } from './Robot.js'
import type { WorldModel } from './WorldModel.js'
import type { WorldObject } from './objects.js'
import type { CameraFrame } from './CameraView.js'
import type { PerceptionConfig, Sighting } from './perception.js'
import type { GroundReading } from './terrainSense.js'
import type { ObservationDetail } from '@shared/profile.js'

/**
 * What a skill is allowed to know and do about the world beyond its own body.
 *
 * Deliberately narrow — lookup and the two carry operations, never the Rapier
 * handles behind them. It lives in its own file so a skill can be exercised
 * against a stub without pulling in three.js, the renderer, or a physics world.
 */
export interface WorldView {
  robot: Robot
  objects: WorldObject[]
  model: WorldModel
  /** Objects visible at the last perception tick. */
  sightings: Sighting[]
  /**
   * The shape of the ground in the sensor cone at the last tick — same sensor,
   * same cone, same range as `sightings`. Empty where the ground is level.
   */
  ground: GroundReading[]
  /** Simulation seconds since the world started. */
  now: number
  perception: PerceptionConfig
  /**
   * How much the per-turn observation is allowed to say.
   *
   * A perception skill has to know this. In `proprioceptive` mode the
   * observation lists no objects at all, so the skill's own result is the only
   * channel the model has — reporting just what changed there tells it nothing.
   */
  observationDetail: ObservationDetail
  find(id: string): WorldObject | undefined
  /**
   * Ground height at a point. Navigation probes this a step ahead, which is
   * what feet and an IMU sense; asking about distant ground would be sight.
   */
  groundHeightAt(x: number, z: number): number
  /** Renders the robot's eye view, with visible objects labelled. */
  capture(): CameraFrame | null
  /** Says a line out loud in the world, above the robot's head. */
  say(text: string): void
  grasp(object: WorldObject): void
  /** Releases the held object at a ground position. Returns what was dropped. */
  release(x: number, z: number): WorldObject | null
}
