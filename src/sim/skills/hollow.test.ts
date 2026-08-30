import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { Robot } from '../Robot.js'
import { WorldModel } from '../WorldModel.js'
import { Terrain } from '../Terrain.js'
import { walkTo } from './walkTo.js'
import type { SkillContext } from './types.js'
import type { WorldView } from '../WorldView.js'
import type { TerrainSpec } from '@shared/terrain.js'

const STEP = 1 / 60

beforeAll(async () => {
  await RAPIER.init()
})

/**
 * A world made of a single hard step, so "the way on is up" is unambiguous.
 * Flat at z < 4, a wall of ground at z = 4, level again beyond it.
 */
const LEDGE: TerrainSpec = {
  seed: 1,
  halfExtent: 20,
  samples: 80,
  amplitude: 1,
  featureSize: 14,
  clearingRadius: 0,
  terraceStep: 0,
  waterLevel: -999
}

function ledgeWorld(rise: number) {
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  // Hand-built heights: a step of `rise` at z = 4.
  const spec = { ...LEDGE }
  const terrain = new Terrain(spec, RAPIER, physics)
  // Replace the collider with a two-level ramp-free step.
  const n = 40
  const size = 40
  const heights = new Float32Array((n + 1) * (n + 1))
  for (let col = 0; col <= n; col++) {
    for (let row = 0; row <= n; row++) {
      const z = -size / 2 + (row / n) * size
      heights[col * (n + 1) + row] = z > 4 ? rise : 0
    }
  }
  physics.createCollider(
    RAPIER.ColliderDesc.heightfield(n, n, heights, { x: size, y: 1, z: size })
  )

  const robot = new Robot(RAPIER, physics)
  robot.teleport(0, 0, 0)

  const waiters: Array<(dt: number) => void> = []
  const ctx = {
    world: {
      robot,
      objects: [],
      model: new WorldModel(),
      sightings: [],
      observationDetail: 'full',
      // The robot feels the ground a step ahead; that is what it steers on.
      groundHeightAt: (x: number, z: number) => (z > 4 ? rise : 0)
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

async function drive(run: Promise<{ ok: boolean; observation: string }>, w: ReturnType<typeof ledgeWorld>) {
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

it('a wall of ground is reported as ground, with the height to judge a jump by', async () => {
  const w = ledgeWorld(1.4)
  const result = await drive(walkTo.run(w.robot, { x: 0, z: 10 }, w.ctx), w)

  console.log(result.observation)
  expect(result.ok).toBe(false)
  // The old message said "try going round it", which is the wrong advice here.
  expect(result.observation).toContain('too steep to walk up')
  expect(result.observation).toContain('Jumping may clear it')
  // And it must say how high, or the model cannot tell 1.4m from 0.4m.
  expect(result.observation).toMatch(/rises \d\.\d\dm/)
})

it('says nothing about jumping when the ground is walkable', async () => {
  const w = ledgeWorld(0.15)
  const result = await drive(walkTo.run(w.robot, { x: 0, z: 8 }, w.ctx), w)

  console.log(result.observation)
  expect(result.observation).not.toContain('Jumping may clear it')
})
