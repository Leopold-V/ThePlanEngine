import { z } from 'zod'
import { Robot } from '../Robot.js'
import { type Skill, type SkillResult, wait } from './types.js'

const schema = z.object({
  object: z.string().min(1).describe('The id of the object to pick up, e.g. "red_block".')
})

export const pickUp: Skill<z.infer<typeof schema>> = {
  name: 'pick_up',
  category: 'manipulation',
  description:
    'Pick up a nearby object and carry it. You must already be within ' +
    `${Robot.REACH}m of it — this does not walk you there, so use walk_to first. ` +
    'You can carry only one object at a time.',
  schema,

  // Navigation and manipulation stay separate, as on a real robot: the model
  // has to sequence them, and that sequencing is the thing being tested.
  check(robot, { object: id }, world): string | null {
    if (robot.held) {
      return `Already carrying ${robot.held.spec.id}. Put it down first.`
    }

    const object = world.find(id)
    if (!object) {
      const known = world.model.all().map((b) => b.id)
      return known.length > 0
        ? `No object called "${id}". Known objects: ${known.join(', ')}.`
        : `No object called "${id}", and nothing has been seen yet. Try scan first.`
    }

    if (!object.spec.graspable) return `${id} is too heavy to pick up.`

    const distance = robot.distanceTo(object.position.x, object.position.z)
    if (distance > Robot.REACH) {
      return (
        `Cannot reach ${id}: it is ${distance.toFixed(2)}m away and reach is ` +
        `${Robot.REACH}m. Walk closer first.`
      )
    }

    return null
  },

  async run(robot, { object: id }, ctx): Promise<SkillResult> {
    const object = ctx.world.find(id)
    if (!object) return { ok: false, observation: `${id} vanished before it could be picked up.` }

    ctx.report(`Picking up ${id}`)
    ctx.world.grasp(object)
    // A beat so the carry transition is visible rather than instantaneous.
    await wait(ctx, 0.4)

    return { ok: true, observation: `Picked up ${id}. Now carrying it.` }
  }
}
