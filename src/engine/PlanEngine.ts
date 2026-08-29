import type { Message, ModelReply, Part, SendRequest, ToolResultPart } from '@shared/types.js'
import type { World } from '@sim/World.js'
import { describe } from '@sim/observe.js'
import { toolSchemas } from '@sim/skills/registry.js'
import type { SkillResult } from '@sim/skills/types.js'
import { SkillQueue } from './SkillQueue.js'
import { SYSTEM_PROMPT } from './prompt.js'

export type EventKind = 'user' | 'assistant' | 'skill' | 'result' | 'error' | 'system'

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
  config: () => { providerId: string; maxIterations: number }
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

  constructor(private readonly options: PlanEngineOptions) {
    this.queue = new SkillQueue(options.world)
  }

  get running(): boolean {
    return this.controller !== null
  }

  async run(instruction: string): Promise<void> {
    if (this.running) return

    const controller = new AbortController()
    this.controller = controller
    this.options.onRunningChange(true)
    this.emit('user', instruction)

    try {
      // The observation rides along with the instruction so the model always
      // starts from where the robot actually is.
      this.messages.push({
        role: 'user',
        parts: [{ type: 'text', text: `${instruction}\n\n[${describe(this.options.world.robot)}]` }]
      })

      const { providerId, maxIterations } = this.options.config()
      const tools = toolSchemas()

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (controller.signal.aborted) {
          this.emit('system', 'Stopped.')
          return
        }

        const reply = await this.options.send({
          providerId,
          system: SYSTEM_PROMPT,
          messages: this.messages,
          tools
        })

        if (reply.stopReason === 'error') {
          this.emit('error', reply.error ?? 'The model provider failed.')
          return
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
        if (reply.toolCalls.length === 0) return

        const results: ToolResultPart[] = []
        for (const call of reply.toolCalls) {
          if (controller.signal.aborted) break
          this.emit('skill', formatCall(call.name, call.args))
          const result = await this.queue.execute(
            call,
            (text) => this.emit('system', text),
            controller.signal
          )
          this.emit('result', result.observation, result.ok)
          results.push({
            type: 'tool_result',
            id: call.id,
            content: result.observation,
            isError: !result.ok
          })
        }

        if (controller.signal.aborted) {
          this.emit('system', 'Stopped.')
          // Still record the results so the history stays valid for a resume.
          if (results.length > 0) this.pushResults(results)
          return
        }

        this.pushResults(results)

        if (iteration === maxIterations - 1) {
          this.emit('error', `Hit the ${maxIterations}-step limit. Raise it in Settings.`)
        }
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err.message : String(err))
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
      const result = await this.queue.execute(
        { id: crypto.randomUUID(), name, args },
        (text) => this.emit('system', text),
        controller.signal
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
    this.messages.push({
      role: 'user',
      parts: [...results, { type: 'text', text: describe(this.options.world.robot) }]
    })
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

function formatCall(name: string, args: Record<string, unknown>): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return `${name}()`
  return `${name}(${entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')})`
}
