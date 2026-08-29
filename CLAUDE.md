# The Plan Engine — Claude instructions

Electron desktop app where a model receives an instruction, decomposes it into robot skills, and a
humanoid executes them in a three.js + Rapier simulation.

**It is a toy, not a benchmark.** The point is that giving a robot instructions, talking to it, and
watching it move through a world is fun. Scoring exists so a task can have a win condition, and
model choice exists because swapping brains is the interesting part — neither is there to produce
a research table. When weighing what to build, favour what is enjoyable to watch and to talk to
over what is measurable.

Design spec: [docs/specs/2026-08-29-plan-engine-mvp.md](docs/specs/2026-08-29-plan-engine-mvp.md).

## Layer boundaries — do not cross these

| Layer | Owns | Must never import |
|---|---|---|
| `src/main/` | Network calls, API keys, settings on disk, IPC | React, three.js, Rapier |
| `src/preload/` | The single `contextBridge` surface | anything else |
| `src/renderer/` | React UI | vendor SDKs, `electron` |
| `src/sim/` | three.js scene, Rapier world, `Robot`, skills | React, `electron` |
| `src/engine/` | The agent loop | React, `electron`, three.js internals |
| `src/shared/` | Wire types both processes agree on | everything |

`sim/` and `engine/` staying free of React and Electron is what keeps them testable headlessly.
If a change would introduce one of those imports, the design is wrong — say so.

**API keys never reach the renderer.** The renderer sees the `STORED_KEY` sentinel. Model HTTP
calls happen only in `src/main/providers/`.

**Never pass an empty-string `apiKey` to a vendor SDK.** It is not the same as omitting it — an
empty string wins its precedence slot and authenticates as an empty key, shadowing
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and any `ant auth login` profile. Spread the key in
conditionally.

## The Claude Code provider (`claude-cli`)

Spawns the local Claude Code binary so the app runs on an existing login instead of an API key.
Two things about it are load-bearing and easy to break:

- **The isolation flags are mandatory:** `--tools "" --strict-mcp-config --setting-sources ""`.
  Without them Claude Code loads the user's plugins, skills, and MCP servers into every call —
  measured at 110k tokens / 16s versus 0 / 5s, and it will try to call unrelated MCP tools.
- **Do not use `--bare`.** It looks ideal (skips hooks, plugins, CLAUDE.md discovery) but forces
  auth to `ANTHROPIC_API_KEY` and never reads the OAuth login, which defeats the provider.

On Windows only the npm shims are on PATH; the executable is at
`<path-dir>/node_modules/@anthropic-ai/claude-code/bin/claude.exe`. Spawn that directly with
`shell: false` — Node refuses to spawn the `.cmd` without a shell (EINVAL), and enabling the shell
would put a multi-line system prompt through cmd.exe parsing.

## Robot profiles — the configuration contract

`shared/profile.ts` defines the robot's capability definition as a serializable document, not app
settings. See [the spec](docs/specs/2026-08-29-robot-profile-design.md). Two rules keep it honest:

- **Stored sparse, resolved at run time.** A profile stores only the fields actually changed;
  `engine/resolveProfile.ts` merges it with the code registry to produce the literal system prompt
  and tool schemas the model receives. An absent key means "code default, enabled", so `skills: {}`
  is exactly the code defaults. Never write a full snapshot back into the profile — that breaks the
  property that improving a description in code reaches every profile.
- **The code registry decides which skills exist**, not the profile. Orphan keys resolve away; a
  new skill appears immediately, enabled.

Every run emits its `fingerprint(resolved)` into the transcript. That is the provenance record
v0.3 scoring will hang off, so anything that changes what the model sees must go through
`resolveProfile` — otherwise the fingerprint lies.

Settings hold *how to reach a model*; the profile holds *what the model is asked*. Do not add
prompt- or capability-affecting fields to `Settings`.

**Planned: hardware as a profile choice.** `perception` (range, field of view, occlusion) is the
seed of a larger idea — that what the robot is *built from* should be a variable, not a constant.
A head camera with a human-like cone is one loadout; a 360° lidar on the head is another, and a
real one: Unitree ship the G1 and H1 with exactly that, while Figure and Optimus are deliberately
camera-only. Picking between them is a design decision worth exposing rather than baking in.
Extend `perception` into a sensor loadout when this lands — do not add a parallel concept, and do
not make a wide sensor the default, because a 360° sensor quietly deletes the perception problem
the app exists to pose.

## The two extension points

Adding either should touch exactly two files. If a change requires editing `PlanEngine`, that is a
signal the abstraction is leaking — flag it rather than working around it.

- **New robot skill** → one file in `src/sim/skills/` + a line in `registry.ts`
- **New model provider** → one file in `src/main/providers/` + a line in `registry.ts`

A skill's `description` is prompt text the model reads to decide when to call it. Write it as
instructions to the model, not as a code comment. Its zod schema is the single source of truth:
it generates the JSON Schema sent to the model *and* validates the arguments that come back.

## Rules of the loop

- **Skills never throw to the caller.** Failures return `{ ok: false, observation }` so the model
  can read what went wrong and replan. `SkillQueue` catches anything that escapes.
- **Skills run serially.** The robot has one body.
- **Every skill needs a timeout.** Use `until(ctx, seconds, fn)`; an unbounded loop hangs the run.
- **Skills yield with `await ctx.nextFrame()`**, which resumes on the world's fixed 60Hz step.
  Never busy-wait, and always honour `ctx.signal` — `nextFrame` throws `AbortedError` on Stop.
- **`observe.describe()` is resent every turn**, so keep it to one short line. Verbosity there is
  paid for on every model call.

## Conventions

- TypeScript strict. No `any` outside the deliberately-loose `SKILLS` array.
- Path aliases: `@shared/*`, `@sim/*`, `@engine/*`, `@ui/*`. Use them; no deep relative paths.
- ESM throughout — include the `.js` extension in relative imports.
- Coordinates in metres. X left-right, Z forward-back, origin at centre, valid range ±24.
  Heading in radians internally, degrees at every boundary the model sees.
- Model IDs live in `src/shared/defaults.ts`. Do not hardcode them elsewhere.

## Vision and sensing modes

`observationDetail` on the profile decides how much the robot is told without looking:

- `full` — pose, grip, visible and remembered objects. A classical detection-and-mapping stack
  feeding a planner. Default; every existing scenario relies on it.
- `proprioceptive` — pose and grip only, which is what encoders and a gripper sensor give for
  free. Objects must be found with `look`, and memory lives in the model's context rather than the
  engine's world model. This is what a VLA actually gets, and the only mode that scales: a text
  manifest grows with the world, an image does not.

Rules that are easy to break:

- **The sensors are in the head, not the chest.** `robot.sensorHeading` is body heading plus neck
  angle, and perception, `CameraView` and the first-person camera all use it. Never decide what
  can be seen from `robot.heading` — that was how it worked once, and the robot visibly turned its
  head toward things it was not sensing with. The neck reaches ±70° and deliberately has no pitch,
  because perception is a horizontal cone with no vertical limit and a tilted camera would show
  what the field of view does not cull.
- **A glance is not a turn.** `look(direction)` aims the neck without moving the feet, and returns
  it to centre before finishing — waited out, not fired and forgotten, since the observation that
  follows reports the neck angle. Turning the whole body to look around is what `scan` is for, and
  it should stay the expensive option.
- **`look` returns a labelled image.** Object ids are drawn into the frame because every
  coordinate skill needs numbers the model cannot get from pixels — the labels are what make
  `approach(red_block)` possible from vision alone. Do not remove them.
- **Two action vocabularies coexist.** `walk_to`/`put_down` take absolute coordinates and suit
  `full` mode; `move_forward`/`approach`/`face` are egocentric and suit vision. Adding a
  coordinate-only skill makes the robot less usable in `proprioceptive` mode.
- **The camera hides the debug overlay and the robot's own mesh**, but not a carried object — you
  do see what you are holding.
- **Images are stripped from old history** (`IMAGE_HISTORY` in `PlanEngine`). History is resent
  every turn, so without it a ten-step task carries ten screenshots on every request.
- Providers differ: Anthropic takes an image inside a tool result, OpenAI-compatible needs a
  following user message, and `claude-cli` cannot carry one at all and says so.

## The show layer

`CameraRig`, `Hud` and the animation half of `Robot` exist so the simulation is watchable. Three
things there are load-bearing:

- **Anything rendered from inside the head goes through `World.fromInsideTheHead`.** Both the
  `look` photo and the live `pov` camera sit inside the robot's own mesh, with the field-of-view
  wedge across the lens. They share one helper so the two cannot drift apart — this bug has now
  been fixed twice.
- **`Hud` styles itself inline and owns its own DOM.** No stylesheet dependency, so `sim/` stays
  droppable into any host page. It also must not wait on `requestAnimationFrame` to start a
  transition: a bubble raised while the loop is paused would never appear.
- **Framing runs on the frame delta, not the fixed step.** Camera work is direction, not
  simulation, and stays smooth however physics is pacing.

Animation never touches the collider. Lean, bank, crouch and gaze are mesh rotations only, so
nothing cosmetic can push the robot around or trip it.

The camera takes a `CameraSubject` per frame and the HUD keys bubbles by owner, so pointing either
at a second robot with a different model is an argument rather than a rewrite.

## The world is generated, not enumerated

A scene document is either an object list or a `WorldGenSpec` — never both — and
`resolveScene` in `shared/worldgen.ts` collapses the two before anything downstream sees them.
Keep it that way: perception, criteria and the snapshot must stay unable to tell a generated world
from a hand-written one, which is what let terrain land without touching any of them.

- **Never store generated contents back into a scene.** The spec is the document; the landscape is
  derived. Same reason profiles are sparse — a scenario has to stay small and reproducible, and a
  50m landscape is ten thousand numbers.
- **Rapier's heightfield rows run along z, columns along x** — the transpose of the obvious
  reading. Getting it backwards yields a landscape that looks entirely plausible and is mirrored
  about the diagonal relative to its own collider, so the robot walks into invisible hills. This
  is pinned by `Terrain.test.ts`, which raycasts the collider and compares; it is verified, not
  reasoned about.
- **`sampledHeightAt` approximates the collider, it does not match it.** Rapier triangulates each
  cell while it interpolates bilinearly — a few centimetres apart inside a cell. Anything placed
  on the ground is dropped from slightly above and left to settle.
- **Ask `world.groundHeightAt(x, z)`; never assume zero.** `robot.teleport` takes the ground
  height for this reason.
- Criteria are all *relative* — an object's base against a named surface's top, horizontal
  distances — so non-flat ground does not affect scoring. Keep new predicates relative too.

## Navigation steers, it does not plan

`sim/steering.ts`. The rules here are what keep it honest rather than merely effective:

- **Obstacles come from `world.model` (beliefs), never `world.objects` (truth).** A navmesh over
  the whole world would let the robot route around something it has never seen, which contradicts
  the field of view, the belief map and proprioceptive mode. If a change needs ground truth to
  navigate, it is the wrong change.
- **Ground is probed one step ahead and no further.** Feeling the slope you are about to step on
  is proprioception; querying distant ground is sight, and sight is earned with `look`.
- **Directional sampling, not a repulsion field.** A repulsion vector from an obstacle dead ahead
  is exactly opposite the seek vector; they cancel and the robot walks calmly into it. Scoring
  discrete candidate headings has no such degenerate case.
- **`avoiding` names what blocks the straight line**, not what the chosen heading hits — the
  chosen heading is by definition the clear one, so reading it there reports nothing on every
  successful detour.
- **A concave trap defeats it, and should.** The stall detector reports and the model replans;
  that is the loop the app exists to exercise.
- `move_forward` deliberately does *not* steer. It is the egocentric primitive and its contract is
  a straight line.

## Scenarios and scoring

A scenario is a document (`shared/scenario.ts`): scene, goal, and success criteria. Criteria are
**data predicates** evaluated by `engine/criteria.ts` — a pure function over a plain
`WorldSnapshot`, with no three.js, Rapier or renderer. Keep it that way; the entire score rests on
it and it is the best-tested code in the project.

- **Every criterion result carries a reason**, not just a boolean. A score you cannot diagnose is
  not evidence. Same rule as precondition messages and the belief inspector.
- **Criteria are checked against world state**, never against what the model claimed it did.
- Adding a predicate means extending the `Criterion` union, `evaluateOne`, `describeCriterion` in
  the panel, and its tests. Keep the vocabulary small.
- Run records store the **config fingerprint**, so results stay attributable to a configuration.
  Anything that changes what the model sees must go through `resolveProfile` or the fingerprint
  lies.

## Verify before claiming done

```bash
npm run typecheck && npm test
```

**Driving the simulation without a model.** `planEngineDebug.engine.runSkill('walk_to', {x:3, z:2})`
and `planEngineDebug.world` are exposed in dev builds. Use them — verifying the sim costs no tokens
and no subscription usage, and it is how both v0.2 bugs were found.

**The render loop drives physics**, so anything that stops `requestAnimationFrame` stops the
simulation. Electron sets `backgroundThrottling: false` for this reason. A headless browser tab
still throttles though: sim time advances ~0.12s per real second when `document.hidden`, so a
4-second skill takes over half a minute and looks like a hang. To test perception without the loop,
force a synchronous update with `world.setPerception(world.view().perception)`.

There is no test suite yet (deliberate for v0.1). `PlanEngine` takes `send` by injection, so when
tests arrive a mock provider can drive the whole loop without a key, network, or GPU — preserve
that seam.
