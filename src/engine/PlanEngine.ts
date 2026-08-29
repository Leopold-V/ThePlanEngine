import type { ObservationDetail, RobotProfile } from '@shared/profile.js'
import type { Message, ModelReply, Part, SendRequest, ToolResultPart } from '@shared/types.js'
import type { World } from '@sim/World.js'
import { SKILLS } from '@sim/skills/registry.js'
import type { SkillResult } from '@sim/skills/types.js'
import { SkillQueue } from './SkillQueue.js'
import { fingerprint, resolveProfile } from './resolveProfile.js'

export type EventKind =
  | 'user'
  | 'assistant'
  | 'skill'
  | 'result'
  | 'observation'
  | 'error'
  | 'system'

export interface EngineEvent {
  id: string
  kind: EventKind
  text: string
  at: number
  ok?: boolean
}

export interface PlanEngineOptions {
  world: World
  send: (req: SendRequest) => Promise<ModelReply>
  /** Read at run time, so robot-panel edits take effect on the next run. */
  config: () => { providerId: string; profile: RobotProfile }
  onEvent: (event: EngineEvent) => void
  onRunningChange: (running: boolean) => void
}

/**
 * The agent loop: instruction → model → tool calls → simulation → observation →
 * model, until the model answers without calling a tool or a stop condition hits.
 *
 * Conversation history lives here so the model keeps context across instructions
 * within a session.
 */
export class PlanEngine {
  private readonly queue: SkillQueue
  private messages: Message[] = []
  private controller: AbortController | null = null
  /** Set from the resolved profile at the start of each run. */
  private detail: ObservationDetail = 'full'

  constructor(private readonly options: PlanEngineOptions) {
    this.queue = new SkillQueue(options.world)
  }

  get running(): boolean {
    return this.controller !== null
  }

  /** Model round trips taken, and why the run ended. */
  async run(instruction: string): Promise<{ steps: number; error?: string }> {
    if (this.running) return { steps: 0, error: 'A run is already in progress.' }

    let steps = 0
    let failure: string | undefined

    const controller = new AbortController()
    this.controller = controller
    this.options.onRunningChange(true)
    this.emit('user', instruction)

    try {
      // Resolve the configuration before the first observation, since the
      // profile decides how much that observation is allowed to say.
      const { providerId, profile } = this.options.config()
      const resolved = resolveProfile(profile, SKILLS)
      const { maxIterations, tools, enabled } = resolved
      this.detail = resolved.observationDetail

      // Sensor parameters are part of the experiment, so they come from the
      // profile rather than being fixed in the simulation.
      this.options.world.setPerception(resolved.perception)

      // The observation rides along with the instruction so the model always
      // starts from where the robot actually is.
      const opening = this.options.world.observationText(this.detail)
      this.messages.push({
        role: 'user',
        parts: [{ type: 'text', text: `${instruction}\n\n[${opening}]` }]
      })
      // Surfaced, not just sent: without seeing what the robot perceived you
      // cannot tell a perception failure from a reasoning failure.
      this.emit('observation', opening)

      // Provenance: names exactly what the model was shown for this run.
      this.emit(
        'system',
        `config ${fingerprint(resolved)} · ${tools.length} skill${tools.length === 1 ? '' : 's'}`
      )

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (controller.signal.aborted) {
          this.emit('system', 'Stopped.')
          failure = 'Stopped by the operator.'
          return { steps, error: failure }
        }

        steps++
        const reply = await this.options.send({
          providerId,
          system: resolved.systemPrompt,
          messages: withRecentImagesOnly(this.messages),
          tools
        })

        if (reply.stopReason === 'error') {
          failure = reply.error ?? 'The model provider failed.'
          this.emit('error', failure)
          return { steps, error: failure }
        }

        const assistantParts: Part[] = []
        if (reply.text) assistantParts.push({ type: 'text', text: reply.text })
        for (const call of reply.toolCalls) {
          assistantParts.push({ type: 'tool_call', id: call.id, name: call.name, args: call.args })
        }
        if (assistantParts.length > 0) {
          this.messages.push({ role: 'assistant', parts: assistantParts })
        }

        if (reply.text) this.emit('assistant', reply.text)

        // No tool calls means the model considers the task finished.
        if (reply.toolCalls.length === 0) return { steps }

        const results: ToolResultPart[] = []
        for (const call of reply.toolCalls) {
          if (controller.signal.aborted) break
          this.emit('skill', formatCall(call.name, call.args))
          const result = await this.queue.execute(call, {
            report: (text) => this.emit('system', text),
            signal: controller.signal,
            allowed: enabled
          })
          this.emit('result', result.observation, result.ok)
          results.push({
            type: 'tool_result',
            id: call.id,
            content: result.observation,
            ...(result.image ? { image: result.image } : {}),
            isError: !result.ok
          })
        }

        if (controller.signal.aborted) {
          this.emit('system', 'Stopped.')
          // Still record the results so the history stays valid for a resume.
          if (results.length > 0) this.pushResults(results)
          failure = 'Stopped by the operator.'
          return { steps, error: failure }
        }

        this.pushResults(results)

        if (iteration === maxIterations - 1) {
          failure = `Hit the ${maxIterations}-step limit.`
          this.emit('error', `${failure} Raise it in the robot panel.`)
        }
      }
      return { steps, ...(failure ? { error: failure } : {}) }
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err)
      this.emit('error', failure)
      return { steps, error: failure }
    } finally {
      this.options.world.robot.stop()
      this.controller = null
      this.options.onRunningChange(false)
    }
  }

  stop(): void {
    this.controller?.abort()
  }

  /**
   * Run a single skill directly, bypassing the model. Used for manual control
   * and for exercising the simulation without spending tokens.
   */
  async runSkill(name: string, args: Record<string, unknown> = {}): Promise<SkillResult> {
    if (this.running) {
      return { ok: false, observation: 'Busy: a run is already in progress.' }
    }
    const controller = new AbortController()
    this.controller = controller
    this.options.onRunningChange(true)
    this.emit('skill', formatCall(name, args))
    try {
      const { profile } = this.options.config()
      const result = await this.queue.execute(
        { id: crypto.randomUUID(), name, args },
        {
          report: (text) => this.emit('system', text),
          signal: controller.signal,
          allowed: resolveProfile(profile, SKILLS).enabled
        }
      )
      this.emit('result', result.observation, result.ok)
      return result
    } finally {
      this.options.world.robot.stop()
      this.controller = null
      this.options.onRunningChange(false)
    }
  }

  /** Clears history so the next instruction starts from a blank conversation. */
  reset(): void {
    this.stop()
    this.messages = []
  }

  /**
   * Tool results must lead the message; the trailing observation gives the model
   * the robot's true state before it decides what to do next.
   */
  private pushResults(results: ToolResultPart[]): void {
    if (results.length === 0) return
    const observation = this.options.world.observationText(this.detail)
    this.messages.push({
      role: 'user',
      parts: [...results, { type: 'text', text: observation }]
    })
    this.emit('observation', observation)
  }

  private emit(kind: EventKind, text: string, ok?: boolean): void {
    this.options.onEvent({
      id: crypto.randomUUID(),
      kind,
      text,
      at: Date.now(),
      ...(ok === undefined ? {} : { ok })
    })
  }
}

/** Images kept in history. Beyond this, only the text of a photo survives. */
const IMAGE_HISTORY = 2

/**
 * Strips images from all but the most recent few tool results.
 *
 * History is resent in full on every turn, so without this a ten-step task
 * carries ten screenshots on every subsequent request — dominating both the
 * context window and the bill. The text of each photo is kept, so the model
 * still knows it looked and what was labelled.
 */
function withRecentImagesOnly(messages: Message[]): Message[] {
  const withImages: ToolResultPart[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === 'tool_result' && part.image) withImages.push(part)
    }
  }
  if (withImages.length <= IMAGE_HISTORY) return messages

  const keep = new Set(withImages.slice(-IMAGE_HISTORY).map((p) => p.id))

  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== 'tool_result' || !part.image || keep.has(part.id)) return part
      const { image: _dropped, ...rest } = part
      return { ...rest, content: `${part.content} [earlier photo omitted]` }
    })
  }))
}

function formatCall(name: string, args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return `${name}()`
  return `${name}(${entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})`
}
