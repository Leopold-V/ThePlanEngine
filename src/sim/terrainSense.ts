import type { Robot } from './Robot.js'
import type { PerceptionConfig } from './perception.js'

/**
 * The shape of the ground in front of the robot.
 *
 * Perception used to walk the object list and nothing else, which made sense
 * when the world was objects standing on an infinite flat plane. Since the
 * world became a volume of blocks it has been the largest thing the robot
 * cannot see: it would stand in a pit, facing a wall of earth two metres high,
 * and report `Visible: nothing in view` — then discover the pit only by failing
 * to walk out of it. A model cannot diagnose what it is never told.
 *
 * This is sight, not proprioception, and it is bound by the same sensor cone as
 * everything else: readings exist only within `range` and inside `halfAngleDeg`
 * of where the head is pointed, so looking somewhere else is still how you find
 * out what is there. Steering keeps its own probe a single stride ahead,
 * because steering has to work in the dark; this is the other channel.
 *
 * Readings are geometry and nothing more — a distance and a height. Whether a
 * 1.4m step is an obstacle or a staircase depends on limits the model has been
 * given, and drawing that conclusion is its job.
 */

export interface GroundReading {
  /** Degrees from where the head is pointed. Negative left, positive right. */
  bearingDeg: number
  /** Metres to the feature. */
  distance: number
  /** Metres the ground there stands above (+) or below (-) the robot's feet. */
  rise: number
}

/**
 * A rise the robot can simply step onto is not worth a reading.
 *
 * Its step is 0.55m, so anything under this is ground it walks up without
 * noticing. Reporting those would put a line on every observation in rolling
 * terrain and bury the one that matters.
 */
const NOTABLE_RISE = 0.6
/** Drops are only news when they are real; the ground dips constantly. */
const NOTABLE_DROP = -1
/** One block. Sampling finer than this reads the same column twice. */
const SAMPLE_STEP = 0.5
/** Rays across the cone. Five collapse to at most three clauses of text. */
const RAYS = 5

/**
 * Walks outward along a fan of bearings and reports the first notable change in
 * ground height along each.
 *
 * First, not worst: what is behind a wall of earth is not visible over it, and
 * stopping at the first feature is what makes that true without a raycast.
 */
export function senseGround(
  robot: Robot,
  groundHeightAt: (x: number, z: number) => number,
  config: PerceptionConfig
): GroundReading[] {
  const from = robot.position
  const feet = from.y
  const readings: GroundReading[] = []

  for (let i = 0; i < RAYS; i++) {
    // Spread across the full cone, ends included, so the edges are sampled.
    const bearingDeg = -config.halfAngleDeg + (i * (config.halfAngleDeg * 2)) / (RAYS - 1)
    const heading = robot.sensorHeading + (bearingDeg * Math.PI) / 180
    const dx = Math.sin(heading)
    const dz = Math.cos(heading)

    for (let d = SAMPLE_STEP; d <= config.range; d += SAMPLE_STEP) {
      const rise = groundHeightAt(from.x + dx * d, from.z + dz * d) - feet
      if (rise >= NOTABLE_RISE || rise <= NOTABLE_DROP) {
        readings.push({ bearingDeg, distance: d, rise })
        break
      }
    }
  }

  return readings
}
