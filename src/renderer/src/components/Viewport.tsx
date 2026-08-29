import { useEffect, useRef, useState } from 'react'
import { World } from '@sim/World.js'

interface Props {
  onReady: (world: World) => void
}

/**
 * Owns the canvas and the World lifecycle. Rapier's WASM loads asynchronously,
 * so the world is handed upward only once it is actually running.
 */
export function Viewport({ onReady }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
        created.start()
        setLoading(false)
        onReady(created)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoading(false)
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
      world?.dispose()
    }
  }, [onReady])

  return (
    <div className="viewport">
      <canvas ref={canvasRef} />
      {loading && <div className="viewport-overlay">Starting simulation…</div>}
      {error && <div className="viewport-overlay error">Simulation failed: {error}</div>}
    </div>
  )
}
