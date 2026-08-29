import type { Robot } from './Robot.js'
import type { WorldModel } from './WorldModel.js'
import { footprintRadius, type Sighting } from './perception.js'

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
export function describe(
  robot: Robot,
  model?: WorldModel,
  sightings?: Sighting[],
  now = 0,
  /** `full` mode names everything sensed; the others only what a camera saw. */
  nameEverything = true
): string {
  const o = observe(robot)
  // Height above the world's base plane. On terrain this is how the robot knows
  // whether it is on high or low ground, which nothing else in the report says.
  const elevation =
    Math.abs(robot.position.y) > 0.1 ? `, at height ${robot.position.y.toFixed(2)}m` : ''
  // Only when it is off centre. The sensors are in the head, so a turned neck
  // changes what "visible" means and the planner has to know about it.
  const neck = Math.abs(robot.gazeYaw) > 0.05 ? `, head turned ${describeNeck(robot.gazeYaw)}` : ''
  const lines = [
    `Robot at (${o.x}, ${o.z}) facing ${o.heading}°${elevation}${neck}. ` +
      `Holding: ${o.holding ?? 'nothing'}.`
  ]

  if (!model) return lines[0] as string

  const visible = sightings ?? []
  // Named by whatever the model is entitled to call it. A thing that has been
  // detected but never looked at answers to an anonymous handle, and its size
  // is given instead of its identity — that is genuinely all the robot has.
  const byId = new Map(model.all().map((b) => [b.id, b]))
  lines.push(
    visible.length > 0
      ? `Visible: ${visible
          .map((s) => describeSighting(s, nameEverything ? undefined : byId.get(s.id)))
          .join('; ')}.`
      : 'Visible: nothing in view.'
  )

  const remembered = model.all().filter((b) => !b.visible)
  if (remembered.length > 0) {
    lines.push(
      `Remembered: ${remembered
        .map((b) => {
          const anonymous = !nameEverything && !b.identified
          return (
            `${anonymous ? b.label : b.id}` +
            `${anonymous ? ` (${size(footprintRadius(b))} across, not identified)` : ''}` +
            ` at (${round(b.x)}, ${round(b.z)}), last seen ${Math.round(now - b.lastSeenAt)}s ago`
          )
        })
        .join('; ')}.`
    )
  }

  return lines.join('\n')
}

function size(radius: number): string {
  return `${(radius * 2).toFixed(1)}m`
}

function describeSighting(s: Sighting, belief?: { label: string; identified: boolean }): string {
  // Only when it matters: on level ground this would be noise on every line,
  // and the observation is resent every turn.
  const height =
    Math.abs(s.elevation) >= 0.4
      ? `, ${Math.abs(s.elevation).toFixed(1)}m ${s.elevation > 0 ? 'above' : 'below'} you`
      : ''
  const name = belief?.label ?? s.id
  const unknown =
    belief && !belief.identified ? ` (${size(footprintRadius(s))} across, not identified)` : ''
  return (
    `${name}${unknown} at (${round(s.position.x)}, ${round(s.position.z)}) — ` +
    `${s.distance.toFixed(1)}m ${bearingWords(s.bearingDeg)}${height}`
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

function describeNeck(radians: number): string {
  const degrees = Math.round((radians * 180) / Math.PI)
  return `${Math.abs(degrees)}° to the ${degrees < 0 ? 'left' : 'right'}`
}

function round(n: number): number {
  return Number(n.toFixed(2))
}
