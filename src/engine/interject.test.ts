import { expect, it } from 'vitest'
import { PlanEngine } from './PlanEngine.js'
import { DEFAULT_PROFILE } from '@shared/profile.js'
import type { Message, ModelReply, SendRequest } from '@shared/types.js'
import type { World } from '@sim/World.js'

/**
 * The loop, driven without a key, a network or a GPU — the seam `send` exists
 * for. The world is a stub with only the surface the engine and two harmless
 * skills touch.
 */
function harness(): {
  engine: PlanEngine
  requests: SendRequest[]
  tick: () => void
  reply: (r: ModelReply) => void
  ready: () => Promise<void>
} {
  const tickers = new Set<(dt: number) => void>()
  const spoken: string[] = []

  const world = {
    robot: { stop: () => {}, setWaving: () => {} },
    addTicker: (fn: (dt: number) => void) => {
      tickers.add(fn)
      return () => tickers.delete(fn)
    },
    observationText: () => 'Robot at (0, 0) facing 0°. Holding: nothing.',
    setPerception: () => {},
    setObservationDetail: () => {},
    speak: () => {},
    view: () => ({ say: (t: string) => spoken.push(t) })
  } as unknown as World

  const requests: SendRequest[] = []
  let resolveReply: ((r: ModelReply) => void) | null = null
  let waiting: (() => void) | null = null

  const engine = new PlanEngine({
    world,
    send: (req) => {
      requests.push(structuredClone(req))
      waiting?.()
      return new Promise<ModelReply>((resolve) => {
        resolveReply = resolve
      })
    },
    config: () => ({ providerId: 'test', profile: DEFAULT_PROFILE }),
    onEvent: () => {},
    onRunningChange: () => {}
  })

  return {
    engine,
    requests,
    tick: () => {
      for (const fn of [...tickers]) fn(1 / 60)
    },
    reply: (r) => resolveReply?.(r),
    // Resolves once the engine is sitting in `send`, waiting for a reply.
    ready: () =>
      new Promise<void>((resolve) => {
        waiting = resolve
      })
  }
}

function toolCall(name: string, args: Record<string, unknown> = {}): ModelReply {
  return {
    text: null,
    toolCalls: [{ id: `c_${name}_${Math.random().toString(36).slice(2, 7)}`, name, args }],
    stopReason: 'tool_calls'
  }
}

/** Every tool call the assistant made must be answered, or the next turn is malformed. */
function everyCallAnswered(messages: Message[]): boolean {
  const called = new Set<string>()
  const answered = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool_call') called.add(part.id)
      if (part.type === 'tool_result') answered.add(part.id)
    }
  }
  return [...called].every((id) => answered.has(id))
}

function toolResults(request: SendRequest): { content: string }[] {
  const last = request.messages[request.messages.length - 1]
  return (last?.parts ?? []).filter((p) => p.type === 'tool_result') as { content: string }[]
}

function lastUserText(request: SendRequest): string {
  const last = request.messages[request.messages.length - 1]
  return (last?.parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

it('a plan decided before the operator spoke is not run', async () => {
  const h = harness()
  const waitForSend = h.ready()
  const run = h.engine.run('wave at me')
  await waitForSend

  // The operator speaks while the model is still composing its reply.
  const next = h.ready()
  h.engine.interject('actually, say hello instead')
  h.reply(toolCall('wave', { seconds: 2.5 }))
  await next

  // The wave never started, and the model was told why.
  const second = h.requests[1] as SendRequest
  expect(toolResults(second)[0]?.content).toContain('Not run')
  expect(lastUserText(second)).toContain('actually, say hello instead')

  h.reply({ text: 'Understood.', toolCalls: [], stopReason: 'end' })
  await run
})

it('speaking mid-action abandons it and the rest of the plan', async () => {
  const h = harness()
  const waitForSend = h.ready()
  const run = h.engine.run('wave for a while')
  await waitForSend

  const next = h.ready()
  h.reply(toolCall('wave', { seconds: 8 }))

  // Let the wave get going, then interrupt it well before eight seconds.
  for (let i = 0; i < 30; i++) {
    h.tick()
    await Promise.resolve()
  }
  h.engine.interject('stop waving, turn around')
  for (let i = 0; i < 5; i++) {
    h.tick()
    await Promise.resolve()
  }
  await next

  const second = h.requests[1] as SendRequest
  const text = lastUserText(second)
  expect(text).toContain('stop waving, turn around')
  // The wave reported being cut short rather than completing.
  expect(toolResults(second)[0]?.content).toContain('Stopped')

  h.reply({ text: 'Turning.', toolCalls: [], stopReason: 'end' })
  await run
})

it('leaves the conversation valid, with every call answered', async () => {
  const h = harness()
  const waitForSend = h.ready()
  const run = h.engine.run('do a few things')
  await waitForSend

  const next = h.ready()
  h.engine.interject('wait')
  h.reply({
    text: null,
    toolCalls: [
      { id: 'a', name: 'wave', args: { seconds: 2 } },
      { id: 'b', name: 'wave', args: { seconds: 2 } }
    ],
    stopReason: 'tool_calls'
  })
  await next

  const second = h.requests[1] as SendRequest
  expect(everyCallAnswered(second.messages)).toBe(true)

  h.reply({ text: 'Waiting.', toolCalls: [], stopReason: 'end' })
  await run
})

it('an interjection after the model has stopped keeps the run going', async () => {
  const h = harness()
  const waitForSend = h.ready()
  const run = h.engine.run('say hello')
  await waitForSend

  const next = h.ready()
  h.engine.interject('one more thing')
  h.reply({ text: 'Done.', toolCalls: [], stopReason: 'end' })
  await next

  // It did not end: the operator got another turn out of it.
  const second = h.requests[1] as SendRequest
  expect(lastUserText(second)).toContain('one more thing')

  h.reply({ text: 'Now done.', toolCalls: [], stopReason: 'end' })
  const outcome = await run
  expect(outcome.steps).toBe(2)
})

