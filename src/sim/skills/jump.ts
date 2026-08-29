import { z } from 'zod'
import { Robot } from '../Robot.js'
import type { WorldObject } from '../objects.js'
import { type Skill, type SkillResult, until } from './types.js'

const schema = z.object({
  height: z
    .number()
    .min(0.2)
    .max(Robot.MAX_JUMP_HEIGHT)
    .describe(
      'Peak height of the jump in metres, measured at the feet. To land on top of something ' +
        'this must be greater than that thing is tall.'
    ),
  forward: z
    .number()
    .min(0)
    .max(2.5)
    .default(0)
    .describe(
      'How far the jump carries you along the direction you are facing, in metres. 0 jumps ' +
        'straight up on the spot.'
    )
})

/** How close the feet must be to a surface's top to count as standing on it. */
const LANDED_ON_TOLERANCE = 0.15
/** Overhang allowed before the robot is over the edge rather than on the surface. */
const FOOTPRINT_SLACK = 0.25

/**
 * The one skill that leaves the ground. Height and distance are not independent
 * — the arc is ballistic, so the height fixes how long there is to travel, and
 * an impossible pair is refused with the height that would work.
 */
export const jump: Skill<z.infer<typeof schema>> = {
  name: 'jump',
  category: 'locomotion',
  description:
    'Jump up, and optionally forward. Use it to clear a low obstacle, or to get on top of ' +
    'something too tall to walk onto: stand close, face it, then jump higher than it is tall ' +
    'and far enough forward to come down on top of it. The result says what you landed on, so ' +
    'if you end up back on the ground, try again higher or closer.',
  schema,

  check(robot, { height, forward }, _world): string | null {
    if (robot.airborne) return 'Already in the air.'

    const seconds = Robot.airtime(height)
    const furthest = Robot.MAX_LAUNCH_SPEED * seconds
    if (forward > furthest) {
      const needed = Robot.minimumHeightFor(forward)
      return (
        `A ${height}m jump is only airborne for ${seconds.toFixed(2)}s, which covers ` +
        `${furthest.toFixed(2)}m at most. To travel ${forward}m, jump at least ` +
        `${needed.toFixed(2)}m high — or ask for less distance.`
      )
    }

    return null
  },

  async run(robot, { height, forward }, ctx): Promise<SkillResult> {
    const start = robot.position
    ctx.report(forward > 0 ? `Jumping ${height}m up, ${forward}m forward` : `Jumping ${height}m up`)

    if (!robot.jump(height, forward)) return { ok: false, observation: 'Already in the air.' }

    // Generous against the ballistic estimate: coming down somewhere lower than
    // the take-off point takes longer than landing level does.
    const landed = await until(ctx, Robot.airtime(height) + 5, () => !robot.airborne)
    robot.stop()

    const end = robot.position
    const travelled = robot.distanceTo(start.x, start.z)
    const where = `Now at (${end.x.toFixed(2)}, ${end.z.toFixed(2)})`

    if (!landed) {
      return {
        ok: false,
        observation: `Jumped but has not come down — still ${end.y.toFixed(2)}m up. ${where}.`
      }
    }

    const surface = surfaceUnder(ctx.world.objects, end)
    const landing = surface
      ? `on top of ${surface}, ${end.y.toFixed(2)}m up`
      : end.y > 0.1
        ? `${end.y.toFixed(2)}m up, but not on top of anything the robot can name`
        : 'back on the ground'

    return {
      ok: true,
      observation: `Landed ${landing}, ${travelled.toFixed(2)}m from where it took off. ${where}.`
    }
  }
}

/**
 * What the robot is standing on, if anything. Treated as axis-aligned, which is
 * true of every surface worth landing on and close enough for a report.
 */
function surfaceUnder(
  objects: WorldObject[],
  feet: { x: number; y: number; z: number }
): string | null {
  for (const object of objects) {
    const [width, height, depth] = object.spec.size
    const centre = object.position
    if (Math.abs(feet.y - (centre.y + height / 2)) > LANDED_ON_TOLERANCE) continue
    if (Math.abs(feet.x - centre.x) > width / 2 + FOOTPRINT_SLACK) continue
    if (Math.abs(feet.z - centre.z) > depth / 2 + FOOTPRINT_SLACK) continue
    return object.spec.id
  }
  return null
}
