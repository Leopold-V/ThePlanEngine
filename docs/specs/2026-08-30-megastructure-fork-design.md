# The megastructure fork — design

**Date:** 2026-08-30
**Status:** approved
**Follows:** [Plan Engine MVP](2026-08-29-plan-engine-mvp.md), and everything since — this is the
last document the two projects share.

## Problem

The Plan Engine has reached the edge of what its framing asks for. The loop works, the world is a
volume, perception is honest, and the robot is worth watching — but the world is minimal because a
workbench only needs enough world to test against. Everything the robot might grow into — running,
arms that do more than carry, senses worth choosing between — depends on what the world demands of
it, and a test yard demands little.

The observation that forces the decision: the app has accidentally built the complete core of a
game it never intended. An operator on a comms link, guiding an autonomous machine through a space
seen only through its eyes — `look` is a photograph, `pov` is its head, `interject` cuts in
mid-action, and the belief map means the machine can be *wrong* about the dark around it. That is
a premise, and it already runs.

## The decision

**A hard fork.** A new repository, a new name, a game. The Plan Engine stays what it is — a
workbench for testing models as embodied agents — and does not carry a game's weight. The fork
turns the same engine toward being *played*.

The cost is accepted knowingly: the projects share their hardest code (`sim/`, `engine/`), and
fixes there will no longer flow between them for free. The alternative — one repo, two surfaces —
was considered and declined. The game is expected to diverge drastically: its sim will grow
mechanics a benchmark must never have (wear, power, damage, weather), and its engine will bend the
observation rules that keep the workbench honest. Divergence is the point of the fork, not its
failure mode. If a fix matters to both, it is cherry-picked by hand, eyes open.

The fork begins as a clone, so it inherits the full history and every rule in CLAUDE.md that is
about physics, perception and honesty — those survive because they are what makes the robot feel
real, not because a benchmark needs them.

## The world: a structure, not a landscape

BLAME! is the reference: a megastructure — vast, vertical, mostly empty, *built* rather than
eroded, extended forever by builders following rules nobody remembers the reason for. Blade
Runner's neon arrives later as rare lit sectors, not as a city.

This lands on ground the engine already prepared:

- The voxel volume was adopted because caves, overhangs and interiors were unrepresentable on a
  heightfield. A megastructure is interiors all the way down. The one representation decision the
  game needs was made a month ago, for other reasons.
- The measured finding that *smooth noise quantised into blocks does not make cliffs* — that
  verticality has to be built — is not a limitation here, it is the aesthetic. The generator the
  game needs is a **builder grammar**, not better noise: floors, shafts, girders, catwalks,
  stairwells, voids that take minutes to cross, placed by rules that read as intention.
- Sectors are seeded like everything else. A sector id regenerates the identical sector, so the
  world stays a small document and a place can be returned to. Scenario pinning becomes chapter
  pinning, unchanged.

The terrain noise is kept and demoted: rock is what the structure was built *through*, revealed
where the structure fails. A cave in the noise breaking into a machined shaft is the world's
whole story told in one geometry seam.

## The loop: an operator on a noisy link

The player is not the robot. The player is the voice in its head — the current triangle, made
diegetic. You type or speak; the machine plans, walks, misreads, and reports back. The model's
confusion is in-fiction: a companion being confused in the dark, not a bug. `interject` is the
core verb it always was.

This is deliberately mostly *framing*, not systems. The transcript becomes the comms log; the
HUD's bubbles become the link; the photo `look` returns becomes the only ground truth the operator
ever gets. What the workbench called a test of the model, the game calls trusting your machine.

## The second body: free roam

A keyboard-driven body for exploring directly — walk, jump, look. It is not the game loop; it is
a scout and a physics instrument, and it must drive the **same capsule, the same `stepAhead`, the
same jump budget** as the robot. That identity is the point: walking a sector yourself is a live
test of what the robot can traverse, and a mistuned step height is felt in seconds where a
transcript hides it. A separate controller that could drift from the robot's locomotion would be
worse than none.

## Purpose: the dérive first, the climb later

v1 imposes no goal. Explore, photograph, survey; the belief map doubles as the atlas the player is
drawing. The known risk — pure exploration goes slack without generation variety to carry it — is
accepted for v1 and answered by the sequel decision already made: a standing destination in the
BLAME! mould (something far above, or far below), crossed sector by sector. A dérive that gains a
destination *is* the long climb, so nothing built for the first is discarded by the second. The
existing scenario/criteria machinery becomes chapter structure when that lands.

## Explicitly out of scope for v1

NPCs, dialogue, combat, inventory, upgrades, survival meters. Each returns only when the world
makes it necessary, as its own spec. The upgrade axis in particular already has a reserved seat —
hardware-as-a-profile-choice — and should arrive through that door or not at all.

## Build order

1. **Fork.** Commit the pending work, clone, rename, strip the scenario-runner UI to a shelf (not
   deleted — the criteria engine is the future chapter system).
2. **The builder grammar, alone.** Headlessly testable like all worldgen. Nothing else has
   anywhere to live until sectors exist that are worth being lost in.
3. **The free-roam body**, which is also how sectors get judged during 2.
4. **The operator loop reframed** — comms-log transcript, link fiction, sector traversal.
5. **The dérive** — surveying, the atlas, sector persistence across a session.

## Testing

The engine's seams survive the fork: worldgen is asserted headlessly (reachability by flood-fill,
as `reach-high-ground` already does), locomotion by the existing step/jump tests, the loop through
the injected `send`. The grammar gets the same treatment terrain got: properties proven in tests
— connectivity, traversability, density bounds — not screenshots eyeballed.
