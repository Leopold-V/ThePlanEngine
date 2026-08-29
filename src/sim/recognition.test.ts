import * as THREE from 'three'
import { expect, it } from 'vitest'
import { WorldModel } from './WorldModel.js'
import type { Sighting } from './perception.js'

function sighting(id: string, x: number, z: number, half = 0.2): Sighting {
  return {
    id,
    kind: 'block',
    position: new THREE.Vector3(x, 0.2, z),
    distance: Math.hypot(x, z),
    bearingDeg: 0,
    elevation: 0,
    halfX: half,
    halfZ: half
  }
}

it('something detected is anonymous until a camera names it', () => {
  const model = new WorldModel()
  model.update([sighting('red_block', 3, 0)], 0)

  const belief = model.all()[0]
  expect(belief?.identified).toBe(false)
  expect(belief?.label).toBe('unknown_1')

  // The model can act on it without knowing what it is.
  expect(model.knows('unknown_1')).toBe(true)

  model.recognise(['red_block'])
  expect(model.byLabel('red_block')?.identified).toBe(true)
  expect(model.byLabel('red_block')?.label).toBe('red_block')
})

it('a recognised object still answers to the handle it had before', () => {
  const model = new WorldModel()
  model.update([sighting('crate_2', 1, 4)], 0)
  model.recognise(['crate_2'])

  // The model may still be carrying "approach unknown_1" from an earlier turn.
  expect(model.byLabel('unknown_1')?.id).toBe('crate_2')
  expect(model.byLabel('crate_2')?.id).toBe('crate_2')
})

it('handles are stable across re-detection, and unique per object', () => {
  const model = new WorldModel()
  model.update([sighting('a', 1, 0), sighting('b', 0, 1)], 0)
  const first = model.all().map((b) => b.label).sort()
  expect(first).toEqual(['unknown_1', 'unknown_2'])

  // Seeing them again must not mint new handles.
  model.update([sighting('a', 1.2, 0), sighting('b', 0, 1.1)], 1)
  expect(model.all().map((b) => b.label).sort()).toEqual(first)
  expect(model.byLabel('unknown_1')?.x).toBeCloseTo(1.2, 5)
})

it('geometry keeps updating for something never identified', () => {
  const model = new WorldModel()
  model.update([sighting('boulder_4', 2, 2, 0.9)], 0)
  model.update([sighting('boulder_4', 2.5, 2, 0.9)], 1)

  const belief = model.byLabel('unknown_1')
  expect(belief?.identified).toBe(false)
  expect(belief?.x).toBeCloseTo(2.5, 5)
  // Extent is what steering needs, and detection alone provides it.
  expect(belief?.halfX).toBeCloseTo(0.9, 5)
  expect(belief?.halfZ).toBeCloseTo(0.9, 5)
})
