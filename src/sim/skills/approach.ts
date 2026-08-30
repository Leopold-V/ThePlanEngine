import { z } from 'zod'
import { Robot } from '../Robot.js'
import { shortestAngle, steerToward, surroundingsFrom } from '../steering.js'
import {
  knownLabels,
  obstacleAhead,
  resolveTarget,
  stalls,
  type Skill,
  type SkillResult,
  until
} from './types.js'

const schema = z.object({
  object: z
    .string()
    .min(1)
    .describe(
      'What to walk up to: an object id if you know it, or the handle of something you have ' +
        'only detected, such as "unknown_2".'
    )
})

/** Stop this far short, so the object ends up within reach rather than underfoot. */
const STANDOFF = 0.9

export const approach: Skill<z.infer<typeof schema>> = {
  name: 'approach',
  category: 'locomotion',
  description:
    'Walk to an object and stop within reach of it, naming it by id rather than by ' +
    'coordinates. Use this after seeing something in a photo. It uses the last known ' +
    'position, so if the object may have moved, look again first.',
  schema,

  check(_robot, { object: id }, world): string | null {
    if (world.model.knows(id) || world.find(id)) return null
    const known = knownLabels(world)
    return known.length > 0
      ? `Never seen "${id}". Known so far: ${known.join(', ')}.`
      : `Never seen "${id}", and nothing has been seen yet.`
  },

  async run(robot, { object: id }, ctx): Promise<SkillResult> {
    // The belief, not the truth — the robot walks to where it thinks the thing
    // is, and finds out on arrival whether it was right.
    const { id: realId, belief, object } = resolveTarget(ctx.world, id)
    const target = belief ?? object?.position
    if (!target) return { ok: false, observation: `Never seen "${id}".` }

    const tx = 'x' in target ? target.x : 0
    const tz = 'z' in target ? target.z : 0

    ctx.report(`Approaching ${id}`)
    const budget = robot.distanceTo(tx, tz) / 1.4 + 8

    const stalled = stalls(2.5)
    // The thing being approached must not repel the robot away from itself.
    const around = surroundingsFrom(ctx.world, realId)
    let blocked = false

    const arrived = await until(ctx, budget, () => {
      const remaining = robot.distanceTo(tx, tz)
      if (remaining <= STANDOFF) return true
      if (stalled(remaining, 1 / 60)) {
        blocked = true
        return true
      }

      const steer = steerToward(robot, tx, tz, around)
      const angle = shortestAngle(robot.heading, steer.heading)
      robot.setTurn(Math.max(-1, Math.min(1, angle * 2)))
      robot.setForward(Math.abs(angle) < 0.6 ? steer.forward : 0.25)
      return false
    })

    robot.stop()

    // Where it actually is now, which may differ from where the robot believed.
    const actual = ctx.world.find(realId)?.position
    const distance = actual ? robot.distanceTo(actual.x, actual.z) : Infinity

    if (blocked) {
      const culprit = obstacleAhead(ctx)
      return {
        ok: false,
        observation:
          `Stopped making progress toward ${id}, still ${distance.toFixed(2)}m from it. ` +
          `${culprit ? `${culprit}.` : 'Nothing is visible ahead.'}`
      }
    }

    if (!arrived) {
      return {
        ok: false,
        observation: `Could not reach ${id}; something is in the way. Now ${distance.toFixed(2)}m from it.`
      }
    }

    return {
      ok: true,
      observation:
        distance <= Robot.REACH
          ? `Standing ${distance.toFixed(2)}m from ${id}, within reach.`
          : `Arrived where ${id} was last seen, but it is now ${distance.toFixed(2)}m away.`
    }
  }
}
