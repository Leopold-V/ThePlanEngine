import type { RobotProfile } from '@shared/profile.js'
import type { RunRecord, Scenario } from '@shared/scenario.js'
import type { World } from '@sim/World.js'
import { SKILLS } from '@sim/skills/registry.js'
import type { EngineEvent, PlanEngine } from './PlanEngine.js'
import { allPassed, evaluate } from './criteria.js'
import { fingerprint, resolveProfile } from './resolveProfile.js'

export interface ScenarioRunContext {
  providerId: string
  model: string
  profile: RobotProfile
}

/**
 * Runs one scenario end to end: reset the world to a known state, hand the goal
 * to the agent loop, then score the result against the scenario's criteria.
 *
 * Sits beside `PlanEngine` rather than inside it so the agent loop keeps one
 * job. It is also the only place that knows a run is being *scored* — a normal
 * instruction from the composer never touches this.
 */
export class ScenarioRunner {
  constructor(
    private readonly world: World,
    private readonly engine: PlanEngine
  ) {}

  async run(
    scenario: Scenario,
    context: ScenarioRunContext,
    transcript: () => EngineEvent[]
  ): Promise<RunRecord> {
    // A scored run has to start from a known state, or the result means nothing.
    this.engine.reset()
    this.world.resetTo(scenario.scene, scenario.start)

    const startedAt = Date.now()
    const outcome = await this.engine.run(scenario.goal)

    // Criteria are checked against the world as it actually ended up, not
    // against what the model claimed it did.
    const results = evaluate(scenario.criteria, this.world.snapshot())
    const resolved = resolveProfile(context.profile, SKILLS)

    return {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      configFingerprint: fingerprint(resolved),
      providerId: context.providerId,
      model: context.model,
      passed: allPassed(results) && !outcome.error,
      criteria: results,
      steps: outcome.steps,
      durationMs: Date.now() - startedAt,
      transcript: transcript().map((e) => ({ kind: e.kind, text: e.text })),
      ...(outcome.error ? { error: outcome.error } : {})
    }
  }
}
