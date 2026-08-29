/**
 * The robot's capability definition, as a serializable document.
 *
 * Deliberately NOT app settings: v0.3 compares models and prompts on the same
 * task, and a result only means something if the exact configuration that
 * produced it can be named. This document is that configuration.
 */

export interface SkillOverride {
  /** Absent means enabled. */
  enabled?: boolean
  /** Absent means the description defined in code. */
  description?: string
}

export interface RobotProfile {
  id: string
  name: string
  /** Bumped on every save; lets a future scoring run order configurations. */
  revision: number
  /** Absent means the system prompt defined in code. */
  systemPrompt?: string
  /**
   * Sparse, keyed by skill name. An absent key means "code default, enabled",
   * so `{}` is exactly the code defaults and a description improved in code
   * reaches every profile that did not explicitly override it.
   *
   * The code registry — not this map — is the source of truth for which skills
   * exist. Keys naming a removed skill resolve away; skills added in code
   * appear immediately without touching the profile.
   */
  skills: Record<string, SkillOverride>
  maxIterations?: number
}

export const DEFAULT_PROFILE: RobotProfile = {
  id: 'default',
  name: 'Default robot',
  revision: 1,
  skills: {}
}
