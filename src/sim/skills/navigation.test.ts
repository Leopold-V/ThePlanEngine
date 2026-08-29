import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { Robot } from '../Robot.js'
import { WorldObject } from '../objects.js'
import { WorldModel } from '../WorldModel.js'
import { walkTo } from './walkTo.js'
import { stalls, type SkillContext } from './types.js'
import type { WorldView } from '../WorldView.js'
import type { ObjectSpec } from '@shared/scene.js'
import type { Sighting } from '../perception.js'

const STEP = 1 / 60

beforeAll(async () => {
  await RAPIER.init()
})

function obstacleSpec(id: string, size: [number, number, number], at: [number, number]): ObjectSpec {
  return {
    id,
    kind: 'boulder',
    color: 0x555555,
    size,
    position: [at[0], size[1] / 2, at[1]],
    graspable: false,
    mass: 500,
    fixed: true
  }
}

/** Flat ground and obstacles the robot has already seen and remembers. */
function scene(...specs: ObjectSpec[]): {
  physics: RAPIER.World
  robot: Robot
  ctx: SkillContext
  pump: () => void
} {
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  physics.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.1, 40).setTranslation(0, -0.1, 0))

  const obstacles = specs.map((spec) => new WorldObject(spec, RAPIER, physics))
  const robot = new Robot(RAPIER, physics)
  robot.teleport(0, 0, 0)

  const sightings: Sighting[] = specs.map((spec, i) => ({
    id: spec.id,
    kind: spec.kind,
    position: (obstacles[i] as WorldObject).position,
    distance: Math.hypot(spec.position[0], spec.position[2]),
    bearingDeg: 0,
    elevation: spec.size[1] / 2,
    halfX: spec.size[0] / 2,
    halfZ: spec.size[2] / 2
  }))

  // The robot has looked and remembers them. Those beliefs are all steering may use.
  const model = new WorldModel()
  model.update(sightings, 0)

  const waiters: Array<(dt: number) => void> = []
  const ctx = {
    world: {
      robot,
      objects: obstacles,
      model,
      sightings,
      groundHeightAt: () => 0
    } as unknown as WorldView,
    signal: new AbortController().signal,
    report: () => {},
    nextFrame: () => new Promise<number>((resolve) => waiters.push(resolve))
  } satisfies SkillContext

  return {
    physics,
    robot,
    ctx,
    pump: () => {
      for (const resolve of waiters.splice(0)) resolve(STEP)
    }
  }
}

async function drive(
  run: Promise<{ ok: boolean; observation: string }>,
  robot: Robot,
  physics: RAPIER.World,
  pump: () => void
): Promise<{ result: { ok: boolean; observation: string }; seconds: number }> {
  let frames = 0
  let done = false
  void run.then(() => (done = true))
  while (!done && frames < 60 * 60) {
    pump()
    await Promise.resolve()
    robot.update(STEP)
    physics.step()
    frames++
  }
  return { result: await run, seconds: frames / 60 }
}

it('walks around a boulder in its path and still arrives', async () => {
  const { physics, robot, ctx, pump } = scene(obstacleSpec('boulder_1', [1.2, 1.5, 1.2], [0, 4]))

  const { result, seconds } = await drive(
    walkTo.run(robot, { x: 0, z: 9 }, ctx),
    robot,
    physics,
    pump
  )

  console.log(`arrived in ${seconds.toFixed(1)}s:`, result.observation)
  expect(result.ok).toBe(true)
  expect(result.observation).toContain('Went around boulder_1')
  expect(robot.distanceTo(0, 9)).toBeLessThan(0.3)
  // It had to leave the straight line to get there.
  expect(seconds).toBeGreaterThan(9 / 1.4)
})

it('gives up on a wall too wide to round, and says what stopped it', async () => {
  const { physics, robot, ctx, pump } = scene(obstacleSpec('boulder_1', [14, 2, 1], [0, 4]))

  const { result, seconds } = await drive(
    walkTo.run(robot, { x: 0, z: 9 }, ctx),
    robot,
    physics,
    pump
  )

  console.log(`gave up in ${seconds.toFixed(1)}s:`, result.observation)
  expect(result.ok).toBe(false)
  expect(result.observation).toContain('Blocked')
  expect(seconds).toBeLessThan(12)
})

it('goes straight when the way is clear', async () => {
  const { physics, robot, ctx, pump } = scene(obstacleSpec('boulder_1', [1, 1, 1], [12, 0]))

  const { result } = await drive(walkTo.run(robot, { x: 0, z: 8 }, ctx), robot, physics, pump)

  console.log('unobstructed:', result.observation)
  expect(result.ok).toBe(true)
  // Nothing was in the way, so nothing should be reported as avoided.
  expect(result.observation).not.toContain('Went around')
})

it('threads through a cluster without oscillating', async () => {
  // Several obstacles in range at once is where a naive repulsion field
  // deadlocks or dithers between two equally bad directions.
  const specs: ObjectSpec[] = [
    obstacleSpec('boulder_1', [1.4, 1.2, 1.4], [0.4, 3]),
    obstacleSpec('boulder_2', [1.2, 1.0, 1.2], [-1.8, 5]),
    obstacleSpec('boulder_3', [1.6, 1.4, 1.6], [1.6, 6.5]),
    obstacleSpec('boulder_4', [1.0, 0.9, 1.0], [-0.6, 8.5])
  ]
  const { physics, robot, ctx, pump } = scene(...specs)

  const { result, seconds } = await drive(
    walkTo.run(robot, { x: 0, z: 11 }, ctx),
    robot,
    physics,
    pump
  )

  console.log(`cluster in ${seconds.toFixed(1)}s:`, result.observation)
  expect(result.ok).toBe(true)
  expect(robot.distanceTo(0, 11)).toBeLessThan(0.3)
  // Dithering would burn the budget; a route through should not be far off
  // the straight-line time of ~8s.
  expect(seconds).toBeLessThan(16)
})

it('rounds the end of a long wall instead of fleeing its centre', async () => {
  // 14m long, half a metre thick. Treated as a circle this is a 7m radius
  // centred on (0,4) — an obstacle covering ground it does not occupy, which
  // shoves the robot away from the very gap it needs.
  const { physics, robot, ctx, pump } = scene(obstacleSpec('boulder_1', [14, 2, 0.5], [0, 4]))

  const { result, seconds } = await drive(
    walkTo.run(robot, { x: 10, z: 8 }, ctx),
    robot,
    physics,
    pump
  )

  console.log(`past the wall in ${seconds.toFixed(1)}s:`, result.observation)
  expect(result.ok).toBe(true)
  expect(robot.distanceTo(10, 8)).toBeLessThan(0.4)
  // It had to go round the end, so it is longer than the 12.8m straight line —
  // but nothing like the sweep a phantom 7m circle would have forced.
  expect(seconds).toBeLessThan(28)
})

it('stalls() reports only after progress genuinely stops', () => {
  const stalled = stalls(2)
  for (let i = 0; i < 600; i++) expect(stalled(10 - i * 0.01, STEP)).toBe(false)
  expect(stalled(4, STEP)).toBe(false)
  let firedAt: number | null = null
  for (let i = 1; i <= 240 && firedAt === null; i++) {
    if (stalled(4, STEP)) firedAt = i * STEP
  }
  expect(firedAt).not.toBeNull()
  expect(firedAt as number).toBeCloseTo(2, 1)
})
