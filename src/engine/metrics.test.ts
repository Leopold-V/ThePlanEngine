import { expect, it } from 'vitest'
import { PlanEngine } from './PlanEngine.js'
import { DEFAULT_PROFILE } from '@shared/profile.js'
import type { ModelReply } from '@shared/types.js'
import type { World } from '@sim/World.js'
import type { EngineEvent } from './PlanEngine.js'

/** How long the stub provider spends "thinking", so the timing has something to measure. */
const THINKING_MS = 150

/**
 * Drives the loop over the `send` seam with a provider that takes a measurable
 * amount of time. `say` is used as the tool because it finishes without needing
 * the world to tick.
 */
function harness(replies: ModelReply[]): { engine: PlanEngine; events: EngineEvent[] } {
  const world = {
    robot: { stop: () => {} },
    addTicker: () => () => {},
    observationText: () => 'Robot at (0, 0) facing 0°. Holding: nothing.',
    setPerception: () => {},
    setObservationDetail: () => {},
    speak: () => {},
    view: () => ({ say: () => {} })
  } as unknown as World

  const events: EngineEvent[] = []
  let turn = 0

  const engine = new PlanEngine({
    world,
    send: async () => {
      await new Promise((resolve) => setTimeout(resolve, THINKING_MS))
      return replies[turn++] ?? { text: 'Done.', toolCalls: [], stopReason: 'end' }
    },
    config: () => ({ providerId: 'test', profile: DEFAULT_PROFILE }),
    onEvent: (event) => events.push(event),
    onRunningChange: () => {}
  })

  return { engine, events }
}

function metricsOf(events: EngineEvent[]): string[] {
  return events.filter((e) => e.kind === 'metrics').map((e) => e.text)
}

function secondsIn(line: string): number {
  return Number(/(\d+\.\d+)s/.exec(line)?.[1] ?? -1)
}

const callSay: ModelReply = {
  text: null,
  toolCalls: [{ id: 'c1', name: 'say', args: { text: 'hello' } }],
  stopReason: 'tool_calls',
  usage: { inputTokens: 1481, outputTokens: 96 }
}

it('records the latency and token usage of every round trip', async () => {
  const h = harness([callSay, { text: 'Done.', toolCalls: [], stopReason: 'end', usage: { inputTokens: 1620, outputTokens: 12 } }])

  await h.engine.run('say hello')

  const lines = metricsOf(h.events)
  expect(lines).toHaveLength(2)
  expect(lines[0]).toContain('1481 in')
  expect(lines[0]).toContain('96 out')
  expect(lines[1]).toContain('1620 in')
})

it('reports how long the model actually took', async () => {
  const h = harness([{ text: 'Done.', toolCalls: [], stopReason: 'end', usage: { inputTokens: 10, outputTokens: 2 } }])

  await h.engine.run('say hello')

  // The stub slept 150ms, so anything under 0.1s means the clock is not running.
  expect(secondsIn(metricsOf(h.events)[0] as string)).toBeGreaterThanOrEqual(0.1)
})

it('falls back to the payload size when the provider reports no usage', async () => {
  const h = harness([{ text: 'Done.', toolCalls: [], stopReason: 'end' }])

  await h.engine.run('say hello')

  expect(metricsOf(h.events)[0]).toContain('chars sent')
})

it('times a round trip that failed, so a slow failure is visible', async () => {
  const h = harness([{ text: null, toolCalls: [], stopReason: 'error', error: 'provider exploded' }])

  await h.engine.run('say hello')

  expect(metricsOf(h.events)).toHaveLength(1)
})
