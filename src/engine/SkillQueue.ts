import type { ToolCall } from '@shared/types.js'
import type { World } from '@sim/World.js'
import { findSkill } from '@sim/skills/registry.js'
import { AbortedError, type SkillContext, type SkillResult } from '@sim/skills/types.js'

export interface ExecuteOptions {
  /** Progress line for the event log. Not sent to the model. */
  report: (text: string) => void
  signal: AbortSignal
  /**
   * Skills the active profile exposes. A skill disabled in the profile is
   * refused here too — the model should never have seen it, but the simulation
   * must not depend on the model behaving.
   */
  allowed: ReadonlySet<string>
}

/**
 * Bridges the world's fixed-step loop to async skills: a skill awaits
 * `ctx.nextFrame()` and is resumed by the next physics tick. Skills run one at
 * a time — the robot has one body.
 */
export class SkillQueue {
  private waiters: Array<(dt: number) => void> = []

  constructor(private readonly world: World) {
    world.addTicker((dt) => {
      // Swap the list first: a resumed skill may queue its next wait immediately.
      const pending = this.waiters
      this.waiters = []
      for (const resolve of pending) resolve(dt)
    })
  }

  /**
   * Validates and runs one tool call. Never throws — every failure comes back
   * as a result the model can read and replan around.
   */
  async execute(call: ToolCall, { report, signal, allowed }: ExecuteOptions): Promise<SkillResult> {
    const skill = allowed.has(call.name) ? findSkill(call.name) : undefined
    if (!skill) {
      return {
        ok: false,
        observation:
          `No such skill "${call.name}". Available skills: ` + `${[...allowed].join(', ')}.`
      }
    }

    const parsed = skill.schema.safeParse(call.args)
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')
      return { ok: false, observation: `Invalid parameters for ${call.name} — ${issues}` }
    }

    const ctx: SkillContext = {
      signal,
      report,
      nextFrame: async () => {
        const dt = await new Promise<number>((resolve) => this.waiters.push(resolve))
        if (signal.aborted) throw new AbortedError()
        return dt
      }
    }

    try {
      return await skill.run(this.world.robot, parsed.data, ctx)
    } catch (err) {
      this.world.robot.stop()
      if (err instanceof AbortedError) {
        return { ok: false, observation: 'Stopped by the operator before finishing.' }
      }
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, observation: `Skill "${call.name}" errored: ${message}` }
    }
  }
}
