import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { Robot } from './Robot.js'
import { WorldObject } from './objects.js'
import { perceive, DEFAULT_PERCEPTION } from './perception.js'
import { blockSpec, BLOCK_COLORS } from '@shared/scene.js'

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
