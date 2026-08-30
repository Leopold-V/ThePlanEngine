import { useMemo, useState } from 'react'
import { BUILT_IN_SCENARIOS, type RunRecord, type Scenario } from '@shared/scenario.js'

type Tab = 'scenarios' | 'results'

interface Props {
  runs: RunRecord[]
  running: boolean
  onRun: (scenario: Scenario) => void
  onClear: () => void
  onClose: () => void
}

interface Group {
  key: string
  scenarioName: string
  model: string
  fingerprint: string
  passed: number
  total: number
  latest: RunRecord
}

export function ScenarioPanel({
  runs,
  running,
  onRun,
  onClear,
  onClose
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('scenarios')
  const [expanded, setExpanded] = useState<string | null>(null)

  // Grouped by what actually determines a result: the task, the robot
  // configuration, and the model. A pass rate across anything else is noise.
  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, Group>()
    for (const run of runs) {
      const key = `${run.scenarioId}|${run.configFingerprint}|${run.model}`
      const existing = byKey.get(key)
      if (existing) {
        existing.total += 1
        if (run.passed) existing.passed += 1
      } else {
        byKey.set(key, {
          key,
          scenarioName: run.scenarioName,
          model: run.model,
          fingerprint: run.configFingerprint,
          passed: run.passed ? 1 : 0,
          total: 1,
          latest: run
        })
      }
    }
    return [...byKey.values()]
  }, [runs])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="robot-panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h2>Scenarios</h2>
            <p className="muted">
              A task, a scene, and criteria checked against the world when the run ends.
            </p>
          </div>
          <div className="header-actions">
            {tab === 'results' && runs.length > 0 && (
              <button className="ghost" onClick={onClear}>
                Clear history
              </button>
            )}
            <button className="ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <nav className="tabs">
          <button
            className={tab === 'scenarios' ? 'tab active' : 'tab'}
            onClick={() => setTab('scenarios')}
          >
            Scenarios ({BUILT_IN_SCENARIOS.length})
          </button>
          <button
            className={tab === 'results' ? 'tab active' : 'tab'}
            onClick={() => setTab('results')}
          >
            Results ({runs.length})
          </button>
        </nav>

        {tab === 'scenarios' && (
          <div className="robot-body">
            {BUILT_IN_SCENARIOS.map((scenario) => (
              <section key={scenario.id} className="scenario">
                <div className="scenario-head">
                  <div>
                    <h3>{scenario.name}</h3>
                    <p className="goal">&ldquo;{scenario.goal}&rdquo;</p>
                  </div>
                  <button className="primary" disabled={running} onClick={() => onRun(scenario)}>
                    Run
                  </button>
                </div>
                <ul className="criteria">
                  {scenario.criteria.map((criterion, i) => (
                    <li key={i}>{describeCriterion(criterion)}</li>
                  ))}
                </ul>
              </section>
            ))}
            <p className="muted small">
              Running a scenario resets the world to its starting state and clears the
              conversation, so the result depends only on the scenario and the configuration.
              It spends real tokens.
            </p>
          </div>
        )}

        {tab === 'results' && (
          <div className="robot-body">
            {runs.length === 0 ? (
              <p className="muted">
                No runs yet. Models are stochastic, so a pass rate only means something after
                several.
              </p>
            ) : (
              <>
                <table className="results">
                  <thead>
                    <tr>
                      <th>scenario</th>
                      <th>model</th>
                      <th>config</th>
                      <th>pass rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => (
                      <tr key={group.key}>
                        <td>{group.scenarioName}</td>
                        <td>{group.model}</td>
                        <td>
                          <code>{group.fingerprint.slice(0, 8)}</code>
                        </td>
                        <td className={group.passed === group.total ? 'ok' : 'partial'}>
                          {group.passed}/{group.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <h3>Every run</h3>
                {runs.map((run) => (
                  <div key={run.id} className={`run ${run.passed ? 'pass' : 'fail'}`}>
                    <button
                      className="run-head"
                      onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                    >
                      <span className="verdict">{run.passed ? 'PASS' : 'FAIL'}</span>
                      <span className="run-name">{run.scenarioName}</span>
                      <span className="muted small">
                        {run.model} · {run.steps} steps · {(run.durationMs / 1000).toFixed(1)}s
                      </span>
                    </button>
                    {expanded === run.id && (
                      <div className="run-detail">
                        {run.error && <p className="error-line">{run.error}</p>}
                        <ul>
                          {run.criteria.map((c, i) => (
                            <li key={i} className={c.passed ? 'ok' : 'partial'}>
                              <strong>{c.passed ? '✓' : '✗'}</strong> {c.label} — {c.detail}
                            </li>
                          ))}
                        </ul>
                        <p className="muted small">
                          config <code>{run.configFingerprint}</code> ·{' '}
                          {new Date(run.at).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function describeCriterion(criterion: Scenario['criteria'][number]): string {
  switch (criterion.type) {
    case 'object_on':
      return `${criterion.object} ends up on ${criterion.surface}`
    case 'object_near':
      return `${criterion.object} ends within ${criterion.within}m of (${criterion.x}, ${criterion.z})`
    case 'robot_near':
      return `robot ends within ${criterion.within}m of (${criterion.x}, ${criterion.z})`
    case 'holding':
      return criterion.object === null
        ? 'robot ends empty-handed'
        : `robot ends holding ${criterion.object}`
    case 'object_upright':
      return `${criterion.object} is still upright`
    case 'robot_above':
      return `robot ends at least ${criterion.height}m up`
  }
}
