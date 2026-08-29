import { z } from 'zod'
import { type Skill, type SkillResult, until } from './types.js'

const schema = z.object({
  degrees: z
    .number()
    .min(-360)
    .max(360)
    .describe('Degrees to rotate in place. Positive turns left, negative turns right.')
})

export const turn: Skill<z.infer<typeof schema>> = {
  name: 'turn',
  category: 'locomotion',
  description: 'Rotate the robot in place by a relative angle without moving it.',
  schema,

  async run(robot, { degrees }, ctx): Promise<SkillResult> {
    const target = robot.heading + (degrees * Math.PI) / 180
    ctx.report(`Turning ${degrees}°`)

    const done = await until(ctx, Math.abs(degrees) / 90 + 4, () => {
      const remaining = target - robot.heading
      if (Math.abs(remaining) < 0.02) return true
      robot.setTurn(Math.sign(remaining) * Math.min(1, Math.abs(remaining) * 2))
      return false
    })

    robot.stop()
    if (done) robot.heading = target

    return {
      ok: done,
      observation: done
        ? `Turned ${degrees}°. Now facing ${robot.headingDegrees.toFixed(0)}°.`
        : `Turn did not complete. Facing ${robot.headingDegrees.toFixed(0)}°.`
    }
  }
}
