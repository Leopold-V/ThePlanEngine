import { z } from 'zod'
import { Robot } from '../Robot.js'
import { type Skill, type SkillResult, wait } from './types.js'

const schema = z.object({
  x: z.number().min(-40).max(40).describe('X coordinate to place the object at.'),
  z: z.number().min(-40).max(40).describe('Z coordinate to place the object at.')
})

export const putDown: Skill<z.infer<typeof schema>> = {
  name: 'put_down',
  category: 'manipulation',
  description:
    'Put down the object you are carrying at a point within reach. It is released at chest ' +
    'height and falls, so placing it above a surface such as a table will leave it resting ' +
    'on top. Walk to the destination before calling this.',
  schema,

  check(robot, { x, z }, _world): string | null {
    if (!robot.held) return 'Not carrying anything.'

    const distance = robot.distanceTo(x, z)
    if (distance > Robot.REACH) {
      return (
        `Cannot place at (${x}, ${z}): that is ${distance.toFixed(2)}m away and reach is ` +
        `${Robot.REACH}m. Walk closer first.`
      )
    }

    return null
  },

  async run(_robot, { x, z }, ctx): Promise<SkillResult> {
    const object = ctx.world.release(x, z)
    if (!object) return { ok: false, observation: 'Not carrying anything.' }

    ctx.report(`Placing ${object.spec.id} at (${x}, ${z})`)
    // Let it fall and settle before reporting where it actually ended up —
    // it may land on a surface, or topple off one.
    await wait(ctx, 1.0)

    const resting = object.position
    return {
      ok: true,
      observation:
        `Put down ${object.spec.id}. It settled at ` +
        `(${resting.x.toFixed(2)}, ${resting.z.toFixed(2)}) at height ${resting.y.toFixed(2)}m.`
    }
  }
}
