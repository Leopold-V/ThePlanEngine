import { z } from 'zod'
import { type Skill, type SkillResult, wait } from './types.js'

const schema = z.object({
  seconds: z
    .number()
    .min(0.5)
    .max(10)
    .default(2.5)
    .describe('How long to keep waving. Defaults to 2.5 seconds.')
})

export const wave: Skill<z.infer<typeof schema>> = {
  name: 'wave',
  description: 'Raise the right arm and wave. A greeting gesture; does not move the robot.',
  schema,

  async run(robot, { seconds }, ctx): Promise<SkillResult> {
    ctx.report(`Waving for ${seconds}s`)
    robot.setWaving(true)
    try {
      await wait(ctx, seconds)
    } finally {
      // Must lower the arm even if the user pressed Stop mid-wave.
      robot.setWaving(false)
    }
    return { ok: true, observation: `Waved for ${seconds} seconds.` }
  }
}
