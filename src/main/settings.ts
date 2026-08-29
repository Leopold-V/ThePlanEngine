import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { DEFAULT_SETTINGS, STORED_KEY } from '@shared/defaults.js'
import type { ProviderSettings, Settings } from '@shared/types.js'

/** On disk we keep an encrypted blob, never the raw key. */
interface StoredProvider extends Omit<ProviderSettings, 'apiKey'> {
  encryptedKey?: string
}

interface StoredSettings {
  activeProviderId: string
  maxIterations: number
  providers: StoredProvider[]
}

const file = (): string => join(app.getPath('userData'), 'settings.json')

let cache: StoredSettings | null = null

function encrypt(plain: string): string | undefined {
  if (!plain) return undefined
  if (!safeStorage.isEncryptionAvailable()) {
    // No OS keychain (some Linux setups). Fall back to plaintext rather than
    // silently dropping the key, and let the UI warn about it.
    return `plain:${plain}`
  }
  return `enc:${safeStorage.encryptString(plain).toString('base64')}`
}

function decrypt(stored: string | undefined): string | undefined {
  if (!stored) return undefined
  if (stored.startsWith('plain:')) return stored.slice(6)
  if (!stored.startsWith('enc:')) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
  } catch {
    return undefined
  }
}

/** Defaults supply any preset added since the file was written. */
function merge(stored: StoredSettings | null): StoredSettings {
  const presets: StoredProvider[] = DEFAULT_SETTINGS.providers.map((p) => {
    const { apiKey: _ignored, ...rest } = p
    return rest
  })
  if (!stored) {
    return {
      activeProviderId: DEFAULT_SETTINGS.activeProviderId,
      maxIterations: DEFAULT_SETTINGS.maxIterations,
      providers: presets
    }
  }
  const byId = new Map(stored.providers.map((p) => [p.id, p]))
  const providers = presets.map((preset) => ({ ...preset, ...(byId.get(preset.id) ?? {}) }))
  // Keep any custom provider the user added that isn't a preset.
  for (const p of stored.providers) {
    if (!providers.some((existing) => existing.id === p.id)) providers.push(p)
  }
  return { ...stored, providers }
}

function read(): StoredSettings {
  if (cache) return cache
  let parsed: StoredSettings | null = null
  try {
    if (existsSync(file())) parsed = JSON.parse(readFileSync(file(), 'utf-8')) as StoredSettings
  } catch {
    parsed = null
  }
  cache = merge(parsed)
  return cache
}

function write(next: StoredSettings): void {
  cache = next
  writeFileSync(file(), JSON.stringify(next, null, 2), 'utf-8')
}

/** Settings safe to hand the renderer: keys replaced by a sentinel. */
export function getSettings(): Settings {
  const stored = read()
  return {
    activeProviderId: stored.activeProviderId,
    maxIterations: stored.maxIterations,
    providers: stored.providers.map(({ encryptedKey, ...p }) => ({
      ...p,
      apiKey: encryptedKey ? STORED_KEY : ''
    }))
  }
}

export function saveSettings(incoming: Settings): Settings {
  const stored = read()
  const previous = new Map(stored.providers.map((p) => [p.id, p.encryptedKey]))

  write({
    activeProviderId: incoming.activeProviderId,
    maxIterations: incoming.maxIterations,
    providers: incoming.providers.map(({ apiKey, ...p }) => ({
      ...p,
      encryptedKey: apiKey === STORED_KEY ? previous.get(p.id) : encrypt(apiKey ?? '')
    }))
  })

  return getSettings()
}

/** Full settings including the real key. Main process only. */
export function resolveProvider(id: string): ProviderSettings | null {
  const stored = read()
  const found = stored.providers.find((p) => p.id === id)
  if (!found) return null
  const { encryptedKey, ...rest } = found
  return { ...rest, apiKey: decrypt(encryptedKey) }
}
