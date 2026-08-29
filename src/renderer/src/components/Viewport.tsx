import { useEffect, useRef, useState } from 'react'
import { World } from '@sim/World.js'
import type { CameraMode } from '@sim/CameraRig.js'

interface Props {
  onReady: (world: World) => void
}

const CAMERA_LABELS: Record<CameraMode, string> = {
  follow: 'Follow',
  orbit: 'Free',
  pov: 'Robot eyes'
}

/**
 * Owns the canvas and the World lifecycle. Rapier's WASM loads asynchronously,
 * so the world is handed upward only once it is actually running.
 */
export function Viewport({ onReady }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const worldRef = useRef<World | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<CameraMode>('follow')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let world: World | null = null
    let cancelled = false

    World.create(canvas)
      .then((created) => {
        // StrictMode double-mounts in dev; drop the world if we already unmounted.
        if (cancelled) {
          created.dispose()
          return
        }
        world = created
        worldRef.current = created
        created.start()
        setLoading(false)
        setMode(created.cameraMode)
        onReady(created)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoading(false)
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
      worldRef.current = null
      world?.dispose()
    }
  }, [onReady])

  const choose = (next: CameraMode): void => {
    worldRef.current?.setCameraMode(next)
    setMode(next)
  }

  return (
    <div className="viewport">
      <canvas ref={canvasRef} />

      {!loading && !error && (
        <div className="camera-modes">
          {(Object.keys(CAMERA_LABELS) as CameraMode[]).map((option) => (
            <button
              key={option}
              className={option === mode ? 'chip active' : 'chip'}
              onClick={() => choose(option)}
            >
              {CAMERA_LABELS[option]}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="viewport-overlay">Starting simulation…</div>}
      {error && <div className="viewport-overlay error">Simulation failed: {error}</div>}
    </div>
  )
}
