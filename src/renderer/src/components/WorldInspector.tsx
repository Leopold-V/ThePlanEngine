import { useEffect, useState } from 'react'
import type { World } from '@sim/World.js'

/** Belief and ground truth are far enough apart to matter, in metres. */
const DRIFT_THRESHOLD = 0.5
const POLL_MS = 250

interface Row {
  id: string
  believedX: number
  believedZ: number
  actualX: number | null
  actualZ: number | null
  drift: number | null
  ageSeconds: number
  visible: boolean
}

interface Snapshot {
  robot: string
  rows: Row[]
  unseen: string[]
}

/**
 * Belief against ground truth, side by side.
 *
 * This is the panel that makes a failed run diagnosable: when the robot acts on
 * a wrong position you can see at a glance whether its belief was stale — a
 * correct simulation doing its job — or whether it had good information and
 * reasoned badly, which is the only case that says anything about the model.
 */
export function WorldInspector({ world }: { world: World | null }): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)

  useEffect(() => {
    if (!world) return

    const read = (): void => {
      const beliefs = world.model.all()
      const known = new Set(beliefs.map((b) => b.id))
      const now = world.simTimeSeconds

      setSnapshot({
        robot: world.observationText().split('\n')[0] ?? '',
        rows: beliefs.map((belief) => {
          const object = world.objects.find((o) => o.spec.id === belief.id)
          const actual = object?.position ?? null
          return {
            id: belief.id,
            believedX: belief.x,
            believedZ: belief.z,
            actualX: actual ? actual.x : null,
            actualZ: actual ? actual.z : null,
            drift: actual ? Math.hypot(actual.x - belief.x, actual.z - belief.z) : null,
            ageSeconds: now - belief.lastSeenAt,
            visible: belief.visible
          }
        }),
        // Never-seen objects are the other half of the picture: the robot
        // cannot be wrong about them, it simply has no idea they exist.
        unseen: world.objects
          .filter((o) => !known.has(o.spec.id) && !o.isCarried)
          .map((o) => o.spec.id)
      })
    }

    read()
    const timer = window.setInterval(read, POLL_MS)
    return () => window.clearInterval(timer)
  }, [world])

  if (!snapshot) return <div className="inspector muted">Waiting for the simulation…</div>

  return (
    <div className="inspector">
      <p className="robot-line">{snapshot.robot}</p>

      {snapshot.rows.length === 0 ? (
        <p className="muted">Nothing seen yet. Try scan.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>object</th>
              <th>believed</th>
              <th>actual</th>
              <th>drift</th>
              <th>seen</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.rows.map((row) => (
              <tr
                key={row.id}
                className={
                  row.drift !== null && row.drift > DRIFT_THRESHOLD ? 'stale' : undefined
                }
              >
                <td>
                  {row.visible && <span className="dot" title="in view" />}
                  {row.id}
                </td>
                <td>
                  {row.believedX.toFixed(1)}, {row.believedZ.toFixed(1)}
                </td>
                <td>
                  {row.actualX === null
                    ? '—'
                    : `${row.actualX.toFixed(1)}, ${(row.actualZ ?? 0).toFixed(1)}`}
                </td>
                <td>{row.drift === null ? '—' : `${row.drift.toFixed(2)}m`}</td>
                <td>{row.visible ? 'now' : `${Math.round(row.ageSeconds)}s`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {snapshot.unseen.length > 0 && (
        <p className="muted small">Never seen: {snapshot.unseen.join(', ')}</p>
      )}

      <p className="muted small">
        A highlighted row means the robot believes an object is somewhere it is not — a stale
        belief, not a model error.
      </p>
    </div>
  )
}
