# Robot Profiles — design

**Date:** 2026-08-29
**Status:** approved
**Follows:** [MVP design](2026-08-29-plan-engine-mvp.md)

## Problem

There is no way to see what the model actually receives, and no way to change it without editing
code. The obvious fix — a settings panel with editable tool descriptions — does not survive
contact with v0.3, where results from different models and prompts get compared. A benchmark
number is meaningless unless you can say exactly which configuration produced it.

## The decision

The robot's capability definition is a **first-class serializable document**, not app settings.
The editor panel is a view onto it.

```ts
interface RobotProfile {
  id: string
  name: string
  revision: number
  /** undefined = use the system prompt defined in code. */
  systemPrompt?: string
  /** Sparse: keyed by skill name, absent means "code default, enabled". */
  skills: Record<string, SkillOverride>
  maxIterations?: number
}

interface SkillOverride {
  enabled?: boolean
  description?: string
}
```

### Stored sparse, resolved and fingerprinted at run time

Both halves are needed, at different moments:

- **Sparse storage.** A profile references skills by name and stores only the fields actually
  changed. Skill *behavior* is TypeScript driving Rapier and cannot be serialized, so a profile
  can only ever override the prompt-facing surface. Sparse means improving a description in code
  reaches every profile that did not explicitly override that field — no stale copies drifting
  from source. An empty `skills: {}` is exactly the code defaults.
- **Resolution at run time.** On each run, `profile + code registry → ResolvedConfig`: the literal
  system prompt and tool schemas the model receives. That resolved object is hashed (SHA-256,
  truncated) and stamped on the run.

The live document tracks code improvements; every result carries a fingerprint of what produced
it. This is what makes v0.3 scoring reproducible rather than anecdotal, at close to the cost of
plain overrides.

### Orphan and new skills

The code registry is the source of truth for *which* skills exist. A profile key naming a skill
that no longer exists resolves away silently. A skill added in code appears immediately, enabled,
with no profile change needed.

## Components

| Unit | Responsibility |
|---|---|
| `shared/profile.ts` | The document type and `DEFAULT_PROFILE` |
| `engine/resolveProfile.ts` | `resolve(profile, skills)` → `ResolvedConfig`; `fingerprint(config)` |
| `main/profile.ts` | Load/save to `userData/profile.json`, merge-on-read |
| `renderer/components/RobotPanel.tsx` | Full-screen editor: Skills / Context / Preview |

`resolveProfile` is pure and takes the skill list as a parameter, so it is testable without a
world, a renderer, or a model.

## The panel

Full-screen overlay — the 400px sidebar is too cramped to edit prompts in. Three tabs:

1. **Skills** — every skill grouped by category, enable/disable, override badge. Detail pane edits
   the description against the code default, with per-field Reset. The JSON Schema is shown
   read-only: it is generated from the zod schema, which is the single source of truth.
2. **Context** — the system prompt and iteration cap.
3. **Preview** — the fully resolved system prompt and tool block, verbatim, plus the fingerprint.
   This is the highest-value tab and nearly free once the resolver exists: it is the only place
   the exact model input is visible, and each provider assembles it differently.

## Designed for, not built now

`Skill` gains `category` now. It should later accept `preconditions` and `effects` without a
breaking change — once v0.2 adds objects and grasping, "you cannot grasp what you are not near"
becomes something the engine can tell the model instead of letting it fail blindly.

Named profiles are deliberately deferred. The document already carries `id` and `name`, so
multiple profiles are list UI rather than a data-model change; building that now would be guessing
at how comparison should work before scoring exists.

## Out of scope

Composite skills, profile import/export, named profile management, preconditions/effects.
