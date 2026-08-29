import { z } from 'zod'
import { type Skill, type SkillResult, until } from './types.js'

const schema = z.object({
  metres: z
    .number()
    .min(-10)
    .max(20)
    .describe('How far to walk in the direction you are facing. Negative walks backwards.')
})

/**
 * Egocentric movement, for when the robot has no absolute coordinates — which
 * is the normal case when it is working from photographs.
 */
export const moveForward: Skill<z.infer<typeof schema>> = {
  name: 'move_forward',
  category: 'locomotion',
  description:
    'Walk in a straight line in the direction you are currently facing. Use this when you ' +
    'know how far to go but not the coordinates of where you are going.',
  schema,

  async run(robot, { metres }, ctx): Promise<SkillResult> {
    const start = robot.position
    const target = Math.abs(metres)
    const direction = Math.sign(metres)
    ctx.report(`Walking ${metres}m ${direction < 0 ? 'backwards' : 'forwards'}`)

    let travelled = 0
    const completed = await until(ctx, target / 1.4 + 6, () => {
      travelled = robot.distanceTo(start.x, start.z)
      if (travelled >= target) return true
      robot.setForward(direction)
      return false
    })

    robot.stop()
    const end = robot.position

    return {
      ok: completed,
      observation: completed
        ? `Walked ${travelled.toFixed(2)}m. Now at (${end.x.toFixed(2)}, ${end.z.toFixed(2)}).`
        : `Stopped after ${travelled.toFixed(2)}m of ${target}m — something is in the way. ` +
          `Now at (${end.x.toFixed(2)}, ${end.z.toFixed(2)}).`
    }
  }
}
