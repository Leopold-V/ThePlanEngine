import type { Robot } from './Robot.js'
import type { WorldView } from './WorldView.js'

/**
 * Local navigation, from what the robot believes rather than from what is true.
 *
 * The tempting implementation is a navmesh and A* over the whole world. That
 * would be a lie: it lets the robot path around a boulder it has never seen,
 * which contradicts the field of view, the persistent world model and the whole
 * of `proprioceptive` mode. So obstacles come from the belief map — things that
 * have actually passed through the sensor — and the ground is only probed a
 * step ahead, which is what feet and an IMU give you for free.
 *
 * The consequence is deliberate: a robot that charges off without looking has
 * an empty map and walks into things, and one that has swept the area moves
 * smoothly through it. Navigation quality follows perception quality.
 *
 * This steers; it does not plan. A concave trap will defeat it, and it is
 * supposed to — the stall detector reports it and the model replans, which is
 * the loop this whole app is about.
 */

export interface Obstacle {
  x: number
  z: number
  /** Half-extent of the thing itself; clearance is added on top. */
  radius: number
  id: string
}

export interface Surroundings {
  obstacles: Obstacle[]
  /** Ground height, only ever asked about a step ahead. */
  groundHeightAt: (x: number, z: number) => number
}

export interface Steer {
  /** The heading to aim for this frame, in radians. */
  heading: number
  /** 0..1 pace, eased down when swerving hard. */
  forward: number
  /** What forced the detour, if anything. For the observation, not the model. */
  avoiding: string | null
}

/** Body half-width plus a margin, so it rounds corners rather than scraping. */
const CLEARANCE = 0.55
/** How far ahead a candidate direction is tested. */
const LOOKAHEAD = 2.4
/** Beyond this an obstacle is not worth considering this frame. */
const RELEVANT = 8
/** Rise over run the robot steers away from — below the controller's 45° limit. */
const SLOPE_LIMIT = 0.8

const OBSTACLE_WEIGHT = 6
const SLOPE_WEIGHT = 4
/** Per radian of deviation: enough to keep it honest about going straight. */
const TURN_WEIGHT = 0.4

/**
 * Directions tried, either side of straight at the target.
 *
 * Sampling beats a repulsion field here for one specific reason: an obstacle
 * dead ahead produces a repulsion vector exactly opposite to the seek vector,
 * the two cancel, and the robot walks calmly into it. Scoring discrete
 * candidates has no such degenerate case — going straight simply scores badly
 * and something else wins.
 */
const CANDIDATES_DEG = [0, 10, -10, 20, -20, 32, -32, 45, -45, 60, -60, 78, -78]

export function steerToward(
  robot: Robot,
  targetX: number,
  targetZ: number,
  around: Surroundings
): Steer {
  const from = robot.position
  const toTarget = Math.hypot(targetX - from.x, targetZ - from.z)
  const seek = Math.atan2(targetX - from.x, targetZ - from.z)
  // Never probe past the target, or obstacles behind it push the robot around.
  const reach = Math.min(LOOKAHEAD, Math.max(0.4, toTarget))

  const nearby = around.obstacles.filter(
    (o) => Math.hypot(o.x - from.x, o.z - from.z) < RELEVANT
  )
  const groundHere = around.groundHeightAt(from.x, from.z)

  let best = { heading: seek, cost: Infinity, offsetDeg: 0 }
  // What is in the way of going straight at the target — which is the thing
  // being avoided. The chosen path is by definition the clear one, so reading
  // the answer off that would report nothing on every successful detour.
  let inTheWay: string | null = null

  for (const offsetDeg of CANDIDATES_DEG) {
    const heading = seek + (offsetDeg * Math.PI) / 180
    const tipX = from.x + Math.sin(heading) * reach
    const tipZ = from.z + Math.cos(heading) * reach

    let cost = Math.abs(offsetDeg) * (Math.PI / 180) * TURN_WEIGHT
    let worst: { id: string; penalty: number } | null = null

    for (const obstacle of nearby) {
      const gap =
        distanceToSegment(obstacle.x, obstacle.z, from.x, from.z, tipX, tipZ) -
        (obstacle.radius + CLEARANCE)
      if (gap >= 0) continue
      const penalty = -gap * OBSTACLE_WEIGHT
      cost += penalty
      if (!worst || penalty > worst.penalty) worst = { id: obstacle.id, penalty }
    }

    // Only the ground it is about to step on: probing further would be sight,
    // and sight has to be earned.
    const rise = around.groundHeightAt(tipX, tipZ) - groundHere
    const slope = rise / reach
    if (slope > SLOPE_LIMIT) cost += (slope - SLOPE_LIMIT) * SLOPE_WEIGHT

    if (offsetDeg === 0) inTheWay = worst?.id ?? null
    if (cost < best.cost) best = { heading, cost, offsetDeg }
  }

  // Swerving hard at full pace overshoots the turn and clips the thing being
  // avoided, so pace comes off as the deviation grows.
  const deviation = Math.abs(shortestAngle(seek, best.heading))
  const forward = deviation > 0.9 ? 0.45 : deviation > 0.45 ? 0.7 : 1

  return {
    heading: best.heading,
    forward,
    avoiding: best.offsetDeg === 0 ? null : inTheWay
  }
}

/**
 * Obstacles as the robot believes them to be.
 *
 * The belief map, not the object list: a thing the robot has never had in view
 * is not something it can steer around. `ignore` drops the object being walked
 * to, which would otherwise repel the robot away from its own destination.
 */
export function surroundingsFrom(world: WorldView, ignore?: string): Surroundings {
  return {
    obstacles: world.model
      .all()
      .filter((belief) => belief.id !== ignore)
      .map((belief) => ({ id: belief.id, x: belief.x, z: belief.z, radius: belief.radius })),
    groundHeightAt: (x, z) => world.groundHeightAt(x, z)
  }
}

export function shortestAngle(from: number, to: number): number {
  let delta = to - from
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

/** Closest approach of a point to a line segment, in the ground plane. */
function distanceToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const dx = bx - ax
  const dz = bz - az
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-9) return Math.hypot(px - ax, pz - az)

  let t = ((px - ax) * dx + (pz - az) * dz) / lengthSquared
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}
