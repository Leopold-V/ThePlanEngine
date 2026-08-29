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
`look_at`, `scan`, `pick_up`, `put_down`, `wave`, `say` — and the simulation solves the motion.
That keeps the variable under test on the planning side, where the interesting differences
between models actually are.

### Perception

The robot has a **field of view**, not omniscience. It sees what is in front of it, within range,
and not hidden behind something else — and it remembers what it has seen. Those beliefs are
deliberately never corrected while an object is out of view, so the robot can be *wrong* about
where something is until it looks again. Range, field of view, and occlusion are profile fields,
so "how much does this model degrade with a narrower field of view" is a measurable experiment.

```
Robot at (1.98, 1.19) facing 46°. Holding: red_block.
Visible: table at (5, 1) — 3.0m to the right.
Remembered: blue_block at (-4, 2), last seen 2s ago; green_block at (-2, -5), last seen 3s ago.
```

## Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron | Model calls run in the Node main process: no CORS, no API key in the renderer |
| UI | React + TypeScript + Vite | via `electron-vite` |
| Rendering | three.js | |
| Physics | Rapier (`@dimforge/rapier3d-compat`) | Owns the world; the robot uses a kinematic character controller rather than a ragdoll, so balance is never the thing that fails |

## Providers

Three adapters cover everything:

- **`claude-cli`** — drives your locally installed **Claude Code**, so it runs on your existing
  Claude Code login. **No API key.** This is the default.
- **`anthropic`** — Claude via the API. Uses a pasted key, or falls back to `ANTHROPIC_API_KEY`
  or an `ant auth login` profile if you leave the field blank.
- **`openai-compatible`** — OpenAI, **xAI Grok**, **Ollama**, LM Studio, Together, Hugging Face
  router, vLLM. Only `baseURL` differs, which is why there is no separate adapter for any of them.

Local models need no key at all. Hosted keys are encrypted with your OS keychain via Electron
`safeStorage` and never reach the renderer process.

### How the Claude Code provider works

Claude Code has no flag for custom tool schemas, so tool calling is done by contract: the schemas
go into the system prompt and the model is asked for a single JSON object. That keeps it inside
the normal `ModelProvider` interface — the engine and the skills are untouched.

It is invoked with hard isolation, and those flags are not optional:

```
--tools "" --strict-mcp-config --setting-sources ""
```

Without them Claude Code loads your plugins, skills and MCP servers into *every* call. Measured on
one trivial instruction: **110k tokens and 16s** versus **0 tokens and 5s** with them — and it
tried to call an unrelated MCP server mid-run. `--bare` looks like the right flag here and is not:
it forces auth to `ANTHROPIC_API_KEY` and never reads the OAuth login, defeating the whole point.

Expect ~5-9s per model call from process startup. Fine for a robot sim, not for a chat UI.

> **Note on usage:** this drives Claude Code on your own machine, which is fine for local
> development and testing. It is not a way to resell or share subscription access, and the
> API providers above exist for anything beyond personal use.

## Running it

```bash
npm install
```

```bash
npm run dev
```

If you already use Claude Code, it should work with **no setup at all** — the default provider
finds your installation and uses your existing login. Otherwise open **Settings** and pick a
provider.

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
- [x] **v0.1.5** — robot profiles: edit the skills, descriptions and context the model sees,
      with a config fingerprint stamped on every run
- [x] **v0.2** — objects, field-of-view perception with occlusion, a persistent world model, and
      grasping
- [ ] **v0.3** — **scenarios and scoring**: fixed tasks, success criteria, and a leaderboard
      comparing models on the same embodied benchmark
- [ ] **v0.4** — vision input (render the robot's camera back to multimodal models)
- [ ] **v0.5** — recording and replay; deterministic reruns

## Contributing

Issues and PRs welcome — especially new skills and new providers, which are designed to be
one-file additions. This is a research toy; expect the interfaces to move.

## Licence

MIT — see [LICENSE](LICENSE).
