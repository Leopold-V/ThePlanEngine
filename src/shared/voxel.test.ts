import { expect, it } from 'vitest'
import { BLOCK, DEFAULT_VOXEL, generateVoxelWorld, isSolid, type VoxelSpec } from './voxel.js'

const SPEC: VoxelSpec = { ...DEFAULT_VOXEL, seed: 21 }

it('the clearing is level and its surface is exactly y = 0', () => {
  const world = generateVoxelWorld(SPEC)
  for (const [x, z] of [[0, 0], [1, 1], [-2, 2], [3, -1]] as const) {
    expect(world.groundHeightAt(x, z)).toBeCloseTo(0, 10)
  }
})

it('ground height is exact, not interpolated', () => {
  const world = generateVoxelWorld(SPEC)
  const size = SPEC.blockSize
  // Every answer must land on a block boundary. The heightfield could not do
  // this: it returned values between the facets of its own collider.
  for (let x = -20; x <= 20; x += 0.37) {
    for (let z = -20; z <= 20; z += 1.13) {
      const h = world.groundHeightAt(x, z)
      expect(Math.abs(h / size - Math.round(h / size))).toBeLessThan(1e-9)
    }
  }
})

it('has ledges of whole blocks, including ones that need a jump', () => {
  const world = generateVoxelWorld(SPEC)
  let oneBlock = 0
  let twoOrMore = 0
  for (let x = -24; x <= 24; x += 0.5) {
    for (let z = -24; z <= 24; z += 2) {
      const rise = world.groundHeightAt(x + 0.5, z) - world.groundHeightAt(x, z)
      if (rise > 0.9) twoOrMore++
      else if (rise > 0.4) oneBlock++
    }
  }
  console.log('ledges:', { steppable: oneBlock, needJump: twoOrMore })
  expect(oneBlock).toBeGreaterThan(0)
  expect(twoOrMore).toBeGreaterThan(0)
})

it('carves caves, which is the thing a heightfield could not represent', () => {
  const world = generateVoxelWorld({ ...SPEC, caves: true })
  // An overhang: air with solid rock above it somewhere in the same column.
  let overhangs = 0
  for (let bx = 0; bx < world.sizeX; bx += 3) {
    for (let bz = 0; bz < world.sizeZ; bz += 3) {
      let seenAir = false
      for (let by = 1; by < world.sizeY; by++) {
        const solid = isSolid(world.get(bx, by, bz))
        if (!solid) seenAir = true
        else if (seenAir) {
          overhangs++
          break
        }
      }
    }
  }
  console.log('columns with rock above a void:', overhangs)
  expect(overhangs).toBeGreaterThan(0)
})

it('is identical for the same seed and different for another', () => {
  const a = generateVoxelWorld(SPEC)
  const b = generateVoxelWorld(SPEC)
  const c = generateVoxelWorld({ ...SPEC, seed: 22 })

  let same = 0
  let differs = 0
  for (let x = -25; x <= 25; x += 1) {
    for (let z = -25; z <= 25; z += 1) {
      if (a.groundHeightAt(x, z) === b.groundHeightAt(x, z)) same++
      if (a.groundHeightAt(x, z) !== c.groundHeightAt(x, z)) differs++
    }
  }
  expect(same).toBe(51 * 51)
  // A new seed is a new world, which is the whole point of a reroll.
  expect(differs).toBeGreaterThan(51 * 51 * 0.5)
})

it('puts water in the low ground and sand on its shore', () => {
  const world = generateVoxelWorld(SPEC)
  let water = 0
  let sand = 0
  for (let bx = 0; bx < world.sizeX; bx += 2) {
    for (let bz = 0; bz < world.sizeZ; bz += 2) {
      for (let by = 0; by < world.sizeY; by++) {
        if (world.get(bx, by, bz) === BLOCK.water) water++
      }
      if (world.surfaceBlockAt(bx * SPEC.blockSize - SPEC.halfExtent, bz * SPEC.blockSize - SPEC.halfExtent) === BLOCK.sand) sand++
    }
  }
  console.log('water blocks:', water, 'sand columns:', sand)
  expect(water).toBeGreaterThan(0)
  expect(sand).toBeGreaterThan(0)
})
