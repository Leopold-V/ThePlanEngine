import { z } from 'zod'
import { shortestAngle } from '../steering.js'
import { type Skill, type SkillResult, until } from './types.js'

const schema = z.object({})

const FULL_CIRCLE = Math.PI * 2
/** Generous against the ~2.3s a revolution takes, including the ramp up. */
const SWEEP_TIMEOUT = 8
/** Close enough to the original heading to stop correcting. */
const SETTLED = 0.02
/** Moved further than this from where it was remembered, and it is news. */
const MOVED = 0.5

export const scan: Skill<z.infer<typeof schema>> = {
  name: 'scan',
  category: 'perception',
  description:
    'Turn a full circle on the spot and report what is new or has moved since you last looked. ' +
    'You can only see what is in front of you, so use this when something you need is ' +
    'unaccounted for. Scanning again with nothing changed will tell you nothing new.',
  schema,

  async run(robot, _params, ctx): Promise<SkillResult> {
    ctx.report('Scanning surroundings')

    // Where things were believed to be before the sweep. Snapshotted by value,
    // because perception rewrites the belief map as the robot turns.
    const before = new Map<string, { x: number; z: number }>()
    for (const belief of ctx.world.model.all()) {
      before.set(belief.id, { x: belief.x, z: belief.z })
    }

    const start = robot.heading
    const seen = new Map<string, { x: number; z: number }>()

    // Turned by angle covered, not by elapsed time. Four seconds at the robot's
    // turn rate is two revolutions, not the one the name promises.
    let turned = 0
    let previous = robot.heading

    await until(ctx, SWEEP_TIMEOUT, () => {
      turned += Math.abs(shortestAngle(previous, robot.heading))
      previous = robot.heading
      if (turned >= FULL_CIRCLE) return true

      robot.setTurn(1)
      // Perception ticks on its own; sweeping just puts everything through the
      // field of view in turn, and we collect what shows up.
      for (const sighting of ctx.world.sightings) {
        seen.set(sighting.id, { x: sighting.position.x, z: sighting.position.z })
      }
      return false
    })

    // Deceleration carries it slightly past a full turn. Correct by turning,
    // not by assignment: setting `heading` teleports the body, which is both
    // impossible and visibly jarring now that a camera is pointed at it.
    await until(ctx, 2, () => {
      const remaining = shortestAngle(robot.heading, start)
      if (Math.abs(remaining) < SETTLED) return true
      robot.setTurn(Math.max(-1, Math.min(1, remaining * 3)))
      return false
    })
    robot.stop()

    if (seen.size === 0) {
      return { ok: true, observation: 'Scanned a full circle. Nothing in range.' }
    }

    const found: string[] = []
    const moved: string[] = []
    let confirmed = 0

    for (const [id, now] of seen) {
      const remembered = before.get(id)
      if (!remembered) {
        found.push(`${id} at (${now.x.toFixed(2)}, ${now.z.toFixed(2)})`)
      } else if (Math.hypot(now.x - remembered.x, now.z - remembered.z) > MOVED) {
        moved.push(
          `${id} has moved to (${now.x.toFixed(2)}, ${now.z.toFixed(2)}) from ` +
            `(${remembered.x.toFixed(2)}, ${remembered.z.toFixed(2)})`
        )
      } else {
        confirmed++
      }
    }

    // Only what changed. A scan that repeats a scan should say so plainly —
    // that is what makes a redundant one visibly worthless.
    const parts: string[] = []
    if (found.length > 0) parts.push(`Found: ${found.join('; ')}.`)
    if (moved.length > 0) parts.push(`${moved.join('; ')}.`)
    if (parts.length === 0) {
      return {
        ok: true,
        observation:
          `Scanned a full circle. Nothing new — all ${confirmed} object` +
          `${confirmed === 1 ? ' is' : 's are'} where you already remembered.`
      }
    }
    if (confirmed > 0) {
      parts.push(`${confirmed} other${confirmed === 1 ? '' : 's'} unchanged.`)
    }

    return { ok: true, observation: `Scanned a full circle. ${parts.join(' ')}` }
  }
}
