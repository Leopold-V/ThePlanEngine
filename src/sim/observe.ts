import type { Robot } from './Robot.js'

export interface Observation {
  x: number
  z: number
  heading: number
}

export function observe(robot: Robot): Observation {
  const p = robot.position
  return {
    x: Number(p.x.toFixed(2)),
    z: Number(p.z.toFixed(2)),
    heading: Number(robot.headingDegrees.toFixed(0))
  }
}

/**
 * The robot's entire sensory input. Kept as one short line because it is resent
 * on every turn of the agent loop — verbosity here is paid for repeatedly.
 */
export function describe(robot: Robot): string {
  const o = observe(robot)
  return `Robot is at (${o.x}, ${o.z}) facing ${o.heading}°.`
}
