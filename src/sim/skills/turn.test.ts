import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { Robot } from '../Robot.js'
import { WorldModel } from '../WorldModel.js'
import { turn } from './turn.js'
import { scan } from './scan.js'
import type { SkillContext } from './types.js'
import type { WorldView } from '../WorldView.js'

const STEP = 1 / 60

beforeAll(async () => {
  await RAPIER.init()
})

function rig(): { robot: Robot; ctx: SkillContext; run: (p: Promise<unknown>) => Promise<void> } {
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  physics.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.1, 40).setTranslation(0, -0.1, 0))
  const robot = new Robot(RAPIER, physics)
  robot.teleport(0, 0, 0)

  const waiters: Array<(dt: number) => void> = []
  const ctx = {
    world: {
      robot,
      objects: [],
      model: new WorldModel(),
      sightings: [],
      groundHeightAt: () => 0
    } as unknown as WorldView,
    signal: new AbortController().signal,
    report: () => {},
    nextFrame: () => new Promise<number>((resolve) => waiters.push(resolve))
  } satisfies SkillContext

  const run = async (p: Promise<unknown>): Promise<void> => {
    let done = false
    void p.then(() => (done = true))
    let frames = 0
    while (!done && frames < 60 * 40) {
      for (const resolve of waiters.splice(0)) resolve(STEP)
      await Promise.resolve()
      robot.update(STEP)
      physics.step()
      frames++
    }
  }

  return { robot, ctx, run }
}

/** Degrees the sim keeps rotating after a skill hands back, before the next starts. */
async function coast(robot: Robot, frames: number): Promise<number> {
  const before = robot.headingDegrees
  for (let i = 0; i < frames; i++) robot.update(STEP)
  let drift = robot.headingDegrees - before
  while (drift > 180) drift -= 360
  while (drift < -180) drift += 360
  return drift
}

it('turn lands on the angle it reports', async () => {
  const { robot, ctx, run } = rig()
  const start = robot.headingDegrees

  const p = turn.run(robot, { degrees: -70 }, ctx)
  await run(p)
  const result = await p

  console.log(`from ${start.toFixed(0)}° ->`, result.observation)
  expect(result.ok).toBe(true)
  expect(robot.headingDegrees).toBeCloseTo(290, 0)
})

it('does not keep coasting after the skill returns', async () => {
  const { robot, ctx, run } = rig()

  const p = turn.run(robot, { degrees: 90 }, ctx)
  await run(p)
  await p

  // A quarter second of simulation, which is far less than a model call takes.
  const drift = await coast(robot, 15)
  console.log(`coasted ${drift.toFixed(1)}° after turn returned`)
  expect(Math.abs(drift)).toBeLessThan(1)
})

it('a scan leaves the heading where it found it, and does not coast', async () => {
  const { robot, ctx, run } = rig()
  const start = robot.headingDegrees

  const p = scan.run(robot, {}, ctx)
  await run(p)
  await p

  let offBy = robot.headingDegrees - start
  while (offBy > 180) offBy -= 360
  while (offBy < -180) offBy += 360
  const drift = await coast(robot, 30)
  console.log(`scan ended ${offBy.toFixed(1)}° off, then coasted ${drift.toFixed(1)}°`)

  expect(Math.abs(offBy)).toBeLessThan(2)
  expect(Math.abs(drift)).toBeLessThan(2)
})
