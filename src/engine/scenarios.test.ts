import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { Robot } from '@sim/Robot.js'
import { WorldObject } from '@sim/objects.js'
import { WorldModel } from '@sim/WorldModel.js'
import { perceive, DEFAULT_PERCEPTION } from '@sim/perception.js'
import { describe as describeWorld } from '@sim/observe.js'
import { VoxelTerrain } from '@sim/VoxelTerrain.js'
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

/** Stands up the physics half of a scenario, terrain included. */
function build(id: string) {
  const spec = scenario(id)
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const resolved = resolveScene(spec.scene)
  if (!resolved.voxel) throw new Error(`${id} is not a voxel scene`)

  const terrain = new VoxelTerrain(resolved.voxel, RAPIER, physics)
  const objects = resolved.objects.map((o) => new WorldObject(o, RAPIER, physics))
  const robot = new Robot(RAPIER, physics)
  robot.teleport(
    spec.start.x,
    spec.start.z,
    (spec.start.headingDeg * Math.PI) / 180,
    terrain.heightAt(spec.start.x, spec.start.z)
  )
  return { spec, physics, objects, robot, terrain }
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

function settle(robot: Robot, physics: RAPIER.World, frames = 90): void {
  for (let i = 0; i < frames; i++) {
    robot.update(STEP)
    physics.step()
  }
}

// Meshing a world costs about a second, and this builds all of them.
it('every scenario stands up, spawns the robot on the ground, and starts unscored', { timeout: 60_000 }, () => {
  for (const spec of BUILT_IN_SCENARIOS) {
    const { robot, objects, terrain, physics } = build(spec.id)
    settle(robot, physics, 60)

    const ground = terrain.heightAt(robot.position.x, robot.position.z)
    expect(Math.abs(robot.position.y - ground), `${spec.id}: robot not on the ground`).toBeLessThan(0.15)

    // Every id a criterion names must actually exist in the scene, or the task
    // is unscoreable and will read as a failure for reasons the model cannot fix.
    const ids = new Set(objects.map((o) => o.spec.id))
    for (const c of spec.criteria) {
      if ('object' in c && typeof c.object === 'string') {
        expect(ids.has(c.object), `${spec.id}: criterion names missing "${c.object}"`).toBe(true)
      }
      if ('surface' in c) {
        expect(ids.has(c.surface), `${spec.id}: criterion names missing "${c.surface}"`).toBe(true)
      }
    }

    // And nothing may pass before the robot has done anything, or the scenario
    // scores itself.
    const results = evaluate(spec.criteria, snapshot(robot, objects))
    expect(allPassed(results), `${spec.id}: passes before the run starts`).toBe(false)
  }
})

it('up-on-the-gantry: the gantry can be jumped onto and it scores', () => {
  const { spec, physics, objects, robot } = build('up-on-the-gantry')

  robot.teleport(0, 3.0, 0)
  settle(robot, physics, 30)
  expect(robot.jump(1.05, 1.6)).toBe(true)
  settle(robot, physics, 240)

  const results = evaluate(spec.criteria, snapshot(robot, objects))
  console.log(`landed at ${robot.position.y.toFixed(2)}m —`, results[0]?.detail)
  expect(robot.airborne).toBe(false)
  expect(allPassed(results)).toBe(true)
})

it('behind-the-barrier: the barrier announces how long it is', () => {
  const { physics, objects, robot } = build('behind-the-barrier')
  const model = new WorldModel()

  const sightings = perceive(robot, objects, physics, RAPIER, DEFAULT_PERCEPTION)
  model.update(sightings, 0)
  const observation = describeWorld(robot, model, sightings, 0, true)

  console.log(observation.split('\n')[1])
  // Without the footprint there is no way to plan a route round the end.
  expect(observation).toContain('barrier')
  expect(observation).toContain('12.0m by 0.6m')
})

it('reach-high-ground: the target is reachable, and not by standing still', () => {
  const { spec, terrain, objects, robot, physics } = build('reach-high-ground')
  settle(robot, physics, 60)

  const target = 1.5
  expect(allPassed(evaluate(spec.criteria, snapshot(robot, objects)))).toBe(false)

  // Flood fill from the clearing, climbing at most what the robot can jump.
  const grid = 0.5
  const span = Math.floor(24 / grid)
  const key = (i: number, j: number) => `${i},${j}`
  const h = (i: number, j: number) => terrain.heightAt(i * grid, j * grid)
  const seen = new Set([key(0, 0)])
  const queue: [number, number][] = [[0, 0]]
  let best = 0

  while (queue.length) {
    const [i, j] = queue.shift() as [number, number]
    best = Math.max(best, h(i, j))
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di
      const nj = j + dj
      if (Math.abs(ni) > span || Math.abs(nj) > span) continue
      if (seen.has(key(ni, nj))) continue
      if (h(ni, nj) - h(i, j) > 1.05) continue
      seen.add(key(ni, nj))
      queue.push([ni, nj])
    }
  }

  console.log(`highest reachable from the clearing: ${best.toFixed(2)}m (target ${target}m)`)
  expect(best).toBeGreaterThanOrEqual(target)
})

it('fetch-across-the-sector: the cargo is far, on solid ground, and reachable', () => {
  const { terrain, objects, robot } = build('fetch-across-the-sector')
  const crate = objects.find((o) => o.spec.id === 'amber_crate')
  expect(crate).toBeDefined()

  const at = (crate as WorldObject).position
  const distance = Math.hypot(at.x - robot.position.x, at.z - robot.position.z)
  const ground = terrain.heightAt(at.x, at.z)

  console.log(`cargo ${distance.toFixed(1)}m out, resting ${(at.y - ground).toFixed(2)}m above ground`)
  // Far enough to be a journey...
  expect(distance).toBeGreaterThan(12)
  // ...and sitting on the ground rather than buried in it or floating.
  expect(at.y - ground).toBeGreaterThan(0)
  expect(at.y - ground).toBeLessThan(0.45)
})
