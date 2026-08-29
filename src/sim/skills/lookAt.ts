import { z } from 'zod'
import { type Skill, type SkillResult, until } from './types.js'

const schema = z.object({
  x: z.number().min(-24).max(24).describe('X coordinate to face.'),
  z: z.number().min(-24).max(24).describe('Z coordinate to face.')
})

export const lookAt: Skill<z.infer<typeof schema>> = {
  name: 'look_at',
  category: 'locomotion',
  description: 'Turn the robot to face a point on the ground without walking towards it.',
  schema,

  async run(robot, { x, z }, ctx): Promise<SkillResult> {
    ctx.report(`Facing (${x}, ${z})`)

    const done = await until(ctx, 6, () => {
      const angle = robot.angleTo(x, z)
      if (Math.abs(angle) < 0.03) return true
      robot.setTurn(Math.sign(angle) * Math.min(1, Math.abs(angle) * 2))
      return false
    })

    robot.stop()

    return {
      ok: done,
      observation: done
        ? `Now facing (${x}, ${z}) at heading ${robot.headingDegrees.toFixed(0)}°.`
        : `Could not finish turning towards (${x}, ${z}).`
    }
  }
}
