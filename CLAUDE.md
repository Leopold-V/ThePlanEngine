# The Plan Engine — Claude instructions

Electron desktop app for testing AI models as embodied agents: a model receives an instruction,
decomposes it into robot skills, and a humanoid executes them in a three.js + Rapier simulation.

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

## Verify before claiming done

```bash
npm run typecheck
```

There is no test suite yet (deliberate for v0.1). `PlanEngine` takes `send` by injection, so when
tests arrive a mock provider can drive the whole loop without a key, network, or GPU — preserve
that seam.
