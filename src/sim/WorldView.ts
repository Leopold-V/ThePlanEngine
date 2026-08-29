import type { Robot } from './Robot.js'
import type { WorldModel } from './WorldModel.js'
import type { WorldObject } from './objects.js'
import type { PerceptionConfig, Sighting } from './perception.js'

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
  /** Simulation seconds since the world started. */
  now: number
  perception: PerceptionConfig
  find(id: string): WorldObject | undefined
  grasp(object: WorldObject): void
  /** Releases the held object at a ground position. Returns what was dropped. */
  release(x: number, z: number): WorldObject | null
}
