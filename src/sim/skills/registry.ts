import { z } from 'zod'
import type { ToolSchema } from '@shared/types.js'
import { lookAt } from './lookAt.js'
import { say } from './say.js'
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
export const SKILLS: Skill<any>[] = [walkTo, turn, lookAt, wave, say]

/** JSON Schema for each skill, in the shape providers hand to the model. */
export function toolSchemas(): ToolSchema[] {
  return SKILLS.map((skill) => {
    const json = z.toJSONSchema(skill.schema, { io: 'input' }) as Record<string, unknown>
    delete json['$schema']
    return { name: skill.name, description: skill.description, parameters: json }
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findSkill(name: string): Skill<any> | undefined {
  return SKILLS.find((s) => s.name === name)
}

export function skillNames(): string[] {
  return SKILLS.map((s) => s.name)
}
