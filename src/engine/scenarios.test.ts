import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { Robot } from '@sim/Robot.js'
import { WorldObject } from '@sim/objects.js'
import { WorldModel } from '@sim/WorldModel.js'
import { perceive, DEFAULT_PERCEPTION } from '@sim/perception.js'
import { describe as describeWorld } from '@sim/observe.js'
import { resolveScene } from '@shared/worldgen.js'
import { BUILT_IN_SCENARIOS } from '@shared/scenario.js'
import { evaluate, allPassed } from './criteria.js'
import type { WorldSnapshot } from '@shared/scenario.js'

const STEP = 1 / 60

beforeAll(async () => {
  await RAPIER.init()
})

function scenario(id: string) {
  const found = BUILT_IN_SCENARIOS.find((s) => s.id === id)
  if (!found) throw new Error(`no scenario ${id}`)
  return found
}

/** Stands up the physics half of a scenario's scene. Terrain is left flat. */
function build(id: string) {
  const spec = scenario(id)
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  physics.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.1, 40).setTranslation(0, -0.1, 0))
  const objects = resolveScene(spec.scene).objects.map((o) => new WorldObject(o, RAPIER, physics))
  const robot = new Robot(RAPIER, physics)
  robot.teleport(spec.start.x, spec.start.z, (spec.start.headingDeg * Math.PI) / 180)
  return { spec, physics, objects, robot }
}

function snapshot(robot: Robot, objects: WorldObject[]): WorldSnapshot {
  const p = robot.position
  return {
    robot: { x: p.x, y: p.y, z: p.z, holding: robot.held?.spec.id ?? null },
    objects: objects.map((o) => ({
      id: o.spec.id,
      x: o.position.x,
      y: o.position.y,
      z: o.position.z,
      size: o.spec.size,
      up: o.up
    }))
  }
}

it('up-on-the-block is solvable: the platform can be jumped onto and scores', () => {
  const { spec, physics, objects, robot } = build('up-on-the-block')

  // Walk up to the near face, then jump the way the goal describes.
  robot.teleport(0, 3.0, 0)
  for (let i = 0; i < 30; i++) {
    robot.update(STEP)
    physics.step()
  }
  expect(robot.jump(1.05, 1.6)).toBe(true)
  for (let i = 0; i < 240; i++) {
    robot.update(STEP)
    physics.step()
  }

  const results = evaluate(spec.criteria, snapshot(robot, objects))
  console.log(`landed at ${robot.position.y.toFixed(2)}m —`, results[0]?.detail)
  expect(robot.airborne).toBe(false)
  expect(allPassed(results)).toBe(true)
})

it('behind-the-wall tells the model how long the wall is', () => {
  const { physics, objects, robot } = build('behind-the-wall')
  const model = new WorldModel()

  const sightings = perceive(robot, objects, physics, RAPIER, DEFAULT_PERCEPTION)
  model.update(sightings, 0)
  const observation = describeWorld(robot, model, sightings, 0, true)

  console.log(observation.split('\n')[1])
  // Without the footprint there is no way to plan a route round the end.
  expect(observation).toContain('wall_1')
  expect(observation).toContain('12.0m by 0.6m')
})
