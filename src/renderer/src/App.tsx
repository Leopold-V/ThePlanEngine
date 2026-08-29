import { useCallback, useEffect, useRef, useState } from 'react'
import type { Settings } from '@shared/types.js'
import type { World } from '@sim/World.js'
import { PlanEngine, type EngineEvent } from '@engine/PlanEngine.js'
import { bridge } from './bridge.js'
import { SettingsPanel } from './components/SettingsPanel.js'
import { Transcript } from './components/Transcript.js'
import { Viewport } from './components/Viewport.js'

export function App(): React.JSX.Element {
  const [events, setEvents] = useState<EngineEvent[]>([])
  const [running, setRunning] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [input, setInput] = useState('')

  const engineRef = useRef<PlanEngine | null>(null)
  // The engine reads config at send time, so keep a ref the closure can follow.
  const settingsRef = useRef<Settings | null>(null)
  settingsRef.current = settings

  useEffect(() => {
    void bridge.getSettings().then(setSettings)
  }, [])

  const handleWorldReady = useCallback((world: World) => {
    engineRef.current = new PlanEngine({
      world,
      send: (req) => bridge.send(req),
      config: () => ({
        providerId: settingsRef.current?.activeProviderId ?? 'anthropic',
        maxIterations: settingsRef.current?.maxIterations ?? 10
      }),
      onEvent: (event) => setEvents((prev) => [...prev, event]),
      onRunningChange: setRunning
    })

    // Dev handle for driving skills from the console without a model:
    //   planEngineDebug.engine.runSkill('walk_to', { x: 3, z: 2 })
    if (import.meta.env.DEV) {
      Object.assign(window, { planEngineDebug: { world, engine: engineRef.current } })
    }
  }, [])

  const submit = (): void => {
    const instruction = input.trim()
    if (!instruction || running || !engineRef.current) return
    setInput('')
    void engineRef.current.run(instruction)
  }

  const saveSettings = (next: Settings): void => {
    void bridge.saveSettings(next).then(setSettings)
    setShowSettings(false)
  }

  const reset = (): void => {
    engineRef.current?.reset()
    setEvents([])
  }

  const activeProvider = settings?.providers.find((p) => p.id === settings.activeProviderId)

  return (
    <div className="app">
      <Viewport onReady={handleWorldReady} />

      <aside className="panel">
        <header>
          <div>
            <h1>The Plan Engine</h1>
            <p className="provider">
              {activeProvider ? `${activeProvider.label} · ${activeProvider.model}` : 'Loading…'}
            </p>
          </div>
          <div className="header-actions">
            <button className="ghost" onClick={reset} disabled={running}>
              Reset
            </button>
            <button className="ghost" onClick={() => setShowSettings(true)}>
              Settings
            </button>
          </div>
        </header>

        <Transcript events={events} />

        <div className="composer">
          <textarea
            value={input}
            placeholder="Tell the robot what to do…"
            rows={3}
            disabled={running}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          {running ? (
            <button className="danger" onClick={() => engineRef.current?.stop()}>
              Stop
            </button>
          ) : (
            <button className="primary" onClick={submit} disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
      </aside>

      {showSettings && settings && (
        <SettingsPanel
          settings={settings}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
