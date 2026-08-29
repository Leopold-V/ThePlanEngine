import { z } from 'zod'
import { type Skill, type SkillResult, until } from './types.js'

const ARRIVAL_RADIUS = 0.35
/** Walk at reduced speed until roughly facing the target, so turns look natural. */
const ALIGNED = 0.6

const schema = z.object({
  x: z.number().min(-24).max(24).describe('Target X coordinate in metres.'),
  z: z.number().min(-24).max(24).describe('Target Z coordinate in metres.')
})

export const walkTo: Skill<z.infer<typeof schema>> = {
  name: 'walk_to',
  description:
    'Walk the robot to a point on the ground. The world is a flat 50x50m grid centred on (0,0); ' +
    'X runs east-west, Z runs north-south. Arrives within 0.35m of the target.',
  schema,

  async run(robot, { x, z }, ctx): Promise<SkillResult> {
    const startDistance = robot.distanceTo(x, z)
    const budget = startDistance / 1.4 + 6

    ctx.report(`Walking to (${x}, ${z}) — ${startDistance.toFixed(1)}m away`)

    const arrived = await until(ctx, budget, () => {
      const remaining = robot.distanceTo(x, z)
      if (remaining <= ARRIVAL_RADIUS) return true
      const angle = robot.angleTo(x, z)
      robot.setTurn(Math.max(-1, Math.min(1, angle * 2)))
      robot.setForward(Math.abs(angle) < ALIGNED ? 1 : 0.25)
      return false
    })

    robot.stop()
    const final = robot.position

    return arrived
      ? { ok: true, observation: `Arrived at (${final.x.toFixed(2)}, ${final.z.toFixed(2)}).` }
      : {
          ok: false,
          observation:
            `Timed out after ${budget.toFixed(0)}s still ${robot.distanceTo(x, z).toFixed(2)}m ` +
            `from the target. Now at (${final.x.toFixed(2)}, ${final.z.toFixed(2)}).`
        }
  }
}
