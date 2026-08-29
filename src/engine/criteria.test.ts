import { describe, expect, it } from 'vitest'
import type { WorldSnapshot } from '@shared/scenario.js'
import { allPassed, evaluate } from './criteria.js'

/**
 * The whole score rests on these predicates, so they are the first thing in the
 * project to get tests. Pure functions over a data snapshot: no GPU, no
 * network, no tokens.
 */

const UP = { x: 0, y: 1, z: 0 }

/** Table top sits at 0.75; a 0.3 block resting on it has its centre at 0.90. */
const table = { id: 'table', x: 5, y: 0.375, z: 1, size: [1.6, 0.75, 1.0] as const, up: UP }

function world(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    robot: { x: 0, z: 0, holding: null },
    objects: [{ ...table, size: [...table.size] as [number, number, number] }],
    ...overrides
  }
}

function block(x: number, y: number, z: number, up = UP): WorldSnapshot['objects'][number] {
  return { id: 'red_block', x, y, z, size: [0.3, 0.3, 0.3], up }
}

describe('object_on', () => {
  const criterion = { type: 'object_on', object: 'red_block', surface: 'table' } as const

  it('passes when the block rests on the surface', () => {
    const w = world({ objects: [table as never, block(5, 0.9, 1)] })
    expect(evaluate([criterion], w)[0]?.passed).toBe(true)
  })

  it('fails when the block is on the floor beside the table', () => {
    const w = world({ objects: [table as never, block(5, 0.15, 1)] })
    const result = evaluate([criterion], w)[0]
    expect(result?.passed).toBe(false)
    expect(result?.detail).toContain('base sits')
  })

  it('fails when the block is at the right height but not over the table', () => {
    const w = world({ objects: [table as never, block(0, 0.9, 0)] })
    const result = evaluate([criterion], w)[0]
    expect(result?.passed).toBe(false)
    expect(result?.detail).toContain('outside the table footprint')
  })

  it('allows a small overhang at the table edge', () => {
    // Table spans x 4.2–5.8; just past the edge is still resting on it.
    const w = world({ objects: [table as never, block(5.83, 0.9, 1)] })
    expect(evaluate([criterion], w)[0]?.passed).toBe(true)
  })

  it('reports a missing object rather than throwing', () => {
    const result = evaluate([criterion], world())[0]
    expect(result?.passed).toBe(false)
    expect(result?.detail).toContain('No object called "red_block"')
  })
})

describe('holding', () => {
  it('passes for empty hands when nothing is held', () => {
    const result = evaluate([{ type: 'holding', object: null }], world())[0]
    expect(result?.passed).toBe(true)
  })

  it('fails for empty hands when the robot is still carrying something', () => {
    const w = world({ robot: { x: 0, z: 0, holding: 'red_block' } })
    const result = evaluate([{ type: 'holding', object: null }], w)[0]
    expect(result?.passed).toBe(false)
    expect(result?.detail).toContain('holding red_block')
  })

  it('passes when carrying the named object', () => {
    const w = world({ robot: { x: 0, z: 0, holding: 'red_block' } })
    expect(evaluate([{ type: 'holding', object: 'red_block' }], w)[0]?.passed).toBe(true)
  })
})

describe('object_upright', () => {
  const criterion = { type: 'object_upright', object: 'red_block' } as const

  it('passes when the block is level', () => {
    const w = world({ objects: [block(0, 0.15, 0)] })
    expect(evaluate([criterion], w)[0]?.passed).toBe(true)
  })

  it('fails when the block has toppled onto its side', () => {
    const w = world({ objects: [block(0, 0.15, 0, { x: 1, y: 0, z: 0 })] })
    const result = evaluate([criterion], w)[0]
    expect(result?.passed).toBe(false)
    expect(result?.detail).toContain('90°')
  })

  it('tolerates a slight lean', () => {
    const w = world({ objects: [block(0, 0.15, 0, { x: 0.17, y: 0.985, z: 0 })] })
    expect(evaluate([criterion], w)[0]?.passed).toBe(true)
  })
})

describe('distance predicates', () => {
  it('object_near passes inside the radius and fails outside it', () => {
    const w = world({ objects: [block(1, 0.15, 0)] })
    const near = { type: 'object_near', object: 'red_block', x: 0, z: 0, within: 1.5 } as const
    const far = { type: 'object_near', object: 'red_block', x: 0, z: 0, within: 0.5 } as const
    expect(evaluate([near], w)[0]?.passed).toBe(true)
    expect(evaluate([far], w)[0]?.passed).toBe(false)
  })

  it('robot_near measures from the robot', () => {
    const w = world({ robot: { x: 3, z: 4, holding: null } })
    const criterion = { type: 'robot_near', x: 0, z: 0, within: 5 } as const
    const result = evaluate([criterion], w)[0]
    expect(result?.passed).toBe(true)
    expect(result?.detail).toContain('5.00m away')
  })
})

describe('allPassed', () => {
  it('is false for an empty criteria list, so a scenario cannot pass vacuously', () => {
    expect(allPassed([])).toBe(false)
  })

  it('requires every criterion', () => {
    const results = [
      { label: 'a', passed: true, detail: '' },
      { label: 'b', passed: false, detail: '' }
    ]
    expect(allPassed(results)).toBe(false)
    expect(allPassed([results[0] as never])).toBe(true)
  })
})
