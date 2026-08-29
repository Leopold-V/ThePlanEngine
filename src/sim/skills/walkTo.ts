import { z } from 'zod'
import { shortestAngle, steerToward, surroundingsFrom } from '../steering.js'
import { obstacleAhead, stalls, type Skill, type SkillResult, until } from './types.js'

const ARRIVAL_RADIUS = 0.25
/** Walk at reduced speed until roughly facing the target, so turns look natural. */
const ALIGNED = 0.6
/** Long enough to cover a turn on the spot, short enough to feel responsive. */
const STALL_SECONDS = 2.5

const schema = z.object({
  x: z.number().min(-40).max(40).describe('Target X coordinate in metres.'),
  z: z.number().min(-40).max(40).describe('Target Z coordinate in metres.')
})

export const walkTo: Skill<z.infer<typeof schema>> = {
  name: 'walk_to',
  category: 'locomotion',
  description:
    'Walk the robot to a point on the ground, in a straight line. X runs east-west and Z runs ' +
    'north-south, both in metres from the centre of the world. The ground is not flat: you walk ' +
    'up and over whatever lies between you and the target, and a steep slope or an obstacle can ' +
    'stop you short. Arrives within 0.25m, so to reach an object aim beside it rather than at it.',
  schema,

  async run(robot, { x, z }, ctx): Promise<SkillResult> {
    const startDistance = robot.distanceTo(x, z)
    // Slower than flat-ground pace, because the route may climb.
    const budget = startDistance / 1.1 + 6

    ctx.report(`Walking to (${x}, ${z}) — ${startDistance.toFixed(1)}m away`)

    const stalled = stalls(STALL_SECONDS)
    const around = surroundingsFrom(ctx.world)
    const wentRound = new Set<string>()
    let blocked = false

    const arrived = await until(ctx, budget, () => {
      const remaining = robot.distanceTo(x, z)
      if (remaining <= ARRIVAL_RADIUS) return true
      if (stalled(remaining, 1 / 60)) {
        blocked = true
        return true
      }

      const steer = steerToward(robot, x, z, around)
      if (steer.avoiding) wentRound.add(steer.avoiding)

      const angle = shortestAngle(robot.heading, steer.heading)
      robot.setTurn(Math.max(-1, Math.min(1, angle * 2)))
      robot.setForward(Math.abs(angle) < ALIGNED ? steer.forward : 0.25)
      return false
    })

    robot.stop()
    const final = robot.position
    const at = `Now at (${final.x.toFixed(2)}, ${final.z.toFixed(2)})`

    if (arrived && !blocked) {
      // Naming the detour is worth the words: it tells the model where the
      // world is cluttered without it having to look.
      const detour =
        wentRound.size > 0 ? ` Went around ${[...wentRound].sort().join(', ')} on the way.` : ''
      return {
        ok: true,
        observation: `Arrived at (${final.x.toFixed(2)}, ${final.z.toFixed(2)}).${detour}`
      }
    }

    const remaining = robot.distanceTo(x, z).toFixed(2)
    if (blocked) {
      const culprit = obstacleAhead(ctx)
      return {
        ok: false,
        observation:
          `Blocked ${remaining}m short of the target — stopped making progress. ` +
          `${culprit ? `${culprit}. ` : 'Nothing is visible ahead, so it may be a steep slope. '}` +
          `${at}. Try going round it.`
      }
    }

    return {
      ok: false,
      observation: `Timed out after ${budget.toFixed(0)}s still ${remaining}m from the target. ${at}.`
    }
  }
}
