import type { ObjectKind } from './objects.js'
import type { Sighting } from './perception.js'

export interface Belief {
  /**
   * The simulation's handle for the object. Not exposed to the model until the
   * thing has actually been recognised — read `label` instead.
   */
  id: string
  kind: ObjectKind
  /** Where the robot last saw it — not where it necessarily is now. */
  x: number
  z: number
  /** Horizontal half-extents as last seen. What navigation steers around. */
  halfX: number
  halfZ: number
  /** Simulation seconds when the belief was last confirmed. */
  lastSeenAt: number
  /** True when the object is in view at this instant. */
  visible: boolean
  /** True once a camera has been pointed at it and told the robot what it is. */
  identified: boolean
  /**
   * The anonymous handle it was given on first detection, like `unknown_3`.
   *
   * Kept for good, even after the thing is recognised: the model may still be
   * carrying "walk to unknown_3" in its own context from an earlier turn, and
   * that reference has to keep resolving to the same object.
   */
  handle: string
  /** What the model calls it: the real id once recognised, otherwise the handle. */
  label: string
}

/**
 * The robot's persistent map. Object permanence is fundamental robotics — a
 * robot that forgets the table when it turns around is amnesiac, not realistic.
 *
 * Beliefs are deliberately NOT corrected while unobserved. If an object moves
 * out of view, the robot goes on believing the stale position until it looks
 * again. That belief error is the interesting middle ground between omniscience
 * and amnesia, and it is what real robots actually deal with.
 *
 * Detection and recognition are separate events here. Sensing something puts
 * geometry on the map; learning what it is takes a camera. Internally the map
 * is keyed by the simulation's object id, which stands in for a tracker with
 * perfect data association — a simplification, but the robot's *knowledge* is
 * what `label` exposes, not how the store is indexed.
 */
export class WorldModel {
  private readonly beliefs = new Map<string, Belief>()
  private anonymous = 0

  /** Folds the current sightings in, and marks everything else out of view. */
  update(sightings: Sighting[], now: number): void {
    for (const belief of this.beliefs.values()) belief.visible = false

    for (const sighting of sightings) {
      const existing = this.beliefs.get(sighting.id)
      if (existing) {
        existing.x = sighting.position.x
        existing.z = sighting.position.z
        existing.halfX = sighting.halfX
        existing.halfZ = sighting.halfZ
        existing.lastSeenAt = now
        existing.visible = true
        continue
      }

      this.anonymous++
      const handle = `unknown_${this.anonymous}`
      this.beliefs.set(sighting.id, {
        id: sighting.id,
        kind: sighting.kind,
        x: sighting.position.x,
        z: sighting.position.z,
        halfX: sighting.halfX,
        halfZ: sighting.halfZ,
        lastSeenAt: now,
        visible: true,
        identified: false,
        handle,
        label: handle
      })
    }
  }

  /**
   * Names things the camera has just seen. Everything else about them is
   * already on the map; this is the step that turns "something is there" into
   * "that is crate_2", and only a camera can take it.
   */
  recognise(ids: Iterable<string>): void {
    for (const id of ids) {
      const belief = this.beliefs.get(id)
      if (!belief || belief.identified) continue
      belief.identified = true
      belief.label = belief.id
    }
  }

  /** Everything the robot believes exists, most recently seen first. */
  all(): Belief[] {
    return [...this.beliefs.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  }

  get(id: string): Belief | undefined {
    return this.beliefs.get(id)
  }

  /**
   * Looks a belief up the way the model refers to it — by real id once
   * recognised, or by its anonymous handle before that.
   */
  byLabel(label: string): Belief | undefined {
    for (const belief of this.beliefs.values()) {
      // Real id, current label, or the anonymous handle it carried before —
      // the model may be holding any of them from an earlier turn, and `full`
      // mode names things by id without ever marking them recognised.
      if (belief.id === label || belief.label === label || belief.handle === label) return belief
    }
    return undefined
  }

  knows(label: string): boolean {
    return this.byLabel(label) !== undefined
  }

  /** Carrying an object removes it from the map — it is in hand, not in the world. */
  forget(id: string): void {
    this.beliefs.delete(id)
  }

  clear(): void {
    this.beliefs.clear()
    this.anonymous = 0
  }
}
