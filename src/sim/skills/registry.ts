import { z } from 'zod'
import { approach } from './approach.js'
import { face } from './face.js'
import { look } from './look.js'
import { lookAt } from './lookAt.js'
import { moveForward } from './moveForward.js'
import { pickUp } from './pickUp.js'
import { putDown } from './putDown.js'
import { say } from './say.js'
import { scan } from './scan.js'
import { turn } from './turn.js'
import type { Skill } from './types.js'
import { walkTo } from './walkTo.js'
import { wave } from './wave.js'

/**
 * The robot's entire vocabulary. Register a skill here and the model can call
 * it on the next message — no other file needs to change.
 *
 * Each skill has its own parameter type, so the collection is deliberately
 * loose; `findSkill` hands params back through the skill's own zod schema,
 * which is where type safety is actually enforced.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SKILLS: Skill<any>[] = [
  // Absolute-coordinate movement, for when the observation supplies positions.
  walkTo,
  turn,
  lookAt,
  // Egocentric movement, for when the robot is working from photographs and has
  // no absolute frame to name.
  moveForward,
  approach,
  face,
  // Perception.
  scan,
  look,
  // Manipulation and expression.
  pickUp,
  putDown,
  wave,
  say
]

/**
 * The JSON Schema the model is shown for a skill, generated from its zod
 * schema — which stays the single source of truth for both the schema sent out
 * and the validation of arguments coming back. Not overridable by a profile.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsonSchemaOf(skill: Skill<any>): Record<string, unknown> {
  const json = z.toJSONSchema(skill.schema, { io: 'input' }) as Record<string, unknown>
  delete json['$schema']
  return json
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findSkill(name: string): Skill<any> | undefined {
  return SKILLS.find((s) => s.name === name)
}

export function skillNames(): string[] {
  return SKILLS.map((s) => s.name)
}
