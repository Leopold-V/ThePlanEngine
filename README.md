# The Plan Engine

Give an AI model a humanoid robot in a simulated 3D world, then watch it plan.

The Plan Engine is a desktop workbench for testing how well language models act as **embodied
agents**. You type an instruction, the model breaks it into robot skills, and the simulation
executes them while you watch. Everything the model did — its reasoning, its actions, and what it
observed back — stays visible in the transcript.

> **Status: early and experimental.** v0.1 proves the loop end to end. See [Roadmap](#roadmap).

---

## How it works

```
you: "walk to the middle, turn around and wave"
  │
  ▼
PlanEngine ──► system prompt + skill schemas + observation ──► ModelProvider
  │                                                                │
  │                          tool calls: walk_to(0,0), turn(180)   │
  │  ◄─────────────────────────────────────────────────────────────┘
  ▼
SkillQueue ──► runs each skill against the simulation ──► 3D viewport
  │
  ▼
observation ("Arrived at (0.02, -0.11).") ──► back to the model
  │
  └──► model calls more tools, or replies in plain text and the task ends
```

The model never touches joint angles. It plans in terms of **skills** — `walk_to`, `turn`,
`look_at`, `wave`, `say` — and the simulation solves the motion. That keeps the variable under
test on the planning side, where the interesting differences between models actually are.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron | Model calls run in the Node main process: no CORS, no API key in the renderer |
| UI | React + TypeScript + Vite | via `electron-vite` |
| Rendering | three.js | |
| Physics | Rapier (`@dimforge/rapier3d-compat`) | Owns the world; the robot uses a kinematic character controller rather than a ragdoll, so balance is never the thing that fails |

## Providers

Two adapters cover everything, because most vendors speak the OpenAI `/chat/completions` shape:

- **`anthropic`** — Claude models
- **`openai-compatible`** — OpenAI, **Ollama**, LM Studio, Together, Hugging Face router, vLLM.
  Only `baseURL` differs.

Local models need no API key. Hosted keys are encrypted with your OS keychain via Electron
`safeStorage` and never reach the renderer process.

## Running it

```bash
npm install
```

```bash
npm run dev
```

Then open **Settings**, pick a provider, and paste a key — or point it at Ollama on
`http://localhost:11434/v1` and run entirely offline.

Try: *"Pace out a 4 metre square, then return to the origin and wave."*

## Extending it

The two extension points are deliberately the only things you need to understand.

**Add a robot skill** — one file in `src/sim/skills/`, then register it:

```ts
export const crouch: Skill<{ seconds: number }> = {
  name: 'crouch',
  description: 'Lower the robot into a crouch.',   // ← this text is the prompt
  schema: z.object({ seconds: z.number().min(0.5).max(10) }),
  async run(robot, { seconds }, ctx) {
    /* ... */
    return { ok: true, observation: `Crouched for ${seconds}s.` }
  }
}
```

Add it to `SKILLS` in `src/sim/skills/registry.ts`. The model can call it on the next message.
Its zod schema becomes the JSON Schema the model sees, and validates the arguments that come back.

**Add a model provider** — one file in `src/main/providers/` satisfying `ModelProvider`, then
register it in `registry.ts`. The engine never changes.

## Layout

```
src/
├── main/       Electron main — providers/ (network + keys), settings, IPC
├── preload/    the single bridge exposed to the renderer
├── renderer/   React UI — Viewport, Transcript, Settings
├── sim/        three.js + Rapier — World, Robot, skills/, observe
├── engine/     PlanEngine (agent loop), SkillQueue, prompt
└── shared/     the wire types both sides agree on
```

`sim/` and `engine/` import neither React nor Electron, which is what keeps them testable
headlessly.

## Roadmap

v0.1 is the loop. The reason the project exists is what comes after it.

- [x] **v0.1** — flat world, one humanoid, 5 skills, pluggable providers, live transcript
- [ ] **v0.2** — objects, obstacles, and grasping; a richer `Observation`
- [ ] **v0.3** — **scenarios and scoring**: fixed tasks, success criteria, and a leaderboard
      comparing models on the same embodied benchmark
- [ ] **v0.4** — vision input (render the robot's camera back to multimodal models)
- [ ] **v0.5** — recording and replay; deterministic reruns

## Contributing

Issues and PRs welcome — especially new skills and new providers, which are designed to be
one-file additions. This is a research toy; expect the interfaces to move.

## Licence

MIT — see [LICENSE](LICENSE).
