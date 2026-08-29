import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE, type RobotProfile } from '@shared/profile.js'
import { SKILLS } from '@sim/skills/registry.js'
import { fingerprint, resolveProfile } from './resolveProfile.js'

/**
 * The sparse-override contract is what keeps profiles tracking code
 * improvements, and the fingerprint is what makes a score attributable. Both
 * are easy to break invisibly, so both are pinned here.
 */

const profile = (overrides: Partial<RobotProfile> = {}): RobotProfile => ({
  ...DEFAULT_PROFILE,
  ...overrides
})

describe('resolveProfile', () => {
  it('an empty profile is exactly the code defaults', () => {
    const resolved = resolveProfile(profile(), SKILLS)
    expect(resolved.skills).toHaveLength(SKILLS.length)
    expect(resolved.tools).toHaveLength(SKILLS.length)
    expect(resolved.skills.every((s) => !s.overridden)).toBe(true)
    for (const skill of SKILLS) {
      const match = resolved.skills.find((s) => s.name === skill.name)
      expect(match?.description).toBe(skill.description)
    }
  })

  it('a disabled skill leaves the tool list but stays listed for the panel', () => {
    const resolved = resolveProfile(profile({ skills: { wave: { enabled: false } } }), SKILLS)
    expect(resolved.enabled.has('wave')).toBe(false)
    expect(resolved.tools.some((t) => t.name === 'wave')).toBe(false)
    expect(resolved.skills.some((s) => s.name === 'wave')).toBe(true)
  })

  it('an overridden description replaces the default and is flagged', () => {
    const resolved = resolveProfile(
      profile({ skills: { walk_to: { description: 'Terse.' } } }),
      SKILLS
    )
    const walk = resolved.skills.find((s) => s.name === 'walk_to')
    expect(walk?.description).toBe('Terse.')
    expect(walk?.overridden).toBe(true)
    expect(walk?.defaultDescription).not.toBe('Terse.')
  })

  it('a profile key for a skill that no longer exists is ignored', () => {
    const resolved = resolveProfile(profile({ skills: { gone: { enabled: false } } }), SKILLS)
    expect(resolved.skills).toHaveLength(SKILLS.length)
  })

  it('an override identical to the default does not count as an override', () => {
    const walkTo = SKILLS.find((s) => s.name === 'walk_to')
    const resolved = resolveProfile(
      profile({ skills: { walk_to: { description: walkTo?.description } } }),
      SKILLS
    )
    expect(resolved.skills.find((s) => s.name === 'walk_to')?.overridden).toBe(false)
  })
})

describe('fingerprint', () => {
  it('is stable for the same configuration', () => {
    const a = resolveProfile(profile(), SKILLS)
    const b = resolveProfile(profile(), SKILLS)
    expect(fingerprint(a)).toBe(fingerprint(b))
  })

  it('changes when a skill is disabled', () => {
    const base = fingerprint(resolveProfile(profile(), SKILLS))
    const fewer = fingerprint(
      resolveProfile(profile({ skills: { wave: { enabled: false } } }), SKILLS)
    )
    expect(fewer).not.toBe(base)
  })

  it('changes when a description is edited', () => {
    const base = fingerprint(resolveProfile(profile(), SKILLS))
    const edited = fingerprint(
      resolveProfile(profile({ skills: { walk_to: { description: 'Terse.' } } }), SKILLS)
    )
    expect(edited).not.toBe(base)
  })

  it('changes when perception changes, since that alters what the model can know', () => {
    const base = fingerprint(resolveProfile(profile(), SKILLS))
    const narrow = fingerprint(resolveProfile(profile({ perception: { halfAngleDeg: 20 } }), SKILLS))
    expect(narrow).not.toBe(base)
  })

  it('ignores key order, so an equivalent profile fingerprints the same', () => {
    const a = resolveProfile(
      profile({ skills: { wave: { enabled: false }, say: { description: 'x' } } }),
      SKILLS
    )
    const b = resolveProfile(
      profile({ skills: { say: { description: 'x' }, wave: { enabled: false } } }),
      SKILLS
    )
    expect(fingerprint(a)).toBe(fingerprint(b))
  })
})
