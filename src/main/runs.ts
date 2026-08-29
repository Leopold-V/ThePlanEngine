import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { RunRecord } from '@shared/scenario.js'

/**
 * Run history, as plain JSON. Kept readable and diffable for the same reason
 * profiles are: a result you cannot inspect afterwards is not evidence.
 *
 * Newest first, and capped — transcripts are small but unbounded history is not.
 */

const MAX_RUNS = 500

const file = (): string => join(app.getPath('userData'), 'runs.json')

let cache: RunRecord[] | null = null

export function getRuns(): RunRecord[] {
  if (cache) return cache
  try {
    cache = existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf-8')) as RunRecord[]) : []
  } catch {
    cache = []
  }
  return cache
}

export function saveRun(record: RunRecord): RunRecord[] {
  const next = [record, ...getRuns()].slice(0, MAX_RUNS)
  cache = next
  writeFileSync(file(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function clearRuns(): RunRecord[] {
  cache = []
  writeFileSync(file(), '[]', 'utf-8')
  return cache
}
