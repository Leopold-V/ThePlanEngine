# The Plan Engine — MVP design

**Date:** 2026-08-29
**Status:** approved, implemented as v0.1

## Goal

A desktop app for testing AI models as embodied agents. The operator types an instruction; a
language model decomposes it into robot skills; a humanoid executes them in a 3D simulation.

The MVP's only job is to prove the loop is solid. Scenario scoring — the reason the project is
interesting — is deliberately v2, and depends on this loop being reliable first.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Model source | Pluggable provider layer | Hosted frontier, hosted open-source, and local must all work |
| Control interface | Tool calls → skill library | The model plans; motion is solved for it. Works with any tool-calling model |
| Locomotion | Rapier world + kinematic character controller | Real collision without solving bipedal balance, which is research-grade and would consume the whole MVP |
| Shell | Electron | Model calls in the Node main process avoid CORS and keep keys out of the renderer; guaranteed Chromium WebGL2 cross-platform. Tauri rejected: WebKitGTK on Linux is a poor bet for a 3D app, and Rust raises the contribution bar |

## Architecture

Four layers, with `sim/` and `engine/` free of both React and Electron imports.

```
main/      providers (network, API keys), settings store, IPC handlers
preload/   contextBridge — the renderer's only route to main
renderer/  React UI: Viewport, Transcript, SettingsPanel
sim/       three.js scene + Rapier world, Robot, skills/, observe
engine/    PlanEngine (agent loop), SkillQueue, system prompt
shared/    neutral wire types
```

The simulation and the engine run in the renderer (three.js needs WebGL); only model HTTP calls
cross into main.

### The three load-bearing interfaces

Everything else is replaceable without touching the engine.

```ts
interface ModelProvider {
  kind: ProviderKind
  send(args: SendArgs): Promise<ModelReply>   // never throws
}

interface Skill<P> {
  name: string
  description: string        // this text IS the prompt engineering
  schema: z.ZodType<P>       // → JSON Schema for the model, → validation on the way back
  run(robot: Robot, params: P, ctx: SkillContext): Promise<SkillResult>
}

interface SkillResult {
  ok: boolean
  observation: string        // handed back to the model as the tool result
}
```

Adding a capability is one file in `sim/skills/` plus a registry line. Adding a vendor is one file
in `main/providers/` plus a registry line.

### Agent loop

1. User instruction, with the robot's current observation appended, is pushed as a user message.
2. `PlanEngine` sends system prompt + skill schemas + history to the active provider.
3. Tool calls are queued and executed **serially** — the robot has one body.
4. Each skill awaits `ctx.nextFrame()`, resumed by the world's fixed 60Hz step.
5. Results plus a fresh observation go back as a user message; loop.
6. Ends when the model replies with no tool calls, the iteration cap is hit, or the user stops.

### Providers

Only two adapters. `openai-compatible` covers OpenAI, Ollama, LM Studio, Together, Hugging Face,
and vLLM — they differ only by `baseURL`, so a separate Ollama adapter would be dead weight.

Keys are encrypted through Electron `safeStorage` and stored in `userData/settings.json`. The
renderer receives a `__stored__` sentinel instead of any key; sending it back on save means "keep
the existing key".

### MVP scope

**In:** flat 50×50m grid, one humanoid, skills `walk_to` / `turn` / `look_at` / `wave` / `say`,
Anthropic + OpenAI-compatible providers, viewport, transcript, settings, Stop.

**Out:** graspable objects, obstacles, multiple robots, vision input, recording/replay, ragdoll
physics, scenario scoring.

## Error handling

Every failure returns to the model as a tool result rather than breaking the loop, so it can
replan: unknown skill (with the valid list attached), zod-rejected parameters (with the specific
issues), skill timeout, and user abort. Provider errors halt the run cleanly with the robot
stopped and the reason shown in the transcript. A hard iteration cap bounds every run.

## Deviations from the original sketch

- Skills return `Promise<SkillResult>` with a `ctx.report()` progress callback rather than
  `AsyncIterable<SkillProgress>`. Same capability, materially less code.
- No separate `ollama.ts` provider — folded into `openai-compatible`, as above.

## Testing

Per the operator's constraint, v0.1 ships without a test suite. The seam that makes tests possible
later is nonetheless in place: `PlanEngine` receives `send` by injection, so a `MockProvider`
returning scripted tool calls can drive the whole loop with no API key, no network, and no GPU.
Skills take `Robot` as a parameter and can be exercised headlessly against a stub.
