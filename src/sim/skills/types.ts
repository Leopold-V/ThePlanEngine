import type { z } from 'zod'
import type { Robot } from '../Robot.js'
import type { WorldView } from '../WorldView.js'

export class AbortedError extends Error {
  constructor() {
    super('Skill aborted')
    this.name = 'AbortedError'
  }
}

export interface SkillContext {
  /** Everything beyond the robot's own body. */
  world: WorldView
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
  /** A rendered frame, for skills that return a picture rather than a sentence. */
  image?: { mediaType: string; base64: string }
}

/**
 * Groups skills in the robot panel. `manipulation` and `perception` are
 * declared ahead of the v0.2 objects-and-grasping work so the grouping stays
 * stable when those skills land.
 */
export type SkillCategory =
  | 'locomotion'
  | 'manipulation'
  | 'perception'
  | 'gesture'
  | 'communication'

/**
 * One robot capability. Adding a file here and registering it is the entire
 * process for giving the model a new thing to do — the engine is untouched.
 *
 * Still room to grow without a breaking change: `effects` (postconditions)
 * would let a plan be validated before any of it runs.
 */
export interface Skill<P> {
  name: string
  category: SkillCategory
  /**
   * The model reads this to decide when to call the skill — it is prompt text,
   * not a code comment. A profile may override it; see `shared/profile.ts`.
   */
  description: string
  schema: z.ZodType<P>
  /**
   * Preconditions. Return a reason to refuse the call before `run` is entered,
   * or null to proceed. The reason goes straight back to the model, so write it
   * as an explanation it can act on — "3.2m away, reach is 1.2m", not "invalid".
   */
  check?(robot: Robot, params: P, world: WorldView): string | null
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
