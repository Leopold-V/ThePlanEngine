import { z } from 'zod'
import { type Skill, type SkillResult, until } from './types.js'

const schema = z.object({
  object: z.string().min(1).describe('The id of the object to turn towards, as labelled in a photo.')
})

export const face: Skill<z.infer<typeof schema>> = {
  name: 'face',
  category: 'locomotion',
  description:
    'Turn on the spot to point at an object, naming it by id rather than by coordinates. ' +
    'Useful for lining up a photo before taking one.',
  schema,

  check(_robot, { object: id }, world): string | null {
    if (world.model.knows(id) || world.find(id)) return null
    const known = world.model.all().map((b) => b.id)
    return known.length > 0
      ? `Never seen "${id}". Objects seen so far: ${known.join(', ')}.`
      : `Never seen "${id}", and nothing has been seen yet. Look around first.`
  },

  async run(robot, { object: id }, ctx): Promise<SkillResult> {
    const belief = ctx.world.model.get(id)
    const target = belief ?? ctx.world.find(id)?.position
    if (!target) return { ok: false, observation: `Never seen "${id}".` }

    const tx = 'x' in target ? target.x : 0
    const tz = 'z' in target ? target.z : 0

    ctx.report(`Facing ${id}`)
    const done = await until(ctx, 8, () => {
      const angle = robot.angleTo(tx, tz)
      if (Math.abs(angle) < 0.03) return true
      robot.setTurn(Math.sign(angle) * Math.min(1, Math.abs(angle) * 2))
      return false
    })

    robot.stop()

    return {
      ok: done,
      observation: done
        ? `Now facing ${id}, heading ${robot.headingDegrees.toFixed(0)}°.`
        : `Could not finish turning towards ${id}.`
    }
  }
}
