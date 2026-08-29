import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { Robot } from './Robot.js'
import type { ObjectKind, WorldObject } from './objects.js'

/** Sensor parameters. Profile fields, so they land in the config fingerprint. */
export interface PerceptionConfig {
  /** Metres. */
  range: number
  /** Degrees either side of the robot's heading. */
  halfAngleDeg: number
  /** Raycast to each candidate so hidden objects are genuinely hidden. */
  occlusion: boolean
}

export const DEFAULT_PERCEPTION: PerceptionConfig = {
  range: 8,
  halfAngleDeg: 60,
  occlusion: true
}

export interface Sighting {
  id: string
  kind: ObjectKind
  position: THREE.Vector3
  /** Metres from the robot. */
  distance: number
  /** Degrees from the robot's heading. Negative is left, positive is right. */
  bearingDeg: number
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
    if (distance > config.range || distance < 1e-4) continue

    // Signed angle between the robot's heading and the object.
    let bearing = Math.atan2(dx, dz) - robot.heading
    while (bearing > Math.PI) bearing -= Math.PI * 2
    while (bearing < -Math.PI) bearing += Math.PI * 2

    const bearingDeg = THREE.MathUtils.radToDeg(bearing)
    if (Math.abs(bearingDeg) > config.halfAngleDeg) continue

    if (config.occlusion && !hasLineOfSight(eye, target, object, robot, physics, rapier)) continue

    sightings.push({
      id: object.spec.id,
      kind: object.spec.kind,
      position: target,
      distance,
      bearingDeg
    })
  }

  return sightings.sort((a, b) => a.distance - b.distance)
}

/**
 * True when the first thing the ray hits is the object itself.
 *
 * The robot's own capsule must be excluded: eye height sits inside it, so a
 * solid raycast would otherwise report an immediate self-hit and the robot
 * would perceive nothing at all.
 */
function hasLineOfSight(
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
