import type { ObjectKind } from './objects.js'
import type { Sighting } from './perception.js'

export interface Belief {
  id: string
  kind: ObjectKind
  /** Where the robot last saw it — not where it necessarily is now. */
  x: number
  z: number
  /** Simulation seconds when the belief was last confirmed. */
  lastSeenAt: number
  /** True when the object is in view at this instant. */
  visible: boolean
  /** Horizontal half-extent as last seen. What navigation steers around. */
  radius: number
}

/**
 * The robot's persistent map. Object permanence is fundamental robotics — a
 * robot that forgets the table when it turns around is amnesiac, not realistic.
 *
 * Beliefs are deliberately NOT corrected while unobserved. If an object moves
 * out of view, the robot goes on believing the stale position until it looks
 * again. That belief error is the interesting middle ground between omniscience
 * and amnesia, and it is what real robots actually deal with.
 */
export class WorldModel {
  private readonly beliefs = new Map<string, Belief>()

  /** Folds the current sightings in, and marks everything else out of view. */
  update(sightings: Sighting[], now: number): void {
    for (const belief of this.beliefs.values()) belief.visible = false

    for (const sighting of sightings) {
      this.beliefs.set(sighting.id, {
        id: sighting.id,
        kind: sighting.kind,
        x: sighting.position.x,
        z: sighting.position.z,
        lastSeenAt: now,
        visible: true,
        radius: sighting.radius
      })
    }
  }

  /** Everything the robot believes exists, nearest-seen first. */
  all(): Belief[] {
    return [...this.beliefs.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  }

  get(id: string): Belief | undefined {
    return this.beliefs.get(id)
  }

  knows(id: string): boolean {
    return this.beliefs.has(id)
  }

  /** Carrying an object removes it from the map — it is in hand, not in the world. */
  forget(id: string): void {
    this.beliefs.delete(id)
  }

  clear(): void {
    this.beliefs.clear()
  }
}
