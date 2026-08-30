import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { Robot } from './Robot.js'
import { WorldObject } from './objects.js'
import { perceive, DEFAULT_PERCEPTION } from './perception.js'
import { blockSpec, BLOCK_COLORS, barrierSpec, beaconSpec, crateSpec, CRATE_COLORS } from '@shared/scene.js'
import type { ObjectSpec } from '@shared/scene.js'

const STEP = 1 / 60

beforeAll(async () => {
  await RAPIER.init()
})

/** A block at 90° to the right — outside the ±60° cone while facing forward. */
function scene(): { physics: RAPIER.World; robot: Robot; objects: WorldObject[] } {
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  physics.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.1, 40).setTranslation(0, -0.1, 0))
  const objects = [
    new WorldObject(blockSpec('red_block', BLOCK_COLORS.red, [5, 0.15, 0]), RAPIER, physics)
  ]
  const robot = new Robot(RAPIER, physics)
  robot.teleport(0, 0, 0)
  return { physics, robot, objects }
}

function settleNeck(robot: Robot, physics: RAPIER.World): void {
  for (let i = 0; i < 180; i++) {
    robot.update(STEP)
    physics.step()
  }
}

function seen(robot: Robot, objects: WorldObject[], physics: RAPIER.World): string[] {
  return perceive(robot, objects, physics, RAPIER, DEFAULT_PERCEPTION).map((s) => s.id)
}

it('turning the neck changes what the robot can see, without moving the body', () => {
  const { physics, robot, objects } = scene()

  // Straight ahead: the block is 90° off, outside the field of view.
  expect(seen(robot, objects, physics)).toEqual([])

  const bodyBefore = robot.heading
  robot.setGazeYaw(Robot.MAX_GAZE)
  settleNeck(robot, physics)

  expect(seen(robot, objects, physics)).toContain('red_block')
  // The feet never moved: this was a glance, not a turn.
  expect(robot.heading).toBeCloseTo(bodyBefore, 6)
  expect(robot.distanceTo(0, 0)).toBeLessThan(0.01)
})

it('looking the wrong way loses it again', () => {
  const { physics, robot, objects } = scene()

  robot.setGazeYaw(Robot.MAX_GAZE)
  settleNeck(robot, physics)
  expect(seen(robot, objects, physics)).toContain('red_block')

  robot.setGazeYaw(-Robot.MAX_GAZE)
  settleNeck(robot, physics)
  expect(seen(robot, objects, physics)).toEqual([])
})

it('the neck cannot be commanded past its limit', () => {
  const { physics, robot } = scene()

  robot.setGazeYaw(Math.PI)
  settleNeck(robot, physics)

  expect(Math.abs(robot.gazeYaw)).toBeLessThanOrEqual(Robot.MAX_GAZE + 1e-6)
  // Sensor heading is body plus neck, and it is the neck that moved.
  expect(robot.sensorHeading).toBeCloseTo(robot.heading + robot.gazeYaw, 6)
})

/**
 * Objects straight ahead on open ground, so only size and distance decide
 * whether they are seen. Heading 0 faces +Z.
 */
function inTheOpen(specs: ObjectSpec[]): string[] {
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  physics.createCollider(RAPIER.ColliderDesc.cuboid(90, 0.1, 90).setTranslation(0, -0.1, 0))
  const objects = specs.map((spec) => new WorldObject(spec, RAPIER, physics))
  const robot = new Robot(RAPIER, physics)
  robot.teleport(0, 0, 0)
  return seen(robot, objects, physics)
}

// The calibration anchor. Acuity is set so this distance is exactly what it was
// before acuity existed — the change must be invisible up close.
it('a crate is resolvable to eight metres and no further', () => {
  expect(inTheOpen([crateSpec('near_crate', CRATE_COLORS.amber, [0, 7.5])])).toContain('near_crate')
  expect(inTheOpen([crateSpec('far_crate', CRATE_COLORS.amber, [0, 9])])).toEqual([])
})

it('a tall beacon reads at a distance where a crate does not', () => {
  const ids = inTheOpen([
    crateSpec('crate', CRATE_COLORS.amber, [0, 30]),
    beaconSpec('beacon', [3, 30], 3)
  ])

  expect(ids).toContain('beacon')
  expect(ids).not.toContain('crate')
})

it('range caps what even the largest thing can resolve', () => {
  // A 12m barrier clears the acuity threshold at 240m. The sensor does not.
  expect(inTheOpen([barrierSpec('barrier', [0, 60], [12, 2.5, 0.6])])).toEqual([])
})
