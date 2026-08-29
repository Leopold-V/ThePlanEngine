# v0.2 — Objects, perception, and manipulation

**Date:** 2026-08-29
**Status:** approved
**Follows:** [MVP design](2026-08-29-plan-engine-mvp.md), [Robot profiles](2026-08-29-robot-profile-design.md)

## Goal

Give the world things to interact with, and give the robot a realistic way to know about them.
Until now the robot's entire perception was `Robot is at (x, z) facing N°.` — there was nothing to
perceive.

## The perception stack

Real robot software separates sensing, mapping, and planning. The LLM here is the **planner**, not
the perception stack, so it queries a map rather than maintaining one.

```
FOV sensing   sim/perception.ts    what is visible right now (with occlusion)
     ↓
world model   sim/WorldModel.ts    persistent beliefs, with staleness
     ↓
observation   sim/observe.ts       serialized for the planner
     ↓
the LLM                            decides what to do
```

### Field of view

A cone: `range` metres, `±halfAngle` from the robot's heading. Occlusion is a Rapier raycast from
eye height to each candidate's centre — a block behind a table is not seen. One ray per candidate,
which is cheap at this scale and is the realistic answer.

All three parameters live on the robot profile, so they land in the config fingerprint and
"how much does this model degrade with a narrower field of view" becomes a measurable experiment.

### The world model is allowed to be wrong

Objects are remembered once seen — object permanence is fundamental robotics, and a robot that
forgets the table when it turns around is amnesiac rather than realistic. Each belief records
where the object was and when it was last seen.

Critically, beliefs are **not** corrected while unobserved. If something moves out of view, the
robot's belief stays stale until it looks again. That is genuine belief error, and it is the
interesting middle ground between omniscience and amnesia.

### Observation format

```
Robot at (2.7, 1.8) facing 59°. Holding: nothing.
Visible: red_block at (4.1, 3.2) — 1.7m, ahead-left; table at (6.0, 0.0) — 4.2m, ahead-right.
Remembered: blue_block at (-3.0, 2.0), last seen 40s ago.
```

World coordinates for the map, plus egocentric distance and bearing for what is in view — a robot
senses relative and maps absolute, so it gets both.

## Objects

Rapier **dynamic** rigid bodies, so they fall, stack, and can be knocked over. Declared as data:

```ts
interface ObjectSpec {
  id: string          // 'red_block' — this is the handle the model uses
  kind: 'block' | 'table' | 'marker'
  color: number
  size: [number, number, number]
  position: [number, number, number]
  graspable: boolean
  mass: number
}
```

A `SceneDefinition` holds a list of them. There is one default scene now, but it is data rather
than construction code because that is the seam v0.3 scenarios plug into: a scenario is a scene
plus a goal plus success criteria.

## Manipulation

`pick_up(object)`, `put_down(x, z)`, and `scan()`.

**Kinematic carry.** On pick-up the object's body becomes kinematic and is driven to a carry
anchor in front of the robot's chest each frame; on release it returns to dynamic and falls. It
still collides with and pushes the world, and stacking works because `put_down` releases at carry
height and lets physics settle it. It cannot be knocked out of the hand — the accepted cost of
keeping joint solving out of the critical path.

`pick_up` does **not** walk to the object. Navigation and manipulation stay separate skills, as on
a real robot, so the model has to sequence them — which is the thing being tested.

`scan` sweeps 360° over a few seconds and reports everything seen. Robots sweep their sensors, and
without it a narrow FOV is punishing rather than interesting.

## Preconditions

`Skill` gains the optional `check` the MVP spec left room for:

```ts
check?(robot: Robot, params: P, world: WorldView): string | null
```

Returning a string fails the call with that message before `run` is entered, so the model is told
*"cannot pick up red_block: it is 3.2m away, reach is 1.0m"* rather than watching an action fail
for no stated reason. `SkillQueue` enforces it — skills stay unable to throw at the caller.

## Components

| Unit | Responsibility |
|---|---|
| `sim/objects.ts` | `WorldObject`, `ObjectSpec`, `SceneDefinition`, `DEFAULT_SCENE` |
| `sim/perception.ts` | FOV + occlusion → sightings |
| `sim/WorldModel.ts` | Persistent beliefs and staleness |
| `sim/observe.ts` | Serialize robot state + beliefs for the planner |
| `sim/skills/pickUp.ts`, `putDown.ts`, `scan.ts` | Manipulation and sensing |

## Out of scope

Pushing objects deliberately, two-handed carry, articulated grasp targets, object properties the
robot must inspect to learn, and moving/animate obstacles.
