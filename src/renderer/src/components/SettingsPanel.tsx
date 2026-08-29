import { useState } from 'react'
import { STORED_KEY } from '@shared/defaults.js'
import type { Settings } from '@shared/types.js'

interface Props {
  settings: Settings
  onSave: (settings: Settings) => void
  onClose: () => void
}

export function SettingsPanel({ settings, onSave, onClose }: Props): React.JSX.Element {
  const [draft, setDraft] = useState<Settings>(settings)

  const active = draft.providers.find((p) => p.id === draft.activeProviderId)

  const patchActive = (patch: Partial<(typeof draft.providers)[number]>): void => {
    setDraft({
      ...draft,
      providers: draft.providers.map((p) => (p.id === draft.activeProviderId ? { ...p, ...patch } : p))
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <label>
          Provider
          <select
            value={draft.activeProviderId}
            onChange={(e) => setDraft({ ...draft, activeProviderId: e.target.value })}
          >
            {draft.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        {active && (
          <>
            <label>
              Model
              <input
                value={active.model}
                onChange={(e) => patchActive({ model: e.target.value })}
                placeholder="model id"
              />
            </label>

            {active.requiresKey ? (
              <label>
                API key
                <input
                  type="password"
                  value={active.apiKey === STORED_KEY ? '' : (active.apiKey ?? '')}
                  placeholder={active.apiKey === STORED_KEY ? 'Stored — leave blank to keep' : 'sk-…'}
                  onChange={(e) => patchActive({ apiKey: e.target.value })}
                />
                <small>
                  Stored encrypted by your OS keychain. It never reaches the renderer.
                  {active.allowAmbientAuth &&
                    ' Leave blank to use ANTHROPIC_API_KEY or an `ant auth login` profile.'}
                </small>
              </label>
            ) : active.kind === 'claude-cli' ? (
              <label>
                Claude Code command
                <input
                  value={active.command ?? ''}
                  placeholder="auto-detected"
                  onChange={(e) => patchActive({ command: e.target.value })}
                />
                <small>
                  Runs your local Claude Code login — no API key. Leave blank to auto-detect
                  the binary. Model accepts an alias: sonnet, opus, fable.
                </small>
              </label>
            ) : (
              <label>
                Base URL
                <input
                  value={active.baseURL ?? ''}
                  onChange={(e) => patchActive({ baseURL: e.target.value })}
                />
                <small>Local server — no API key needed.</small>
              </label>
            )}
          </>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={() => onSave(draft)}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
