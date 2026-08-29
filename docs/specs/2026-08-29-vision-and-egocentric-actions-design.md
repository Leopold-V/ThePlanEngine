# v0.4 — Vision and egocentric actions

**Date:** 2026-08-29
**Status:** approved
**Follows:** [Objects and perception](2026-08-29-objects-and-perception-design.md)

## Why

The text observation does not scale. `Visible:` is bounded by the field of view, but `Remembered:`
grows without limit — every object ever seen, forever. In a large or procedurally generated world
that line explodes first, and no amount of trimming makes a text manifest the right shape for a
rich scene.

**An image is O(1) in world complexity; a text manifest is O(n).** That is the reason real robots
use cameras, and it is the reason vision belongs here.

## Two sensing modes, both realistic

Real robot sensing splits into proprioception (encoders, odometry, gripper state — always
available) and exteroception (cameras — meaningless until interpreted). Between the pixels and the
planner sits a perception stack.

| `observationDetail` | the robot is told | simulates |
|---|---|---|
| `full` (default) | pose, holding, visible objects, remembered objects | a classical stack: detection and SLAM feeding a planner |
| `proprioceptive` | pose and holding only | a VLA: the model does its own perceiving through `look()` |

A profile field, so it lands in the config fingerprint and *same model, same task, perception
stack versus its own eyes* becomes one comparison.

In `proprioceptive` mode the engine's world model is **not reported**. Memory moves into the
model's context — it has to remember what it saw. That is honest: the engine cannot know what the
model perceived from an image.

## Vision is an action

`look()` renders the robot's eye view and returns it as the tool result. Vision as a deliberate
act with a cost, rather than an image stapled to every turn — which would dominate both the
context and the bill. It also makes *did the model think to look?* a measurable behaviour.

Only frames the model asked for enter the history, and **older images are stripped**: beyond the
most recent few, an image is replaced by a text placeholder. Without that, a ten-step task carries
ten screenshots on every subsequent request.

## Labelled images, because pixels have no coordinates

Every movement skill takes absolute world coordinates, and those numbers currently come from the
text. Strip the text to proprioception and the model can *see* a block but cannot say where it is —
vision would fail for reasons that have nothing to do with perception.

Two changes fix it, and they compose:

- **Object ids are drawn into the rendered image** (set-of-mark prompting), giving the model
  referents it can name for things it can only see.
- **Egocentric skills**: `move_forward(metres)`, `approach(object)`, `face(object)`. Relative to
  the robot, so no absolute frame is needed — which is what a camera-driven robot actually has.

Both vocabularies coexist. `full` mode keeps coordinates and every existing scenario works
unchanged; `proprioceptive` mode leans on the egocentric set.

## Wire format

`SkillResult` and `ToolResultPart` gain an optional image. Adapters differ:

- **Anthropic** — a tool result's content may contain image blocks directly.
- **OpenAI-compatible** — `role: "tool"` messages accept only string content, so the image follows
  as a separate user message.
- **claude-cli** — the CLI takes text on stdin and cannot carry an image. It reports this rather
  than silently dropping the frame.

## Out of scope

Depth, camera intrinsics, multiple cameras, video, and models that output pixel coordinates.
