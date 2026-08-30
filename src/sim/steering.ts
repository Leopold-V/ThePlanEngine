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
  /** Half-extents of the thing itself; clearance is added on top. */
  halfX: number
  halfZ: number
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
  /**
   * True when even the best direction is obstructed — no way through, only a
   * least-bad way in.
   *
   * Worth reporting separately from distance. Waiting for progress to stop
   * takes far longer than it should: with everything blocked the robot still
   * turns toward the least-bad heading, which the caller reads as a big turn
   * and crawls at quarter pace, so it inches at the barrier for ten seconds
   * before the distance test notices it has got nowhere.
   */
  trapped: boolean
  /**
   * What is in the way when `trapped` — a thing, or the shape of the ground.
   *
   * The difference decides what the robot should be told to try. "Go round it"
   * is right for a boulder and actively wrong in a hollow, where the answer is
   * to jump out.
   */
  blockedBy: 'obstacle' | 'ground' | null
  /** Metres the ground climbs over the probe, when that is what stops it. */
  riseAhead: number
}

/** Body half-width plus a margin, so it rounds corners rather than scraping. */
const CLEARANCE = 0.55
/** How far ahead a candidate direction is tested for things in the way. */
const LOOKAHEAD = 2.4
/**
 * How far ahead the *ground* is felt — a stride, not the whole probe.
 *
 * Measuring the rise over the full lookahead averages a wall of earth into a
 * gentle gradient: a 1.4m step 2.4m away reads as a slope of 0.58, under the
 * limit, so the robot walks cheerfully into it and never reports terrain as
 * what stopped it. This is meant to be the ground it is about to step on.
 */
const GROUND_PROBE = 1.0
/** Beyond this an obstacle is not worth considering this frame. */
const RELEVANT = 8
/** Rise over run the robot steers away from — below the controller's 45° limit. */
const SLOPE_LIMIT = 0.8

const OBSTACLE_WEIGHT = 6
/** Extra cost, in metres-equivalent, for a route that goes through a thing. */
const CROSSING = 1.5
const SLOPE_WEIGHT = 4
/** Per radian of deviation: enough to keep it honest about going straight. */
const TURN_WEIGHT = 0.4
/** Per radian away from the heading it already has. Breaks symmetric ties. */
const COMMITMENT_WEIGHT = 0.3

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
    (o) => Math.hypot(o.x - from.x, o.z - from.z) - Math.max(o.halfX, o.halfZ) < RELEVANT
  )
  const groundHere = around.groundHeightAt(from.x, from.z)

  let best = { heading: seek, cost: Infinity, offsetDeg: 0, obstructed: false, rise: 0 }
  // What is in the way of going straight at the target — which is the thing
  // being avoided. The chosen path is by definition the clear one, so reading
  // the answer off that would report nothing on every successful detour.
  let inTheWay: string | null = null

  for (const offsetDeg of CANDIDATES_DEG) {
    const heading = seek + (offsetDeg * Math.PI) / 180
    const tipX = from.x + Math.sin(heading) * reach
    const tipZ = from.z + Math.cos(heading) * reach

    // Deviation from the target, plus what it costs to swing round to it.
    //
    // The second term is hysteresis, and it earns its place: faced with an
    // obstacle dead ahead, left and right score identically, and a stateless
    // choice flips between them every frame while the robot stands still
    // dithering. Preferring the heading it already has breaks the tie the same
    // way each frame — and is true anyway, since turning takes time.
    let cost =
      Math.abs(offsetDeg) * (Math.PI / 180) * TURN_WEIGHT +
      Math.abs(shortestAngle(robot.heading, heading)) * COMMITMENT_WEIGHT
    let worst: { id: string; penalty: number } | null = null

    for (const obstacle of nearby) {
      const gap = segmentToBox(from.x, from.z, tipX, tipZ, obstacle)
      if (gap >= CLEARANCE) continue
      // Graded inside the clearance band, with a step for a route that would
      // actually pass through the thing rather than merely close to it.
      const penalty = (CLEARANCE - gap + (gap <= 1e-6 ? CROSSING : 0)) * OBSTACLE_WEIGHT
      cost += penalty
      if (!worst || penalty > worst.penalty) worst = { id: obstacle.id, penalty }
    }

    // Only the ground it is about to step on: probing further would be sight,
    // and sight has to be earned.
    const stride = Math.min(GROUND_PROBE, reach)
    const rise =
      around.groundHeightAt(
        from.x + Math.sin(heading) * stride,
        from.z + Math.cos(heading) * stride
      ) - groundHere
    const slope = rise / stride
    const tooSteep = slope > SLOPE_LIMIT
    if (tooSteep) cost += (slope - SLOPE_LIMIT) * SLOPE_WEIGHT

    if (offsetDeg === 0) inTheWay = worst?.id ?? null
    if (cost < best.cost) {
      best = {
        heading,
        cost,
        offsetDeg,
        obstructed: worst !== null,
        rise: tooSteep ? rise : 0
      }
    }
  }

  // Swerving hard at full pace overshoots the turn and clips the thing being
  // avoided, so pace comes off as the deviation grows.
  const deviation = Math.abs(shortestAngle(seek, best.heading))
  const forward = deviation > 0.9 ? 0.45 : deviation > 0.45 ? 0.7 : 1

  return {
    heading: best.heading,
    forward,
    avoiding: best.offsetDeg === 0 ? null : inTheWay,
    trapped: best.obstructed || best.rise > 0,
    // A thing in the way takes precedence: it is the more specific answer, and
    // the one the robot can name.
    blockedBy: best.obstructed ? 'obstacle' : best.rise > 0 ? 'ground' : null,
    riseAhead: best.rise
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
      .map((belief) => ({
        id: belief.id,
        x: belief.x,
        z: belief.z,
        halfX: belief.halfX,
        halfZ: belief.halfZ
      })),
    groundHeightAt: (x, z) => world.groundHeightAt(x, z)
  }
}

export function shortestAngle(from: number, to: number): number {
  let delta = to - from
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return delta
}

/**
 * Closest approach of a probe to an axis-aligned footprint, in the ground plane.
 *
 * Rectangles rather than circles because the world has walls in it now. A five
 * metre wall collapsed to a circle is a five metre circle: the robot swings
 * around open ground to avoid a barrier it could have walked close alongside,
 * and two segments of the same wall repel it from the gap between them.
 *
 * Returns 0 when the probe passes through the footprint. Otherwise the true
 * distance, which for a segment and a rectangle is always achieved either at an
 * end of the segment or at a corner of the box — both convex, so nothing in
 * between can be closer.
 */
function segmentToBox(ax: number, az: number, bx: number, bz: number, box: Obstacle): number {
  if (segmentCrossesBox(ax, az, bx, bz, box)) return 0

  let best = Math.min(pointToBox(ax, az, box), pointToBox(bx, bz, box))
  for (const cx of [box.x - box.halfX, box.x + box.halfX]) {
    for (const cz of [box.z - box.halfZ, box.z + box.halfZ]) {
      best = Math.min(best, distanceToSegment(cx, cz, ax, az, bx, bz))
    }
  }
  return best
}

function pointToBox(px: number, pz: number, box: Obstacle): number {
  const dx = Math.max(0, Math.abs(px - box.x) - box.halfX)
  const dz = Math.max(0, Math.abs(pz - box.z) - box.halfZ)
  return Math.hypot(dx, dz)
}

/** Slab test, clamped to the segment rather than run out to infinity. */
function segmentCrossesBox(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  box: Obstacle
): boolean {
  let enter = 0
  let leave = 1

  const axes: [number, number, number, number][] = [
    [ax, bx - ax, box.x, box.halfX],
    [az, bz - az, box.z, box.halfZ]
  ]

  for (const [origin, delta, centre, half] of axes) {
    if (Math.abs(delta) < 1e-9) {
      // Parallel to this slab: either inside it for the whole segment or never.
      if (Math.abs(origin - centre) > half) return false
      continue
    }
    let near = (centre - half - origin) / delta
    let far = (centre + half - origin) / delta
    if (near > far) [near, far] = [far, near]
    enter = Math.max(enter, near)
    leave = Math.min(leave, far)
    if (enter > leave) return false
  }

  return true
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
