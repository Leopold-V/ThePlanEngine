import { z } from 'zod'
import { knownLabels, resolveTarget, type Skill, type SkillResult, until } from './types.js'

const schema = z.object({
  object: z
    .string()
    .min(1)
    .describe(
      'What to turn towards: an object id if you know it, or the handle of something you have ' +
        'only detected, such as "unknown_2".'
    )
})

export const face: Skill<z.infer<typeof schema>> = {
  name: 'face',
  category: 'locomotion',
  description:
    'Turn on the spot to point at something, naming it rather than giving coordinates. ' +
    'Useful for lining up a photo before taking one — including of something you have detected ' +
    'but not yet identified.',
  schema,

  check(_robot, { object: id }, world): string | null {
    if (world.model.knows(id) || world.find(id)) return null
    const known = knownLabels(world)
    return known.length > 0
      ? `Never seen "${id}". Known so far: ${known.join(', ')}.`
      : `Never seen "${id}", and nothing has been seen yet.`
  },

  async run(robot, { object: id }, ctx): Promise<SkillResult> {
    const { belief, object } = resolveTarget(ctx.world, id)
    const target = belief ?? object?.position
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
