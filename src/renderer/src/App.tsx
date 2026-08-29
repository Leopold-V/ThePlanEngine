import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_PROFILE, type RobotProfile } from '@shared/profile.js'
import type { RunRecord, Scenario } from '@shared/scenario.js'
import type { Settings } from '@shared/types.js'
import type { World } from '@sim/World.js'
import { PlanEngine, type EngineEvent } from '@engine/PlanEngine.js'
import { ScenarioRunner } from '@engine/ScenarioRunner.js'
import { bridge } from './bridge.js'
import { RobotPanel } from './components/RobotPanel.js'
import { ScenarioPanel } from './components/ScenarioPanel.js'
import { SettingsPanel } from './components/SettingsPanel.js'
import { Transcript } from './components/Transcript.js'
import { Viewport } from './components/Viewport.js'
import { WorldInspector } from './components/WorldInspector.js'

export function App(): React.JSX.Element {
  const [events, setEvents] = useState<EngineEvent[]>([])
  const [running, setRunning] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [profile, setProfile] = useState<RobotProfile>(DEFAULT_PROFILE)
  const [showSettings, setShowSettings] = useState(false)
  const [showRobot, setShowRobot] = useState(false)
  const [showScenarios, setShowScenarios] = useState(false)
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [lastRun, setLastRun] = useState<RunRecord | null>(null)
  const [input, setInput] = useState('')
  const [view, setView] = useState<'transcript' | 'world'>('transcript')
  const [world, setWorld] = useState<World | null>(null)
  const [showFov, setShowFov] = useState(true)

  const engineRef = useRef<PlanEngine | null>(null)
  const runnerRef = useRef<ScenarioRunner | null>(null)
  // The runner needs the transcript at the moment a run ends, and state would
  // be stale inside that closure.
  const eventsRef = useRef<EngineEvent[]>([])
  // The engine reads config at send time, so keep refs the closures can follow.
  const settingsRef = useRef<Settings | null>(null)
  settingsRef.current = settings
  const profileRef = useRef<RobotProfile>(profile)
  profileRef.current = profile

  useEffect(() => {
    void bridge.getSettings().then(setSettings)
    void bridge.getProfile().then(setProfile)
    void bridge.getRuns().then(setRuns)
  }, [])

  const handleWorldReady = useCallback((world: World) => {
    setWorld(world)
    world.setDebugVisuals(true)
    engineRef.current = new PlanEngine({
      world,
      send: (req) => bridge.send(req),
      config: () => ({
        providerId: settingsRef.current?.activeProviderId ?? 'claude-code',
        profile: profileRef.current
      }),
      onEvent: (event) =>
        setEvents((prev) => {
          const next = [...prev, event]
          eventsRef.current = next
          return next
        }),
      onRunningChange: setRunning
    })
    runnerRef.current = new ScenarioRunner(world, engineRef.current)

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
    eventsRef.current = []
    setLastRun(null)
  }

  const runScenario = (scenario: Scenario): void => {
    const runner = runnerRef.current
    const provider = settings?.providers.find((p) => p.id === settings.activeProviderId)
    if (!runner || running || !provider) return

    setShowScenarios(false)
    setEvents([])
    eventsRef.current = []
    setLastRun(null)

    void runner
      .run(
        scenario,
        { providerId: provider.id, model: provider.model, profile: profileRef.current },
        () => eventsRef.current
      )
      .then((record) => {
        setLastRun(record)
        return bridge.saveRun(record)
      })
      .then(setRuns)
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
              Clear
            </button>
            <button className="ghost" onClick={() => setShowScenarios(true)}>
              Scenarios
            </button>
            <button className="ghost" onClick={() => setShowRobot(true)}>
              Robot
            </button>
            <button className="ghost" onClick={() => setShowSettings(true)}>
              Settings
            </button>
          </div>
        </header>

        <nav className="tabs panel-tabs">
          <button
            className={view === 'transcript' ? 'tab active' : 'tab'}
            onClick={() => setView('transcript')}
          >
            Transcript
          </button>
          <button
            className={view === 'world' ? 'tab active' : 'tab'}
            onClick={() => setView('world')}
          >
            World
          </button>
          <label className="fov-toggle">
            <input
              type="checkbox"
              checked={showFov}
              onChange={(e) => {
                setShowFov(e.target.checked)
                world?.setDebugVisuals(e.target.checked)
              }}
            />
            show field of view
          </label>
        </nav>

        <div className="panel-content">
          {lastRun ? (
            <div className={`verdict-banner ${lastRun.passed ? 'pass' : 'fail'}`}>
              <strong>{lastRun.passed ? 'PASS' : 'FAIL'}</strong> {lastRun.scenarioName}
              <ul>
                {lastRun.criteria.map((c, i) => (
                  <li key={i} className={c.passed ? 'ok' : 'partial'}>
                    {c.passed ? '✓' : '✗'} {c.label} — {c.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div />
          )}

          {view === 'transcript' ? (
            <Transcript events={events} />
          ) : (
            <WorldInspector world={world} />
          )}
        </div>

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

      {showScenarios && (
        <ScenarioPanel
          runs={runs}
          running={running}
          onRun={runScenario}
          onClear={() => void bridge.clearRuns().then(setRuns)}
          onClose={() => setShowScenarios(false)}
        />
      )}

      {showRobot && (
        <RobotPanel
          profile={profile}
          // Edits apply to the next run immediately; persisting on close keeps
          // one revision per editing session instead of one per keystroke.
          onChange={setProfile}
          onReset={() => void bridge.resetProfile().then(setProfile)}
          onClose={() => {
            setShowRobot(false)
            void bridge.saveProfile(profileRef.current).then(setProfile)
          }}
        />
      )}
    </div>
  )
}
