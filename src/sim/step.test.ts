import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { Robot } from './Robot.js'
import { VoxelTerrain } from './VoxelTerrain.js'
import { WorldObject } from './objects.js'
import { FLAT_VOXEL, crateSpec, CRATE_COLORS } from '@shared/scene.js'
import { BLOCK, generateVoxelWorld } from '@shared/voxel.js'

const STEP = 1 / 60

beforeAll(async () => {
  await RAPIER.init()
})

/**
 * One block is a stride and two are a jump. That is the reason the block size
 * was chosen against the robot rather than for looks, and it was not true in
 * the code: Rapier's autostep will not lift this capsule half a metre, so every
 * single-block step in the world — the smallest feature the terrain can make —
 * was a wall the robot walked into and stopped dead against.
 */
function ledge(blocks: number, extra?: (w: ReturnType<typeof generateVoxelWorld>) => void) {
  const world = generateVoxelWorld({ ...FLAT_VOXEL, halfExtent: 10 })
  const { groundLevel, blockSize, halfExtent } = world.spec
  for (let bx = 0; bx < world.sizeX; bx++) {
    for (let bz = 0; bz < world.sizeZ; bz++) {
      if (bz * blockSize - halfExtent <= 2) continue
      for (let i = 1; i <= blocks; i++) world.set(bx, groundLevel + i, bz, BLOCK.concrete)
    }
  }
  extra?.(world)

  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const terrain = new VoxelTerrain(world, RAPIER, physics)
  const robot = new Robot(RAPIER, physics)
  robot.teleport(0, 0, 0, terrain.heightAt(0, 0))
  return { physics, robot, world }
}

function walkForward(w: { physics: RAPIER.World; robot: Robot }, seconds = 6) {
  for (let i = 0; i < seconds * 60; i++) {
    w.robot.setForward(1)
    w.robot.update(STEP)
    w.physics.step()
  }
  w.robot.stop()
  return w.robot.position
}

it('walks up one block without being asked', () => {
  const p = walkForward(ledge(1))
  console.log(`one block: y=${p.y.toFixed(2)} z=${p.z.toFixed(2)}`)
  expect(p.y).toBeGreaterThan(0.45)
  // And carries on over it rather than stopping on the edge.
  expect(p.z).toBeGreaterThan(4)
})

it('is still stopped by two, because two is a jump', () => {
  const p = walkForward(ledge(2))
  console.log(`two blocks: y=${p.y.toFixed(2)} z=${p.z.toFixed(2)}`)
  expect(p.y).toBeLessThan(0.4)
})

it('does not clamber onto a crate it is walking towards', () => {
  // A 0.4m crate is inside the step height, so only the static-geometry filter
  // stops the robot climbing the cargo instead of picking it up.
  const w = ledge(0)
  const crate = new WorldObject(
    { ...crateSpec('amber_crate', CRATE_COLORS.amber, [0, 3]), position: [0, 0.2, 3] },
    RAPIER,
    w.physics
  )
  const p = walkForward(w, 4)

  console.log(`crate ahead: robot y=${p.y.toFixed(2)}, crate y=${crate.position.y.toFixed(2)}`)
  expect(p.y).toBeLessThan(0.25)
})

it('will not step up into a ceiling', () => {
  // A ledge with rock directly over it: stepping up there wedges the robot
  // inside the world, and the world has caves in it.
  const w = ledge(1, (world) => {
    const { groundLevel, blockSize, halfExtent } = world.spec
    for (let bx = 0; bx < world.sizeX; bx++) {
      for (let bz = 0; bz < world.sizeZ; bz++) {
        if (bz * blockSize - halfExtent <= 2) continue
        world.set(bx, groundLevel + 3, bz, BLOCK.concrete)
      }
    }
  })
  const p = walkForward(w)

  console.log(`under a ceiling: y=${p.y.toFixed(2)} z=${p.z.toFixed(2)}`)
  expect(p.y).toBeLessThan(0.4)
})
