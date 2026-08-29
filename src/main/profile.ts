import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_PROFILE, type RobotProfile } from '@shared/profile.js'

/**
 * Profiles are plain JSON on disk — no encryption, unlike settings, because a
 * profile is meant to be readable, diffable, and eventually shareable in a repo.
 * Nothing secret belongs in one.
 */

const file = (): string => join(app.getPath('userData'), 'profile.json')

let cache: RobotProfile | null = null

export function getProfile(): RobotProfile {
  if (cache) return cache

  let parsed: Partial<RobotProfile> | null = null
  try {
    if (existsSync(file())) parsed = JSON.parse(readFileSync(file(), 'utf-8')) as RobotProfile
  } catch {
    parsed = null
  }

  // Field-wise merge: a profile written by an older version is still valid,
  // and anything it omits falls back to the default rather than to undefined.
  cache = {
    ...DEFAULT_PROFILE,
    ...(parsed ?? {}),
    skills: parsed?.skills ?? {}
  }
  return cache
}

export function saveProfile(incoming: RobotProfile): RobotProfile {
  const next: RobotProfile = {
    ...incoming,
    revision: (getProfile().revision ?? 0) + 1,
    // Drop overrides that no longer say anything, so the stored document stays
    // sparse and keeps tracking code defaults.
    skills: Object.fromEntries(
      Object.entries(incoming.skills ?? {}).filter(
        ([, o]) => o.enabled === false || (o.description ?? '').trim().length > 0
      )
    )
  }

  cache = next
  writeFileSync(file(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function resetProfile(): RobotProfile {
  return saveProfile({ ...DEFAULT_PROFILE, revision: getProfile().revision })
}
