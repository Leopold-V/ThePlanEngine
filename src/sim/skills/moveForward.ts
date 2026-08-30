import { z } from 'zod'
import { obstacleAhead, stalls, type Skill, type SkillResult, until } from './types.js'

const schema = z.object({
  metres: z
    .number()
    .min(-10)
    .max(20)
    .describe('How far to walk in the direction you are facing. Negative walks backwards.')
})

/**
 * Long enough to ride out a stumble on rough ground, short enough that walking
 * into a wall is over in about a second rather than the full timeout.
 *
 * Shorter than `walk_to`'s, which has to cover turning on the spot. This one
 * never turns, so any stretch of not moving is genuinely not moving.
 */
const STALL_SECONDS = 1.5

/**
 * Egocentric movement, for when the robot has no absolute coordinates — which
 * is the normal case when it is working from photographs.
 *
 * Deliberately does not steer: it is the primitive, and its contract is a
 * straight line. Not steering is not the same as not noticing, though — it
 * stops when it stops getting anywhere, rather than leaning on whatever it hit
 * until the timeout expires.
 */
export const moveForward: Skill<z.infer<typeof schema>> = {
  name: 'move_forward',
  category: 'locomotion',
  description:
    'Walk in a straight line in the direction you are currently facing. Use this when you ' +
    'know how far to go but not the coordinates of where you are going. It does not go around ' +
    'anything: it stops where the straight line stops.',
  schema,

  async run(robot, { metres }, ctx): Promise<SkillResult> {
    const start = robot.position
    const target = Math.abs(metres)
    const direction = Math.sign(metres)
    ctx.report(`Walking ${metres}m ${direction < 0 ? 'backwards' : 'forwards'}`)

    const stalled = stalls(STALL_SECONDS)
    let travelled = 0
    let blocked = false

    const completed = await until(ctx, target / 1.4 + 6, () => {
      travelled = robot.distanceTo(start.x, start.z)
      if (travelled >= target) return true
      if (stalled(target - travelled, 1 / 60)) {
        blocked = true
        return true
      }
      robot.setForward(direction)
      return false
    })

    robot.stop()
    const end = robot.position
    const at = `Now at (${end.x.toFixed(2)}, ${end.z.toFixed(2)})`

    if (completed && !blocked) {
      return { ok: true, observation: `Walked ${travelled.toFixed(2)}m. ${at}.` }
    }

    // What stopped it, when the robot can name it. Terrain is not named here:
    // the observation that follows this result carries the shape of the ground
    // already, and saying it twice costs a line on every turn.
    const culprit = obstacleAhead(ctx)
    return {
      ok: false,
      observation: blocked
        ? `Stopped after ${travelled.toFixed(2)}m of ${target}m — stopped making progress. ` +
          `${culprit ? `${culprit}. ` : ''}${at}.`
        : `Timed out after ${travelled.toFixed(2)}m of ${target}m. ${at}.`
    }
  }
}
