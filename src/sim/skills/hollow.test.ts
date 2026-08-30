import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { Robot } from '../Robot.js'
import { WorldModel } from '../WorldModel.js'
import { VoxelTerrain } from '../VoxelTerrain.js'
import { senseGround } from '../terrainSense.js'
import { describe as describeWorld } from '../observe.js'
import { DEFAULT_PERCEPTION } from '../perception.js'
import { walkTo } from './walkTo.js'
import { moveForward } from './moveForward.js'
import { FLAT_VOXEL } from '@shared/scene.js'
import { BLOCK, generateVoxelWorld, type VoxelWorld } from '@shared/voxel.js'
import type { SkillContext } from './types.js'
import type { WorldView } from '../WorldView.js'

const STEP = 1 / 60

beforeAll(async () => {
  await RAPIER.init()
})

/**
 * A flat yard with the ground raised in a ring around the origin, so the robot
 * starts at the bottom of a hollow with walls of a known height.
 *
 * Built by stacking blocks rather than by tuning noise: the test is about what
 * the robot is told, and that wants geometry with no ambiguity in it.
 */
function hollow(riseBlocks: number, radius = 3): VoxelWorld {
  const world = generateVoxelWorld({ ...FLAT_VOXEL, halfExtent: 12 })
  const { groundLevel, blockSize, halfExtent } = world.spec

  for (let bx = 0; bx < world.sizeX; bx++) {
    for (let bz = 0; bz < world.sizeZ; bz++) {
      const x = bx * blockSize - halfExtent
      const z = bz * blockSize - halfExtent
      if (Math.hypot(x, z) <= radius) continue
      for (let i = 1; i <= riseBlocks; i++) {
        world.set(bx, groundLevel + i, bz, BLOCK.concrete)
      }
    }
  }
  return world
}

/** A yard with a single step across it at z = 4, and level ground either side. */
function ledge(riseBlocks: number): VoxelWorld {
  const world = generateVoxelWorld({ ...FLAT_VOXEL, halfExtent: 12 })
  const { groundLevel, blockSize, halfExtent } = world.spec

  for (let bx = 0; bx < world.sizeX; bx++) {
    for (let bz = 0; bz < world.sizeZ; bz++) {
      if (bz * blockSize - halfExtent <= 4) continue
      for (let i = 1; i <= riseBlocks; i++) {
        world.set(bx, groundLevel + i, bz, BLOCK.concrete)
      }
    }
  }
  return world
}

function stand(voxels: VoxelWorld) {
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const terrain = new VoxelTerrain(voxels, RAPIER, physics)
  const robot = new Robot(RAPIER, physics)
  robot.teleport(0, 0, 0, terrain.heightAt(0, 0))

  const waiters: Array<(dt: number) => void> = []
  const ctx = {
    world: {
      robot,
      objects: [],
      model: new WorldModel(),
      sightings: [],
      ground: [],
      observationDetail: 'full',
      groundHeightAt: (x: number, z: number) => terrain.heightAt(x, z)
    } as unknown as WorldView,
    signal: new AbortController().signal,
    report: () => {},
    nextFrame: () => new Promise<number>((resolve) => waiters.push(resolve))
  } satisfies SkillContext

  return {
    physics,
    robot,
    ctx,
    terrain,
    pump: () => {
      for (const resolve of waiters.splice(0)) resolve(STEP)
    }
  }
}

async function drive(
  run: Promise<{ ok: boolean; observation: string }>,
  w: ReturnType<typeof stand>
) {
  let done = false
  void run.then(() => (done = true))
  let frames = 0
  while (!done && frames < 60 * 45) {
    w.pump()
    await Promise.resolve()
    w.robot.update(STEP)
    w.physics.step()
    frames++
  }
  return await run
}

/** The observation the model would receive, ground readings included. */
function observationIn(w: ReturnType<typeof stand>): string {
  const ground = senseGround(w.robot, (x, z) => w.terrain.heightAt(x, z), DEFAULT_PERCEPTION)
  return describeWorld(w.robot, new WorldModel(), [], 0, true, ground)
}

// --- what the robot is told before it has tried anything --------------------

it('reports the walls of a hollow it is standing in, without being asked', () => {
  const w = stand(hollow(4))
  for (let i = 0; i < 60; i++) {
    w.robot.update(STEP)
    w.physics.step()
  }

  const observation = observationIn(w)
  console.log(observation)

  // The whole point: this arrives before any skill has failed, so the model can
  // work out it is in a pit rather than discovering it by walking into one.
  expect(observation).toMatch(/Ground: rises \d\.\d\dm at \d\.\dm ahead/)
  // Geometry only. The verdict and the way out are the model's to reach.
  expect(observation).not.toMatch(/steep|trapped|stuck/i)
  expect(observation).not.toMatch(/jump|climb|around/i)
})

it('says nothing about the ground on a level yard', () => {
  const w = stand(generateVoxelWorld({ ...FLAT_VOXEL, halfExtent: 12 }))
  const observation = observationIn(w)

  console.log(observation)
  // Resent every turn, so a line that always appears is paid for every call.
  expect(observation).not.toContain('Ground:')
})

it('reports a step it could walk up as nothing at all', () => {
  const w = stand(ledge(1))
  const observation = observationIn(w)

  console.log(observation)
  expect(observation).not.toContain('Ground:')
})

it('says nothing about a bank behind it, because this is sight', () => {
  const w = stand(ledge(4))
  // Same world, same wall — the robot simply is not looking at it.
  w.robot.teleport(0, 0, Math.PI, w.terrain.heightAt(0, 0))

  const observation = observationIn(w)
  console.log(observation)
  // Ground readings are bound by the sensor cone like everything else. If they
  // were not, turning round would stop being how the robot finds things out.
  expect(observation).not.toContain('Ground:')
})

// --- and what it is told when a walk fails ----------------------------------

it('a wall of ground is reported as ground, with the height to judge a jump by', async () => {
  const w = stand(ledge(3))
  const result = await drive(walkTo.run(w.robot, { x: 0, z: 10 }, w.ctx), w)

  console.log(result.observation)
  expect(result.ok).toBe(false)
  // The geometry, so the model can weigh it against limits it has been told.
  expect(result.observation).toMatch(/the ground just ahead rises \d\.\d\dm/)
  // Not the verdict, and not the remedy — both are the model's to reach.
  expect(result.observation).not.toMatch(/steep/i)
  expect(result.observation).not.toMatch(/jump/i)
})

it('move_forward stops at a wall of ground rather than leaning on it', async () => {
  const w = stand(ledge(3))

  let done = false
  let frames = 0
  const run = moveForward.run(w.robot, { metres: 8 }, w.ctx)
  void run.then(() => (done = true))
  while (!done && frames < 60 * 45) {
    w.pump()
    await Promise.resolve()
    w.robot.update(STEP)
    w.physics.step()
    frames++
  }
  const result = await run

  console.log(`gave up after ${(frames / 60).toFixed(1)}s — ${result.observation}`)
  expect(result.ok).toBe(false)
  expect(result.observation).toContain('stopped making progress')
  // It does not steer, so it was always going to stop here. The bug was how
  // long it took to admit it: the timeout for 8m is 11.7 seconds, all of them
  // spent walking on the spot against the wall.
  expect(frames / 60).toBeLessThan(6)
})

it('says nothing about the ground when it is walkable', async () => {
  const w = stand(generateVoxelWorld({ ...FLAT_VOXEL, halfExtent: 12 }))
  const result = await drive(walkTo.run(w.robot, { x: 0, z: 8 }, w.ctx), w)

  console.log(result.observation)
  expect(result.ok).toBe(true)
  expect(result.observation).not.toContain('the ground just ahead rises')
})
