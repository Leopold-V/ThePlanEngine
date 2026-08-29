import { z } from 'zod'
import { type Skill, type SkillResult } from './types.js'

const schema = z.object({
  text: z.string().min(1).max(300).describe('What the robot says out loud.')
})

export const say: Skill<z.infer<typeof schema>> = {
  name: 'say',
  category: 'communication',
  description:
    'Make the robot speak a line out loud in the world. Use this for in-character speech; ' +
    'plain replies to the operator do not need a tool call.',
  schema,

  async run(_robot, { text }, ctx): Promise<SkillResult> {
    // Out loud means in the world. The transcript keeps the full line; the
    // bubble is what makes it the robot speaking rather than a log entry.
    ctx.world.say(text)
    ctx.report(`Robot says: "${text}"`)
    return { ok: true, observation: `Said: "${text}"` }
  }
}
