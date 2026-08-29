import type {
  Criterion,
  CriterionResult,
  ObjectSnapshot,
  WorldSnapshot
} from '@shared/scenario.js'

/**
 * Evaluation is a pure function over a plain world snapshot, which is what
 * makes the scoring logic testable and a score reproducible.
 */

/** How far an object's base may sit from a surface top and still count as on it. */
const RESTING_TOLERANCE = 0.14
/** Overhang allowed before an object counts as off the surface. */
const FOOTPRINT_SLACK = 0.05
/** Below this, the object has tipped far enough to call it knocked over. */
const UPRIGHT_DOT = 0.85

export function evaluate(criteria: Criterion[], world: WorldSnapshot): CriterionResult[] {
  return criteria.map((criterion) => evaluateOne(criterion, world))
}

export function allPassed(results: CriterionResult[]): boolean {
  return results.length > 0 && results.every((r) => r.passed)
}

function evaluateOne(criterion: Criterion, world: WorldSnapshot): CriterionResult {
  switch (criterion.type) {
    case 'object_on':
      return objectOn(criterion.object, criterion.surface, world)
    case 'object_near':
      return objectNear(criterion, world)
    case 'robot_near':
      return robotNear(criterion, world)
    case 'holding':
      return holding(criterion.object, world)
    case 'object_upright':
      return upright(criterion.object, world)
  }
}

function find(id: string, world: WorldSnapshot): ObjectSnapshot | undefined {
  return world.objects.find((o) => o.id === id)
}

function missing(label: string, id: string): CriterionResult {
  return { label, passed: false, detail: `No object called "${id}" in the scene.` }
}

function objectOn(objectId: string, surfaceId: string, world: WorldSnapshot): CriterionResult {
  const label = `${objectId} is on ${surfaceId}`
  const object = find(objectId, world)
  const surface = find(surfaceId, world)
  if (!object) return missing(label, objectId)
  if (!surface) return missing(label, surfaceId)

  const surfaceTop = surface.y + surface.size[1] / 2
  const objectBase = object.y - object.size[1] / 2
  const gap = objectBase - surfaceTop

  const halfW = surface.size[0] / 2 + FOOTPRINT_SLACK
  const halfD = surface.size[2] / 2 + FOOTPRINT_SLACK
  const withinFootprint =
    Math.abs(object.x - surface.x) <= halfW && Math.abs(object.z - surface.z) <= halfD

  const resting = Math.abs(gap) <= RESTING_TOLERANCE

  if (withinFootprint && resting) {
    return { label, passed: true, detail: `Resting on ${surfaceId}.` }
  }
  if (!withinFootprint) {
    return {
      label,
      passed: false,
      detail:
        `${objectId} is at (${fmt(object.x)}, ${fmt(object.z)}), outside the ` +
        `${surfaceId} footprint centred on (${fmt(surface.x)}, ${fmt(surface.z)}).`
    }
  }
  return {
    label,
    passed: false,
    detail:
      `${objectId} is over ${surfaceId} but its base sits ${fmt(gap)}m from the surface ` +
      `(top at ${fmt(surfaceTop)}m).`
  }
}

function objectNear(
  criterion: Extract<Criterion, { type: 'object_near' }>,
  world: WorldSnapshot
): CriterionResult {
  const label = `${criterion.object} is within ${criterion.within}m of (${criterion.x}, ${criterion.z})`
  const object = find(criterion.object, world)
  if (!object) return missing(label, criterion.object)

  const distance = Math.hypot(object.x - criterion.x, object.z - criterion.z)
  return {
    label,
    passed: distance <= criterion.within,
    detail: `${criterion.object} is ${fmt(distance)}m away at (${fmt(object.x)}, ${fmt(object.z)}).`
  }
}

function robotNear(
  criterion: Extract<Criterion, { type: 'robot_near' }>,
  world: WorldSnapshot
): CriterionResult {
  const label = `robot is within ${criterion.within}m of (${criterion.x}, ${criterion.z})`
  const distance = Math.hypot(world.robot.x - criterion.x, world.robot.z - criterion.z)
  return {
    label,
    passed: distance <= criterion.within,
    detail: `Robot is ${fmt(distance)}m away at (${fmt(world.robot.x)}, ${fmt(world.robot.z)}).`
  }
}

function holding(objectId: string | null, world: WorldSnapshot): CriterionResult {
  const label = objectId === null ? 'robot is empty-handed' : `robot is holding ${objectId}`
  const actual = world.robot.holding
  return {
    label,
    passed: actual === objectId,
    detail: actual === null ? 'Robot is holding nothing.' : `Robot is holding ${actual}.`
  }
}

function upright(objectId: string, world: WorldSnapshot): CriterionResult {
  const label = `${objectId} is still upright`
  const object = find(objectId, world)
  if (!object) return missing(label, objectId)

  // The up axis of an untilted body points straight up, so its y component is
  // the cosine of how far the object has tipped.
  const tiltDegrees = (Math.acos(clamp(object.up.y, -1, 1)) * 180) / Math.PI
  return {
    label,
    passed: object.up.y >= UPRIGHT_DOT,
    detail: `${objectId} is tilted ${tiltDegrees.toFixed(0)}° from vertical.`
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function fmt(n: number): string {
  return n.toFixed(2)
}
