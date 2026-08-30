import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { beforeAll, expect, it } from 'vitest'
import { VoxelTerrain } from './VoxelTerrain.js'
import { DEFAULT_VOXEL, generateVoxelWorld } from '@shared/voxel.js'

beforeAll(async () => {
  await RAPIER.init()
})

const SPEC = { ...DEFAULT_VOXEL, seed: 21 }

it('meshes only the faces that meet open space', () => {
  const world = generateVoxelWorld(SPEC)
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const started = Date.now()
  const terrain = new VoxelTerrain(world, RAPIER, physics)
  const built = Date.now() - started

  const triangles = terrain.meshes.reduce(
    (n, m) => n + (m.geometry.getAttribute('position') as THREE.BufferAttribute).count / 3,
    0
  )
  const blocks = world.sizeX * world.sizeY * world.sizeZ
  console.log(`built in ${built}ms: ${triangles} triangles from ${blocks} blocks`)

  expect(terrain.meshes.length).toBeGreaterThan(0)
  // Every block as a cube would be 12 triangles each; surfacing must be far less.
  expect(triangles).toBeLessThan(blocks * 12 * 0.05)
})

it('the collider agrees with the ground the mesh shows', () => {
  const world = generateVoxelWorld(SPEC)
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const terrain = new VoxelTerrain(world, RAPIER, physics)
  physics.step()

  let worst = 0
  let checked = 0
  for (const [x, z] of [
    [0.13, 0.21], [4.13, -3.21], [-8.13, 6.21], [11.37, 11.71],
    [-15.13, -2.21], [7.13, -14.21], [-19.37, 9.71], [17.13, 3.21]
  ] as const) {
    const ray = new RAPIER.Ray({ x, y: 80, z }, { x: 0, y: -1, z: 0 })
    const hit = physics.castRay(ray, 300, true)
    if (!hit) continue
    checked++
    worst = Math.max(worst, Math.abs(80 - hit.timeOfImpact - terrain.heightAt(x, z)))
  }

  console.log(`collider vs heightAt: worst ${worst.toFixed(4)}m over ${checked} probes`)
  expect(checked).toBeGreaterThan(5)
  // Blocks are flat, so this should be exact rather than merely close — the
  // few centimetres the heightfield could never get rid of are gone.
  expect(worst).toBeLessThan(1e-6)
})

it('the robot stands on the blocks at exactly the height it was told', async () => {
  const world = generateVoxelWorld(SPEC)
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const terrain = new VoxelTerrain(world, RAPIER, physics)
  const { Robot } = await import('./Robot.js')
  const robot = new Robot(RAPIER, physics)

  for (const [x, z] of [[0, 0], [6, -4], [-9, 7]] as const) {
    robot.teleport(x, z, 0, terrain.heightAt(x, z))
    for (let i = 0; i < 120; i++) {
      robot.update(1 / 60)
      physics.step()
    }
    const expected = terrain.heightAt(robot.position.x, robot.position.z)
    console.log(`at (${x}, ${z}): feet ${robot.position.y.toFixed(3)} ground ${expected.toFixed(3)}`)
    expect(Math.abs(robot.position.y - expected)).toBeLessThan(0.08)
  }
})
