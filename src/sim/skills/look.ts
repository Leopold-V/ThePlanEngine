import { z } from 'zod'
import { type Skill, type SkillResult, wait } from './types.js'

const schema = z.object({})

export const look: Skill<z.infer<typeof schema>> = {
  name: 'look',
  category: 'perception',
  description:
    'Take a photo of what is in front of you and look at it. Visible objects are labelled ' +
    'with their id in the image, and you can refer to those ids in other tools. Use this to ' +
    'see what is around you; turn or move first if you need a different view.',
  schema,

  async run(_robot, _params, ctx): Promise<SkillResult> {
    ctx.report('Taking a photo')
    // A beat so the camera captures a settled frame rather than mid-stride.
    await wait(ctx, 0.2)

    const frame = ctx.world.capture()
    if (!frame) {
      return { ok: false, observation: 'The camera is unavailable.' }
    }

    const seen =
      frame.labelled.length > 0
        ? `Labelled in the photo: ${frame.labelled.join(', ')}.`
        : 'Nothing recognisable is in shot.'

    return {
      ok: true,
      observation: `Photo taken. ${seen}`,
      image: { mediaType: frame.mediaType, base64: frame.base64 }
    }
  }
}
