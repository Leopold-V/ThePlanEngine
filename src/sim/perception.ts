import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { Robot } from './Robot.js'
import type { ObjectKind, WorldObject } from './objects.js'

/** Sensor parameters. Profile fields, so they land in the config fingerprint. */
export interface PerceptionConfig {
  /**
   * Metres. The sensor's hard limit, whatever the size of the thing — acuity
   * does the real gating below it.
   */
  range: number
  /** Degrees either side of the robot's heading. */
  halfAngleDeg: number
  /** Raycast to each candidate so hidden objects are genuinely hidden. */
  occlusion: boolean
  /**
   * How many metres away a 1-metre feature stays resolvable.
   *
   * Sight is angular: a thing is visible when it is big enough for how far away
   * it is, which is why a lit beacon can be navigated by and a crate has to be
   * walked into. 20 is chosen so a 0.4m crate resolves to exactly 8m — what the
   * flat range used to be — so nothing close up changed when this arrived.
   */
  acuity: number
}

export const DEFAULT_PERCEPTION: PerceptionConfig = {
  range: 45,
  halfAngleDeg: 60,
  occlusion: true,
  acuity: 20
}

export interface Sighting {
  id: string
  kind: ObjectKind
  position: THREE.Vector3
  /** Metres from the robot, measured flat — range is a ground-plane distance. */
  distance: number
  /** Degrees from the robot's heading. Negative is left, positive is right. */
  bearingDeg: number
  /**
   * Metres the object's centre sits above (positive) or below the robot's feet.
   *
   * On a flat world this was always zero and could be left unsaid. On terrain it
   * is the difference between a thing the robot can walk to and a thing it has
   * to climb, and no other part of the observation carries it.
   */
  elevation: number
  /**
   * Horizontal half-extents, in metres. Seeing a thing tells you how big it is,
   * and navigation needs it: a 2.4m boulder has to be given a wider berth than
   * a 30cm crate.
   *
   * Two numbers rather than one, because a wall is five metres long and half a
   * metre thick. Collapsed to a single radius it becomes a five-metre circle,
   * and the robot swings around empty ground to avoid a barrier it could have
   * walked close alongside.
   */
  halfX: number
  halfZ: number
}

/** Worst-case half-extent, for the places that genuinely want one number. */
export function footprintRadius(of: { halfX: number; halfZ: number }): number {
  return Math.max(of.halfX, of.halfZ)
}

/**
 * What decides how conspicuous a thing is: its largest dimension, height
 * included.
 *
 * Deliberately not `footprintRadius`, which is horizontal only. A beacon is
 * [0.25, 3, 0.25] against a crate's [0.4, 0.4, 0.4] — narrower than the crate
 * it exists to lead the robot to — so keyed off the footprint the landmark
 * would resolve from closer than the cargo. What makes a beacon conspicuous is
 * that it is tall.
 */
export function largestDimension(size: [number, number, number]): number {
  return Math.max(size[0], size[1], size[2])
}

/** Roughly where a sensor would sit — used as the raycast origin. */
const EYE_HEIGHT = 1.5

/**
 * What the robot can see right now: inside the cone, within range, and — when
 * occlusion is on — with clear line of sight from eye height to the object's
 * centre.
 */
export function perceive(
  robot: Robot,
  objects: WorldObject[],
  physics: RAPIER.World,
  rapier: typeof RAPIER,
  config: PerceptionConfig
): Sighting[] {
  const origin = robot.position
  const eye = new THREE.Vector3(origin.x, origin.y + EYE_HEIGHT, origin.z)
  const sightings: Sighting[] = []

  for (const object of objects) {
    // A carried object is in the hand, not in the field of view.
    if (object.isCarried) continue

    const target = object.position
    const dx = target.x - eye.x
    const dz = target.z - eye.z
    const distance = Math.hypot(dx, dz)
    if (distance < 1e-4) continue
    // The sensor's own ceiling, then angular size. Both have to hold: acuity
    // alone would resolve a 12m barrier at 240 metres.
    if (distance > config.range) continue
    if (distance > largestDimension(object.spec.size) * config.acuity) continue

    // Signed angle between where the robot is looking and the object. The head,
    // not the chest — the sensors are mounted in it.
    let bearing = Math.atan2(dx, dz) - robot.sensorHeading
    while (bearing > Math.PI) bearing -= Math.PI * 2
    while (bearing < -Math.PI) bearing += Math.PI * 2

    const bearingDeg = THREE.MathUtils.radToDeg(bearing)
    if (Math.abs(bearingDeg) > config.halfAngleDeg) continue

    if (config.occlusion && !hasLineOfSight(eye, object, robot, physics, rapier)) continue

    sightings.push({
      id: object.spec.id,
      kind: object.spec.kind,
      position: target,
      distance,
      bearingDeg,
      elevation: target.y - origin.y,
      halfX: object.spec.size[0] / 2,
      halfZ: object.spec.size[2] / 2
    })
  }

  return sightings.sort((a, b) => a.distance - b.distance)
}

/**
 * Points on an object worth testing for visibility: its centre, the middle of
 * its top face, and its upper corners drawn slightly inward.
 *
 * Sampling only the centre made visibility far too brittle — a 1.6m table could
 * disappear because one 30cm block happened to sit on the line to its middle.
 * An object is visible if any part of it is.
 */
function samplePoints(object: WorldObject): THREE.Vector3[] {
  const c = object.position
  const [w, h, d] = object.spec.size
  // Drawn in from the true corners so a ray cannot graze along a face.
  const ix = w * 0.35
  const iz = d * 0.35
  const top = h * 0.45

  return [
    c,
    new THREE.Vector3(c.x, c.y + top, c.z),
    new THREE.Vector3(c.x + ix, c.y + top, c.z + iz),
    new THREE.Vector3(c.x - ix, c.y + top, c.z + iz),
    new THREE.Vector3(c.x + ix, c.y + top, c.z - iz),
    new THREE.Vector3(c.x - ix, c.y + top, c.z - iz)
  ]
}

/**
 * True when any sampled point on the object is reachable by a clear ray.
 *
 * The robot's own capsule must be excluded: eye height sits inside it, so a
 * solid raycast would otherwise report an immediate self-hit and the robot
 * would perceive nothing at all.
 */
function hasLineOfSight(
  eye: THREE.Vector3,
  object: WorldObject,
  robot: Robot,
  physics: RAPIER.World,
  rapier: typeof RAPIER
): boolean {
  return samplePoints(object).some((point) =>
    rayReaches(eye, point, object, robot, physics, rapier)
  )
}

function rayReaches(
  eye: THREE.Vector3,
  target: THREE.Vector3,
  object: WorldObject,
  robot: Robot,
  physics: RAPIER.World,
  rapier: typeof RAPIER
): boolean {
  const direction = target.clone().sub(eye)
  const length = direction.length()
  if (length < 1e-4) return true
  direction.divideScalar(length)

  const ray = new rapier.Ray(
    { x: eye.x, y: eye.y, z: eye.z },
    { x: direction.x, y: direction.y, z: direction.z }
  )

  const hit = physics.castRay(
    ray,
    length + 0.05,
    true,
    undefined,
    undefined,
    robot.collider,
    undefined
  )

  return !hit || hit.collider.handle === object.collider.handle
}
