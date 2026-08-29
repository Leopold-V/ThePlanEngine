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

The model never touches joint angles. It plans in terms of **skills** — `walk_to`, `turn` and
`look_at` in world coordinates, `move_forward`, `approach`, `face` and `jump` relative to itself,
`scan` and `look` to sense, `pick_up`, `put_down`, `wave` and `say` — and the simulation solves the
motion. That keeps the variable under test on the planning side, where the interesting differences
between models actually are.

### The world

The ground is generated from a seed, not hand-placed. A scene document is four numbers —

```ts
generate: { seed: 1337, halfExtent: 30, hilliness: 1, density: 1.1 }
```

— and those four rebuild the identical landscape, with the same crate under the same hill, on any
machine. That is what lets a scenario stay a small readable document while the world it describes
is a 60m landscape, and what keeps a result attributable to a world you can regenerate rather than
one that happened to be on disk.

Generated or hand-written, the two collapse to the same `ObjectSpec[]` before anything sees them,
so perception, scoring and the snapshot cannot tell which they were handed.

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

### Navigation

There is no navmesh and no A*. Both would let the robot path neatly around a boulder it has never
seen, which would quietly undo the field of view, the belief map and the whole of proprioceptive
mode. So it steers instead, from the objects it has actually had in view, probing the ground only
a step ahead — what feet and an IMU give you for free.

The trade is deliberate and it shows: a robot that charges off blind has an empty map and walks
into things, and one that has looked around moves smoothly through them. Navigation quality
follows perception quality. Local steering also cannot escape a concave trap, and is not meant to
— it reports what stopped it and the model replans.

```
Arrived at (0.05, 10.78). Went around boulder_1, boulder_2, boulder_4 on the way.
Blocked 7.23m short of the target — stopped making progress. boulder_1 is 0.0m away.
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

## Scenarios

A scenario is a task plus a way to tell whether the robot did it — a scene, a goal handed to the
model verbatim, and success criteria checked against world state when the run ends:

```ts
criteria: [
  { type: 'object_on', object: 'red_block', surface: 'table' },
  { type: 'holding', object: null }
]
```

Criteria are **data predicates**, not code and not an LLM judge, so a score is deterministic, free
to compute, and reproducible from the document alone. Every result carries a reason rather than a
bare boolean — *"red_block is at (2.1, 3.0), outside the table footprint"*.

Each run is recorded with its scenario, model, step count, transcript, and the **config
fingerprint** of the robot profile that produced it. Results group by *(scenario, config, model)*
so a pass rate accumulates: models are stochastic, and one run is an anecdote.

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
- [x] **v0.3** — scenarios with data-predicate success criteria, run records carrying the config
      fingerprint, and pass rates grouped by scenario, configuration and model
- [x] **v0.4** — vision: a `look()` skill returning a labelled camera frame, egocentric actions,
      and a proprioceptive sensing mode where objects must be found rather than listed
- [x] **v0.5** — a robot worth watching: a camera that follows, first person through its own eyes,
      speech above its head, the photo it just took, and motion with weight
- [x] **v0.6** — a generated world: seeded procedural terrain and props, slopes the robot walks
      over, elevation in what it senses, and locomotion that says what blocked it
- [x] **v0.7** — navigation from the belief map: steering around what it has actually seen,
      slope avoidance by local probing, and arrivals that name what they went around
- [x] **v0.7.1** — the sensors move into the head: a glance turns the neck, not the whole body,
      and the camera and field of view follow it
- [ ] **v0.8** — talking to it mid-task: interrupt and redirect a run in progress
- [ ] **v0.9** — recording and replay; deterministic reruns
- [ ] **later** — hardware as a configuration: the sensor loadout becomes a profile choice —
      head camera, 360° lidar, mounting and field of view — so what the robot is *built from* is
      a variable rather than a constant

## Contributing

Issues and PRs welcome — especially new skills and new providers, which are designed to be
one-file additions. This is a research toy; expect the interfaces to move.

## Licence

MIT — see [LICENSE](LICENSE).
