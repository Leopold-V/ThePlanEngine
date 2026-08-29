import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { Robot } from '../Robot.js'
import { WorldObject } from '../objects.js'
import { walkTo } from './walkTo.js'
import { stalls, type SkillContext } from './types.js'
import type { WorldView } from '../WorldView.js'
import type { Sighting } from '../perception.js'

const STEP = 1 / 60

beforeAll(async () => {
  await RAPIER.init()
})

it('stalls() reports only after progress genuinely stops', () => {
  const stalled = stalls(2)
  // Closing in: never stalled, however long it takes.
  for (let i = 0; i < 600; i++) expect(stalled(10 - i * 0.01, STEP)).toBe(false)
  // Stuck at the same distance: quiet until the window elapses, then true.
  expect(stalled(4, STEP)).toBe(false)
  let firedAt: number | null = null
  for (let i = 1; i <= 240 && firedAt === null; i++) {
    if (stalled(4, STEP)) firedAt = i * STEP
  }
  expect(firedAt).not.toBeNull()
  expect(firedAt as number).toBeCloseTo(2, 1)
})

it('walking into a wall reports what blocked it, long before the timeout', async () => {
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  physics.createCollider(RAPIER.ColliderDesc.cuboid(25, 0.1, 25).setTranslation(0, -0.1, 0))

  // A wall across the route, too tall to autostep or climb.
  const wall = new WorldObject(
    {
      id: 'boulder_1',
      kind: 'boulder',
      color: 0x555555,
      size: [6, 2, 1],
      position: [0, 1, 4],
      graspable: false,
      mass: 500,
      fixed: true
    },
    RAPIER,
    physics
  )

  const robot = new Robot(RAPIER, physics)
  robot.teleport(0, 0, 0)

  const waiters: Array<(dt: number) => void> = []
  const sighting: Sighting = {
    id: 'boulder_1',
    kind: 'boulder',
    position: wall.position,
    distance: 1.2,
    bearingDeg: 3,
    elevation: 1
  }
  const ctx = {
    world: { objects: [wall], sightings: [sighting] } as unknown as WorldView,
    signal: new AbortController().signal,
    report: () => {},
    nextFrame: () => new Promise<number>((resolve) => waiters.push(resolve))
  } satisfies SkillContext

  // Target is beyond the wall, so it can never arrive.
  const run = walkTo.run(robot, { x: 0, z: 10 }, ctx)

  let frames = 0
  const settled = { done: false }
  void run.then(() => (settled.done = true))
  while (!settled.done && frames < 60 * 40) {
    for (const resolve of waiters.splice(0)) resolve(STEP)
    await Promise.resolve()
    robot.update(STEP)
    physics.step()
    frames++
  }

  const result = await run
  const seconds = frames / 60
  console.log(`gave up after ${seconds.toFixed(1)}s:`, result.observation)

  expect(result.ok).toBe(false)
  expect(result.observation).toContain('Blocked')
  expect(result.observation).toContain('boulder_1')
  // The point of the whole thing: far sooner than the ~15s budget would allow.
  expect(seconds).toBeLessThan(8)
})
