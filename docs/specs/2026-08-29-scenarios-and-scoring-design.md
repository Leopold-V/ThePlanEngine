# v0.3 — Scenarios and scoring

**Date:** 2026-08-29
**Status:** approved
**Follows:** [Robot profiles](2026-08-29-robot-profile-design.md), [Objects and perception](2026-08-29-objects-and-perception-design.md)

## Goal

Turn runs from anecdotes into results. A scenario states a task and how to tell whether it was
done; a run record says what happened and under exactly which configuration.

## Scenario

```ts
interface Scenario {
  id: string; name: string
  goal: string                 // handed to the model verbatim
  scene: SceneDefinition
  start: { x: number; z: number; headingDeg: number }
  criteria: Criterion[]
}
```

Scene and scenario types move to `shared/`. They were always pure data; keeping them in `sim/` would
have forced the run store in the main process to import the simulation.

## Criteria are data predicates

Evaluated against a world snapshot when the run ends.

| predicate | checks |
|---|---|
| `object_on` | footprint overlap plus the object's base resting on the surface top |
| `object_near` | object within a radius of a point |
| `robot_near` | robot within a radius of a point |
| `holding` | carrying a named object, or `null` for empty-handed |
| `object_upright` | the body's up vector still points up |

Chosen over code predicates or an LLM judge because a benchmark number has to be deterministic,
free to compute, and reproducible from the document alone. The vocabulary is deliberately small and
grows one entry at a time.

**Every result carries a reason, not just a boolean** — *"red_block is at (2.1, 3.0), 2.8m from
table"*. Consistent with precondition messages and the belief inspector: a failure has to say what
it saw, or the score is unusable for diagnosis.

`evaluate(criteria, snapshot)` is a pure function over a plain data snapshot, with no three.js,
Rapier, or renderer in sight. The entire score rests on it, so it is the first thing in the project
to get tests.

## Run records

```ts
interface RunRecord {
  id: string; at: string
  scenarioId: string; scenarioName: string
  configFingerprint: string          // which robot configuration produced this
  providerId: string; model: string
  passed: boolean
  criteria: CriterionResult[]
  steps: number; durationMs: number
  transcript: { kind: string; text: string }[]
  error?: string
}
```

Appended to `userData/runs.json`. The transcript is kept because a bare number is not a finding —
the point of the fingerprint plus the transcript is being able to ask later *why* a run failed.

Results group by *(scenario, fingerprint, model)* so a pass rate accumulates across runs. Models
are stochastic; one run is an anecdote.

## Plumbing

`World.resetTo(scene, start)` — the world currently builds its scene in the constructor and can
never be reset, which a scenario runner requires. It removes existing bodies and meshes, loads the
new scene, repositions the robot, drops anything held, and clears the world model.

`ScenarioRunner` resets the world, drives `PlanEngine`, evaluates the criteria, and returns a run
record. It sits beside `PlanEngine` rather than inside it so the agent loop keeps one job.

`PlanEngine.run` now returns `{ steps, error }` instead of `void`, so the runner can record how
many model round trips a task took.

## Out of scope

Batch runs across scenarios and models, repeat-N, invariants evaluated during the run rather than
at the end, scenario authoring in the UI, and exporting results.
