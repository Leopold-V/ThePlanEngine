import {
  barrierSpec,
  beaconSpec,
  crateSpec,
  gantrySpec,
  platformSpec,
  CRATE_COLORS,
  FLAT_VOXEL
} from './scene.js'
import { DEFAULT_VOXEL } from './voxel.js'
import type { Scenario } from './scenario.js'

/**
 * The built-in tasks.
 *
 * Every one is set in a voxel world with a pinned seed, and lists its contents
 * explicitly rather than relying on scattered props. Both are for the same
 * reason: a task has to mean the same thing on every run, or two results cannot
 * be compared and a failure cannot be reproduced. The sandbox world is the
 * place for a fresh seed; this is not.
 *
 * Each one exercises something different — placing, searching, routing,
 * climbing, ordering, and crossing distance — so a model that is good at one
 * and hopeless at another shows it.
 */

/** Level ground, for the tasks that are about planning rather than terrain. */
const YARD = { ...FLAT_VOXEL, halfExtent: 24 }

/** Rolling sector with its seed pinned, so the landscape never moves. */
const SECTOR = { ...DEFAULT_VOXEL, seed: 8801, halfExtent: 26 }

export const BUILT_IN_SCENARIOS: Scenario[] = [
  {
    id: 'crate-on-platform',
    name: 'Crate on the platform',
    goal: 'Put the amber crate on the loading platform.',
    scene: {
      id: 'yard-basic',
      name: 'One crate, one platform',
      voxel: YARD,
      objects: [platformSpec('platform', [5, 1]), crateSpec('amber_crate', CRATE_COLORS.amber, [2, 3])]
    },
    start: { x: 0, z: 0, headingDeg: 0 },
    criteria: [
      { type: 'object_on', object: 'amber_crate', surface: 'platform' },
      { type: 'holding', object: null }
    ]
  },
  {
    // The crate starts behind the robot and outside its field of view, so this
    // cannot be solved without turning to look first.
    id: 'find-what-you-cannot-see',
    name: 'Find what you cannot see',
    goal: 'Find the cyan crate and put it on the loading platform.',
    scene: {
      id: 'yard-search',
      name: 'A crate behind you',
      voxel: YARD,
      objects: [
        platformSpec('platform', [5, 1]),
        crateSpec('cyan_crate', CRATE_COLORS.cyan, [-3, -4]),
        crateSpec('magenta_crate', CRATE_COLORS.magenta, [1, 6])
      ]
    },
    start: { x: 0, z: 0, headingDeg: 0 },
    criteria: [
      { type: 'object_on', object: 'cyan_crate', surface: 'platform' },
      { type: 'holding', object: null }
    ]
  },
  {
    // Two crates and something fragile. Ordering, and not knocking things over.
    id: 'clear-the-yard',
    name: 'Clear the yard',
    goal:
      'Put both the amber crate and the cyan crate on the loading platform, and leave the ' +
      'beacon standing.',
    scene: {
      id: 'yard-tidy',
      name: 'Two crates and a beacon',
      voxel: YARD,
      objects: [
        platformSpec('platform', [5, 1]),
        crateSpec('amber_crate', CRATE_COLORS.amber, [2, 3]),
        crateSpec('cyan_crate', CRATE_COLORS.cyan, [-4, 2]),
        beaconSpec('beacon', [3, -3], 1.6)
      ]
    },
    start: { x: 0, z: 0, headingDeg: 0 },
    criteria: [
      { type: 'object_on', object: 'amber_crate', surface: 'platform' },
      { type: 'object_on', object: 'cyan_crate', surface: 'platform' },
      { type: 'object_upright', object: 'beacon' },
      { type: 'holding', object: null }
    ]
  },
  {
    // A solid twelve-metre barrier with the crate directly behind it. Walking
    // at the crate is refused, so the only way through is to route: a waypoint
    // past one end, then back. That is the replanning loop the app exists to
    // run, and it is unsolvable without the barrier's footprint in the
    // observation.
    id: 'behind-the-barrier',
    name: 'Behind the barrier',
    goal:
      'There is a crate on the far side of the barrier. Fetch it and bring it back to where ' +
      'you are standing now, then put it down.',
    scene: {
      id: 'yard-barrier',
      name: 'A barrier, and a crate behind it',
      voxel: YARD,
      objects: [
        barrierSpec('barrier', [0, 5], [12, 2.2, 0.6]),
        crateSpec('amber_crate', CRATE_COLORS.amber, [0, 9])
      ]
    },
    start: { x: 0, z: 0, headingDeg: 0 },
    criteria: [
      { type: 'object_near', object: 'amber_crate', x: 0, z: 0, within: 3 },
      { type: 'holding', object: null }
    ]
  },
  {
    // The one place a jump is genuinely the only way. A block has vertical
    // sides, so unlike terrain there is no walkable approach to find.
    id: 'up-on-the-gantry',
    name: 'Up on the gantry',
    goal: 'Climb up onto the gantry block and stay standing on top of it.',
    scene: {
      id: 'yard-gantry',
      name: 'A gantry to jump onto',
      voxel: YARD,
      objects: [gantrySpec('gantry', [0, 5], 0.9)]
    },
    start: { x: 0, z: 0, headingDeg: 0 },
    criteria: [{ type: 'robot_above', height: 0.75 }]
  },
  {
    // Terrain, not an object, is the thing to be climbed — which is why this
    // needs a criterion about height rather than about standing on something
    // named. The seed is pinned and the target verified reachable.
    id: 'reach-high-ground',
    name: 'Reach the high ground',
    goal:
      'Get yourself up onto the high ground — at least 1.5 metres above where you are standing ' +
      'now. The sector rises and falls; some steps can be walked up and some have to be jumped.',
    scene: { id: 'sector-high', name: 'Sector, high ground', voxel: SECTOR },
    start: { x: 0, z: 0, headingDeg: 0 },
    criteria: [{ type: 'robot_above', height: 1.5 }]
  },
  {
    // Distance, in a world where the way is not straight. The beacon is there
    // to be navigated by: it is lit, so it reads through the haze from further
    // than anything else.
    id: 'fetch-across-the-sector',
    name: 'Fetch across the sector',
    goal:
      'A crate is out in the sector, next to a lit beacon. Find it, carry it back to the ' +
      'clearing at the centre, and put it down there.',
    scene: {
      id: 'sector-fetch',
      name: 'Sector, distant cargo',
      voxel: SECTOR,
      objects: [
        crateSpec('amber_crate', CRATE_COLORS.amber, [17, -9]),
        beaconSpec('beacon', [18.5, -9], 3)
      ]
    },
    start: { x: 0, z: 0, headingDeg: 0 },
    criteria: [
      { type: 'object_near', object: 'amber_crate', x: 0, z: 0, within: 4 },
      { type: 'holding', object: null }
    ]
  }
]
