import { useEffect, useRef } from 'react'
import type { EngineEvent } from '@engine/PlanEngine.js'

const LABELS: Record<EngineEvent['kind'], string> = {
  user: 'You',
  assistant: 'Model',
  skill: 'Action',
  result: 'Result',
  observation: 'Senses',
  error: 'Error',
  system: 'Sim',
  metrics: 'Cost'
}

export function Transcript({ events }: { events: EngineEvent[] }): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [events.length])

  if (events.length === 0) {
    return (
      <div className="transcript empty">
        <p>Give the robot an instruction.</p>
        <ul>
          <li>&ldquo;Walk to the middle, turn around and wave&rdquo;</li>
          <li>&ldquo;Pace out a 4 metre square&rdquo;</li>
          <li>&ldquo;Go 3 metres east, then face the origin and say hello&rdquo;</li>
        </ul>
      </div>
    )
  }

  return (
    <div className="transcript">
      {events.map((event) => (
        <div
          key={event.id}
          className={`event ${event.kind}${event.ok === false ? ' failed' : ''}`}
        >
          <span className="label">{LABELS[event.kind]}</span>
          <span className="text">{event.text}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}
