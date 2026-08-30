import * as THREE from 'three'
import { expect, it } from 'vitest'
import type { Robot } from './Robot.js'
import { DEFAULT_PERCEPTION } from './perception.js'
import { senseGround } from './terrainSense.js'

/**
 * `senseGround` only reads a position, a heading and a ground function, so it
 * needs no physics — which keeps these tests about the thresholds themselves.
 */
function standing(): Robot {
  return { position: new THREE.Vector3(0, 0, 0), sensorHeading: 0 } as unknown as Robot
}

/** Level ground that steps up to `height` at `from` metres and stays there. */
function stepAt(from: number, height: number): (x: number, z: number) => number {
  return (_x, z) => (z >= from ? height : 0)
}

function ahead(readings: { bearingDeg: number; distance: number; rise: number }[]) {
  return readings.find((r) => Math.abs(r.bearingDeg) < 1e-6)
}

it('reports a hill far enough away to be worth walking towards', () => {
  const readings = senseGround(standing(), stepAt(30, 3), DEFAULT_PERCEPTION)

  const straightAhead = ahead(readings)
  expect(straightAhead).toBeDefined()
  expect(straightAhead?.rise).toBeCloseTo(3, 5)
  expect(straightAhead?.distance).toBeGreaterThanOrEqual(30)
})

it('stays silent about a bump too small to matter at that distance', () => {
  // 0.8m clears the near-field floor but not the threshold 30m out, where the
  // ground has to rise 1.5m to be news. Silence on level ground is the feature.
  expect(senseGround(standing(), stepAt(30, 0.8), DEFAULT_PERCEPTION)).toEqual([])
})

it('still reports a step right in front of it, exactly as before', () => {
  const straightAhead = ahead(senseGround(standing(), stepAt(3, 0.7), DEFAULT_PERCEPTION))

  expect(straightAhead?.rise).toBeCloseTo(0.7, 5)
  expect(straightAhead?.distance).toBeCloseTo(3, 5)
})
