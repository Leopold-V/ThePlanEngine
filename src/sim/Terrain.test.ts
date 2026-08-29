import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { Terrain } from './Terrain.js'
import { FLAT_TERRAIN, type TerrainSpec } from '@shared/terrain.js'

const ROLLING: TerrainSpec = {
  seed: 7,
  halfExtent: 25,
  samples: 48,
  amplitude: 3,
  featureSize: 14,
  clearingRadius: 4
}

beforeAll(async () => {
  await RAPIER.init()
})

/** Deliberately asymmetric: a transposed heightfield would pass on x === z. */
const PROBES: [number, number][] = [
  [0, 0], [1, 9], [-7, 2], [12, -18], [-20, -3], [3, 21],
  [-14, 14], [22, 5], [8, -11], [-2, -23], [17, 17.5], [-11.3, 6.7]
]

function groundUnder(physics: RAPIER.World, x: number, z: number): number | null {
  const ray = new RAPIER.Ray({ x, y: 60, z }, { x: 0, y: -1, z: 0 })
  const hit = physics.castRay(ray, 200, true)
  if (!hit) return null
  return 60 - hit.timeOfImpact
}

it('the collider agrees with heightAt on rolling terrain', () => {
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const terrain = new Terrain(ROLLING, RAPIER, physics)
  physics.step()

  let worst = 0
  let worstTransposed = 0
  let worstAt: unknown = null
  for (const [x, z] of PROBES) {
    const actual = groundUnder(physics, x, z)
    expect(actual, `no ground under (${x}, ${z})`).not.toBeNull()
    const expected = terrain.heightAt(x, z)
    const error = Math.abs((actual as number) - expected)
    // If the collider is transposed relative to the mesh, the ray will instead
    // agree with the height sampled at the swapped coordinates.
    worstTransposed = Math.max(
      worstTransposed,
      Math.abs((actual as number) - terrain.heightAt(z, x))
    )
    if (error > worst) {
      worst = error
      worstAt = { x, z, ray: +(actual as number).toFixed(3), heightAt: +expected.toFixed(3) }
    }
  }

  console.log('worst as written:', +worst.toFixed(4), worstAt)
  console.log('worst if transposed:', +worstTransposed.toFixed(4))
  // Bilinear against Rapier's triangulated facets: close, not identical.
  expect(worst).toBeLessThan(0.05)
  // The real assertion — an order of magnitude apart proves the axes are right.
  expect(worstTransposed).toBeGreaterThan(worst * 10)
})

it('spawns level ground in the clearing, and real relief outside it', () => {
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const terrain = new Terrain(ROLLING, RAPIER, physics)

  expect(Math.abs(terrain.heightAt(0, 0))).toBeLessThan(0.001)
  expect(Math.abs(terrain.heightAt(2, 2))).toBeLessThan(0.001)

  let lowest = Infinity
  let highest = -Infinity
  for (let x = -24; x <= 24; x += 1.5) {
    for (let z = -24; z <= 24; z += 1.5) {
      const h = terrain.heightAt(x, z)
      lowest = Math.min(lowest, h)
      highest = Math.max(highest, h)
    }
  }
  console.log('relief:', { lowest: +lowest.toFixed(2), highest: +highest.toFixed(2) })
  expect(highest - lowest).toBeGreaterThan(1.5)
})

it('a flat spec is still exactly flat', () => {
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const terrain = new Terrain(FLAT_TERRAIN, RAPIER, physics)
  physics.step()

  for (const [x, z] of PROBES) {
    expect(terrain.heightAt(x, z)).toBe(0)
    expect(groundUnder(physics, x, z)).toBeCloseTo(0, 5)
  }
  expect(terrain.grid).not.toBeNull()
})
