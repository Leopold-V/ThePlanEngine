import { z } from 'zod'
import { type Skill, type SkillResult, until } from './types.js'

const schema = z.object({})

const SWEEP_SECONDS = 4

export const scan: Skill<z.infer<typeof schema>> = {
  name: 'scan',
  category: 'perception',
  description:
    'Turn a full circle on the spot to look around, and report every object seen. ' +
    'You can only see what is in front of you, so use this to find things or to ' +
    'confirm what is still where you remember it.',
  schema,

  async run(robot, _params, ctx): Promise<SkillResult> {
    ctx.report('Scanning surroundings')

    const start = robot.heading
    const seen = new Map<string, { x: number; z: number }>()
    let elapsed = 0

    // Perception ticks on its own; sweeping just puts everything through the
    // field of view in turn, and we collect what shows up.
    await until(ctx, SWEEP_SECONDS + 2, () => {
      if (elapsed >= SWEEP_SECONDS) return true
      elapsed += 1 / 60
      robot.setTurn(1)
      for (const sighting of ctx.world.sightings) {
        seen.set(sighting.id, { x: sighting.position.x, z: sighting.position.z })
      }
      return false
    })

    robot.stop()
    robot.heading = start

    if (seen.size === 0) {
      return { ok: true, observation: 'Scanned a full circle. Nothing in range.' }
    }

    const list = [...seen.entries()]
      .map(([id, p]) => `${id} at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`)
      .join('; ')

    return { ok: true, observation: `Scanned a full circle. Saw: ${list}.` }
  }
}
