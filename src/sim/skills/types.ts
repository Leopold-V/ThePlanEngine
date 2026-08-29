import type { z } from 'zod'
import type { Robot } from '../Robot.js'

export class AbortedError extends Error {
  constructor() {
    super('Skill aborted')
    this.name = 'AbortedError'
  }
}

export interface SkillContext {
  /** Fires when the user presses Stop. */
  signal: AbortSignal
  /** Resolves on the next physics step with its delta. Rejects if aborted. */
  nextFrame(): Promise<number>
  /** Progress line for the event log. Not sent to the model. */
  report(text: string): void
}

export interface SkillResult {
  ok: boolean
  /** Handed back to the model as the tool result. Keep it short and factual. */
  observation: string
}

/**
 * One robot capability. Adding a file here and registering it is the entire
 * process for giving the model a new thing to do — the engine is untouched.
 */
export interface Skill<P> {
  name: string
  /** The model reads this to decide when to call the skill. It is prompt text. */
  description: string
  schema: z.ZodType<P>
  run(robot: Robot, params: P, ctx: SkillContext): Promise<SkillResult>
}

/** Runs `fn` every frame until it returns true, or the budget expires. */
export async function until(
  ctx: SkillContext,
  timeoutSeconds: number,
  fn: () => boolean
): Promise<boolean> {
  let elapsed = 0
  while (elapsed < timeoutSeconds) {
    if (fn()) return true
    elapsed += await ctx.nextFrame()
  }
  return false
}

export async function wait(ctx: SkillContext, seconds: number): Promise<void> {
  let elapsed = 0
  while (elapsed < seconds) elapsed += await ctx.nextFrame()
}
