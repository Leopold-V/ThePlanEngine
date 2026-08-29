import type { Robot } from './Robot.js'
import type { WorldModel } from './WorldModel.js'
import type { Sighting } from './perception.js'

export interface Observation {
  x: number
  z: number
  heading: number
  holding: string | null
}

export function observe(robot: Robot): Observation {
  const p = robot.position
  return {
    x: round(p.x),
    z: round(p.z),
    heading: Number(robot.headingDegrees.toFixed(0)),
    holding: robot.held?.spec.id ?? null
  }
}

/**
 * The robot's entire sensory report. Resent on every turn of the agent loop, so
 * verbosity here is paid for repeatedly — keep it dense.
 *
 * Visible objects get egocentric distance and bearing as well as world
 * coordinates: a robot senses relative and maps absolute, so the planner gets
 * both. Remembered objects carry their age, because the belief may be stale —
 * nothing corrects it while the object is out of view.
 */
export function describe(robot: Robot, model?: WorldModel, sightings?: Sighting[], now = 0): string {
  const o = observe(robot)
  const lines = [
    `Robot at (${o.x}, ${o.z}) facing ${o.heading}°. Holding: ${o.holding ?? 'nothing'}.`
  ]

  if (!model) return lines[0] as string

  const visible = sightings ?? []
  lines.push(
    visible.length > 0
      ? `Visible: ${visible.map((s) => describeSighting(s)).join('; ')}.`
      : 'Visible: nothing in view.'
  )

  const remembered = model.all().filter((b) => !b.visible)
  if (remembered.length > 0) {
    lines.push(
      `Remembered: ${remembered
        .map((b) => `${b.id} at (${round(b.x)}, ${round(b.z)}), last seen ${Math.round(now - b.lastSeenAt)}s ago`)
        .join('; ')}.`
    )
  }

  return lines.join('\n')
}

function describeSighting(s: Sighting): string {
  return (
    `${s.id} at (${round(s.position.x)}, ${round(s.position.z)}) — ` +
    `${s.distance.toFixed(1)}m ${bearingWords(s.bearingDeg)}`
  )
}

/** Plain-language bearing. Models reason about "ahead-left" far better than "-38°". */
function bearingWords(deg: number): string {
  const side = deg < 0 ? 'left' : 'right'
  const magnitude = Math.abs(deg)
  if (magnitude < 8) return 'straight ahead'
  if (magnitude < 35) return `slightly ${side}`
  return `to the ${side}`
}

function round(n: number): number {
  return Number(n.toFixed(2))
}
