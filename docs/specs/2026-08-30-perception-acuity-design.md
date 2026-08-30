# Perception acuity — design

**Date:** 2026-08-30
**Status:** approved
**Follows:** [Objects and perception](2026-08-29-objects-and-perception-design.md)

## Problem

Sight is one flat number. `perceive()` gates every object on the same `config.range` of 8 metres,
so a 0.4m crate and a 3m lit beacon become visible at exactly the same distance — in a sector 52
metres across.

The cost is not subtle. `fetch-across-the-sector` puts a beacon at (18.5, -9) and says of it:

> The beacon is there to be navigated by: it is lit, so it reads through the haze from further
> than anything else.

That behaviour was never implemented. The beacon is invisible until the robot is within 8m of it,
by which point it is already standing on the crate the beacon was meant to lead it to. The
landmark's entire reason for existing is dead code, and the robot sweeps the map at random until
the cargo happens to fall inside its bubble. It looks stupid because it is being asked to navigate
with its eyes shut.

The same number gates `terrainSense`, so the robot is also blind to the shape of the ground past
8m — it cannot see high ground to head for, which is precisely what `reach-high-ground` asks it
to find.

## The decision

Replace the flat gate with **angular size**. A thing is visible when it is big enough, relative to
how far away it is, for the sensor to resolve.

One new profile field:

```ts
interface PerceptionSettings {
  range?: number
  halfAngleDeg?: number
  occlusion?: boolean
  /** How many metres away a 1-metre feature stays resolvable. */
  acuity?: number
}
```

`acuity: 20` reads as *"a 1-metre feature is resolvable at 20 metres."* The rule for objects is
then one line:

```
visible if distance <= largestDimension(w, h, d) * acuity
```

`range` stays, demoted from the gate to a **hard sensor cap** behind it — the furthest this sensor
resolves anything at all, however large. Its default rises from 8 to 45.

### Largest dimension, not footprint

The measure is `max(w, h, d)`, deliberately not the existing `footprintRadius`. That helper is
horizontal only, and a beacon is `[0.25, 3, 0.25]` against a crate's `[0.4, 0.4, 0.4]` — thinner
than the crate it is supposed to out-range. Keyed off the footprint, the fix makes the beacon
*less* visible than it is today. What makes a beacon conspicuous is that it is tall.

### Terrain uses the same number

Extending the terrain fan to 45m without further change would break a rule the observation depends
on. `NOTABLE_RISE` is a flat 0.6m; over 45m of rolling sector nearly every bearing finds something
that clears it, so the `Ground:` line would appear on every observation. From `sim/observe.ts`:

> Silence on flat ground is the point: the observation is resent every turn, so a line that always
> appears is paid for on every model call and stops being read.

So distance scales the threshold too:

```
threshold = max(NOTABLE_RISE, distance / acuity)
```

A 0.6m step at 3m is news. The same 0.6m rise at 30m is not, but a 5m hill at 30m is. This is the
same idea as the object rule rather than a second mechanism, which is the argument for one field
instead of two: acuity is the sensor's resolving power, and it applies to whatever the sensor is
pointed at.

## Calibration

20 is chosen so that **near-field behaviour is unchanged**: a 0.4m crate × 20 = 8m, today's range
to the metre. Nothing that works now starts working differently up close. What changes is only what
was previously impossible to see at all.

| Feature | Largest dimension | Visible to |
|---|---|---|
| block | 0.3m | 6m |
| crate | 0.4m | **8m — unchanged** |
| table | 1.6m | 32m |
| beacon | 3.0m | 45m (capped) |
| barrier | 12.0m | 45m (capped) |

Terrain keeps today's thresholds out to 12m, where the 0.6m floor stops dominating.

## Consequences for the built-in scenarios

- **`fetch-across-the-sector`** works as its comment always claimed. Occlusion still applies, so
  the beacon appears and vanishes as the robot crests hills — navigating by a landmark that comes
  and goes is better to watch than one permanently pinned to the observation.
- **`reach-high-ground`** gains the most: high ground becomes something the robot can see and head
  for rather than something it discovers by walking into it.
- **`behind-the-barrier`** shows its 12m barrier from across the yard. Finding it was never the
  task; routing round it still is, and the footprint that makes that solvable is unchanged.
- **`find-what-you-cannot-see`** is untouched. The crate is 0.4m, so it stays an 8m object, and the
  task remains what it was: a thing behind you that you have to turn around to find.
- **`crate-on-platform`, `clear-the-yard`, `up-on-the-gantry`** are near-field and unaffected.

## Risk

In the sandbox, scattered trees and boulders are large enough to be visible far, so `full` mode's
`Visible:` list will get longer. The fix if it turns noisy is a distance-sorted cap on how many
objects are named — not built here, because the sensible cap is not guessable before seeing the
lists it has to tame.

## Testing

Extends `sim/perception.test.ts`:

- a crate is visible at 8m and not at 9m — the calibration anchor, and the guarantee that this
  change is invisible up close
- a beacon at 30m is visible where a crate at 30m is not — the behaviour the whole change exists
  for, asserted as a difference between two objects rather than an absolute
- `range` still caps: nothing resolves beyond it however large
- terrain reports a distant hill but stays silent about a distant bump, and its near-field
  thresholds are unchanged

`acuity` reaches the model's configuration through `resolveProfile`, so it lands in
`fingerprint(resolved)` without further work and runs stay attributable.
