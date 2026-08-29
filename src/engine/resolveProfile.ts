import type { RobotProfile } from '@shared/profile.js'
import type { ToolSchema } from '@shared/types.js'
import { DEFAULT_PERCEPTION, type PerceptionConfig } from '@sim/perception.js'
import { jsonSchemaOf } from '@sim/skills/registry.js'
import type { Skill, SkillCategory } from '@sim/skills/types.js'
import { DEFAULT_MAX_ITERATIONS, DEFAULT_SYSTEM_PROMPT } from './prompt.js'

export interface ResolvedSkill {
  name: string
  category: SkillCategory
  description: string
  parameters: Record<string, unknown>
  enabled: boolean
  /** True when the profile supplies the description rather than the code. */
  overridden: boolean
  /** Always the code default, so the panel can show it alongside an override. */
  defaultDescription: string
}

export interface ResolvedConfig {
  systemPrompt: string
  maxIterations: number
  perception: PerceptionConfig
  /** Every skill, disabled ones included — the panel needs the full list. */
  skills: ResolvedSkill[]
  /** Enabled skills only, in the shape providers hand to the model. */
  tools: ToolSchema[]
  enabled: ReadonlySet<string>
}

/**
 * Turns the stored sparse profile into the literal configuration the model
 * receives. Pure, and takes the skill list as a parameter, so it can be
 * exercised without a world, a renderer, or a model.
 *
 * The skill list — not the profile — decides which skills exist. Profile keys
 * naming a removed skill are ignored; a skill added in code shows up here
 * immediately, enabled, with no profile change.
 */
export function resolveProfile(
  profile: RobotProfile,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  skills: Skill<any>[]
): ResolvedConfig {
  const resolved: ResolvedSkill[] = skills.map((skill) => {
    const override = profile.skills[skill.name]
    const description = override?.description?.trim()
    const overridden = Boolean(description) && description !== skill.description

    return {
      name: skill.name,
      category: skill.category,
      description: overridden && description ? description : skill.description,
      defaultDescription: skill.description,
      parameters: jsonSchemaOf(skill),
      enabled: override?.enabled ?? true,
      overridden
    }
  })

  const enabled = resolved.filter((s) => s.enabled)

  return {
    systemPrompt: profile.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT,
    maxIterations: profile.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    perception: {
      range: profile.perception?.range ?? DEFAULT_PERCEPTION.range,
      halfAngleDeg: profile.perception?.halfAngleDeg ?? DEFAULT_PERCEPTION.halfAngleDeg,
      occlusion: profile.perception?.occlusion ?? DEFAULT_PERCEPTION.occlusion
    },
    skills: resolved,
    tools: enabled.map((s) => ({
      name: s.name,
      description: s.description,
      parameters: s.parameters
    })),
    enabled: new Set(enabled.map((s) => s.name))
  }
}

/**
 * A short, stable id for exactly what the model was shown. Stamped on each run
 * so a v0.3 score can name the configuration that produced it.
 *
 * FNV-1a over canonical JSON: a fingerprint, not a cryptographic hash. It is
 * deterministic across machines and versions, which is the property that
 * matters; collision resistance at 64 bits is far beyond what distinguishing
 * configurations requires.
 */
export function fingerprint(config: ResolvedConfig): string {
  const canonical = stringifyCanonical({
    systemPrompt: config.systemPrompt,
    maxIterations: config.maxIterations,
    perception: config.perception,
    tools: config.tools
  })

  const PRIME = 0x100000001b3n
  const MASK = 0xffffffffffffffffn
  let hash = 0xcbf29ce484222325n

  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash ^ BigInt(canonical.charCodeAt(i) & 0xff)) * PRIME) & MASK
  }

  return hash.toString(16).padStart(16, '0')
}

/** JSON with object keys sorted, so key order cannot change the fingerprint. */
function stringifyCanonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stringifyCanonical).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stringifyCanonical(v)}`)

  return `{${entries.join(',')}}`
}
