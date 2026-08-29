import { z } from 'zod'
import { shortestAngle } from '../steering.js'
import { type Skill, type SkillResult, until } from './types.js'

const schema = z.object({})

const FULL_CIRCLE = Math.PI * 2
/** Generous against the ~2.3s a revolution takes, including the ramp up. */
const SWEEP_TIMEOUT = 8
/** Close enough to the original heading to stop correcting. */
const SETTLED = 0.02
/** Moved further than this from where it was remembered, and it is news. */
const MOVED = 0.5

export const scan: Skill<z.infer<typeof schema>> = {
  name: 'scan',
  category: 'perception',
  description:
    'Turn a full circle on the spot and report what is new or has moved since you last looked. ' +
    'You can only see what is in front of you, so use this when something you need is ' +
    'unaccounted for. Scanning again with nothing changed will tell you nothing new.',
  schema,

  async run(robot, _params, ctx): Promise<SkillResult> {
    ctx.report('Scanning surroundings')
    // Sweep with the head straight, so the circle is measured from the body and
    // a leftover glance cannot skew where the sweep starts and ends.
    robot.setGazeYaw(0)

    // Where things were believed to be before the sweep. Snapshotted by value,
    // because perception rewrites the belief map as the robot turns.
    const before = new Map<string, { x: number; z: number }>()
    for (const belief of ctx.world.model.all()) {
      before.set(belief.id, { x: belief.x, z: belief.z })
    }

    const start = robot.heading
    const seen = new Map<string, { x: number; z: number }>()

    // Turned by angle covered, not by elapsed time. Four seconds at the robot's
    // turn rate is two revolutions, not the one the name promises.
    let turned = 0
    let previous = robot.heading

    await until(ctx, SWEEP_TIMEOUT, () => {
      turned += Math.abs(shortestAngle(previous, robot.heading))
      previous = robot.heading
      if (turned >= FULL_CIRCLE) return true

      robot.setTurn(1)
      // Perception ticks on its own; sweeping just puts everything through the
      // field of view in turn, and we collect what shows up.
      for (const sighting of ctx.world.sightings) {
        seen.set(sighting.id, { x: sighting.position.x, z: sighting.position.z })
      }
      return false
    })

    // Deceleration carries it slightly past a full turn. Correct by turning,
    // not by assignment: setting `heading` teleports the body, which is both
    // impossible and visibly jarring now that a camera is pointed at it.
    await until(ctx, 2, () => {
      const remaining = shortestAngle(robot.heading, start)
      if (Math.abs(remaining) < SETTLED) return true
      robot.setTurn(Math.max(-1, Math.min(1, remaining * 3)))
      return false
    })
    robot.stop()

    if (seen.size === 0) {
      return { ok: true, observation: 'Scanned a full circle. Nothing in range.' }
    }

    const found: string[] = []
    const moved: string[] = []
    let confirmed = 0

    for (const [id, now] of seen) {
      const remembered = before.get(id)
      if (!remembered) {
        found.push(`${id} at (${now.x.toFixed(2)}, ${now.z.toFixed(2)})`)
      } else if (Math.hypot(now.x - remembered.x, now.z - remembered.z) > MOVED) {
        moved.push(
          `${id} has moved to (${now.x.toFixed(2)}, ${now.z.toFixed(2)}) from ` +
            `(${remembered.x.toFixed(2)}, ${remembered.z.toFixed(2)})`
        )
      } else {
        confirmed++
      }
    }

    // In proprioceptive mode the observation names no objects at all, so this
    // result is the model's only account of what is out there. Reporting only
    // the differences would leave it knowing that two things exist and not
    // where either of them is.
    if (ctx.world.observationDetail === 'proprioceptive') {
      const all = [...seen.entries()]
        .map(([id, p]) => `${id} at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`)
        .join('; ')
      const news = found.length > 0 ? ` New since last time: ${found.length}.` : ''
      const shifted = moved.length > 0 ? ` ${moved.join('; ')}.` : ''
      return { ok: true, observation: `Scanned a full circle. In view: ${all}.${news}${shifted}` }
    }

    // Otherwise the observation already carries Visible and Remembered every
    // turn, so repeating them here is pure duplication. Report only what
    // changed — which is what makes a redundant scan visibly worthless.
    const parts: string[] = []
    if (found.length > 0) parts.push(`Found: ${found.join('; ')}.`)
    if (moved.length > 0) parts.push(`${moved.join('; ')}.`)
    if (parts.length === 0) {
      return {
        ok: true,
        observation:
          `Scanned a full circle. Nothing new — all ${confirmed} object` +
          `${confirmed === 1 ? ' is' : 's are'} where you already remembered.`
      }
    }
    if (confirmed > 0) {
      parts.push(`${confirmed} other${confirmed === 1 ? '' : 's'} unchanged.`)
    }

    return { ok: true, observation: `Scanned a full circle. ${parts.join(' ')}` }
  }
}
