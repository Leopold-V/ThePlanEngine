import { z } from 'zod'
import * as THREE from 'three'
import { Robot } from '../Robot.js'
import { type Skill, type SkillResult, until, wait } from './types.js'

const MAX_DEG = Math.round(THREE.MathUtils.radToDeg(Robot.MAX_GAZE))

const schema = z.object({
  direction: z
    .number()
    .min(-MAX_DEG)
    .max(MAX_DEG)
    .default(0)
    .describe(
      `Degrees to turn your head before looking: negative is left, positive is right, 0 is ` +
        `straight ahead. Your neck reaches about ${MAX_DEG}° each way. Turning your head is far ` +
        `quicker than turning your body.`
    )
})

/** Close enough to the commanded angle to take the photograph. */
const SETTLED = 0.02

export const look: Skill<z.infer<typeof schema>> = {
  name: 'look',
  category: 'perception',
  description:
    'Take a photo of what you can see and look at it. Visible objects are labelled with their ' +
    'id in the image, and you can refer to those ids in other tools. Give a direction to glance ' +
    'to one side without moving your feet; your head returns to centre afterwards.',
  schema,

  async run(robot, { direction }, ctx): Promise<SkillResult> {
    const target = THREE.MathUtils.degToRad(direction)
    ctx.report(direction === 0 ? 'Taking a photo' : `Looking ${describeTurn(direction)}`)

    robot.setGazeYaw(target)
    // The neck takes a moment, and the camera is mounted in it — photographing
    // before it arrives takes a picture of the way there.
    await until(ctx, 2, () => Math.abs(robot.gazeYaw - target) < SETTLED)
    await wait(ctx, 0.15)

    const frame = ctx.world.capture()

    // Back to neutral, so the sensor pose stays predictable between actions and
    // the model never has to remember which way its head is pointing. Waited
    // out rather than fired and forgotten: the observation that follows this
    // skill reports the neck angle, and it would otherwise still read as turned.
    robot.setGazeYaw(0)
    await until(ctx, 2, () => Math.abs(robot.gazeYaw) < SETTLED)

    if (!frame) {
      return { ok: false, observation: 'The camera is unavailable.' }
    }

    const seen =
      frame.labelled.length > 0
        ? `Labelled in the photo: ${frame.labelled.join(', ')}.`
        : 'Nothing recognisable is in shot.'
    const where = direction === 0 ? '' : ` (looking ${describeTurn(direction)})`

    return {
      ok: true,
      observation: `Photo taken${where}. ${seen}`,
      image: { mediaType: frame.mediaType, base64: frame.base64 }
    }
  }
}

function describeTurn(degrees: number): string {
  return `${Math.abs(degrees)}° to the ${degrees < 0 ? 'left' : 'right'}`
}
