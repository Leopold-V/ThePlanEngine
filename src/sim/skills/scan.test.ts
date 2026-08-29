import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { Robot } from '../Robot.js'
import { WorldObject } from '../objects.js'
import { WorldModel } from '../WorldModel.js'
import { perceive, DEFAULT_PERCEPTION } from '../perception.js'
import { scan } from './scan.js'
import type { SkillContext } from './types.js'
import type { WorldView } from '../WorldView.js'
import { blockSpec, BLOCK_COLORS } from '@shared/scene.js'

const STEP = 1 / 60

beforeAll(async () => {
  await RAPIER.init()
})

/** A ring of blocks, so a sweep has to come most of the way round to see them. */
function scene(): {
  physics: RAPIER.World
  robot: Robot
  model: WorldModel
  ctx: SkillContext
  step: () => void
} {
  const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  physics.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.1, 40).setTranslation(0, -0.1, 0))

  const objects = [
    new WorldObject(blockSpec('red_block', BLOCK_COLORS.red, [3, 0.15, 0]), RAPIER, physics),
    new WorldObject(blockSpec('blue_block', BLOCK_COLORS.blue, [-3, 0.15, 0]), RAPIER, physics),
    new WorldObject(blockSpec('green_block', BLOCK_COLORS.green, [0, 0.15, -3]), RAPIER, physics)
  ]

  const robot = new Robot(RAPIER, physics)
  robot.teleport(0, 0, 0)

  const model = new WorldModel()
  let sightings = perceive(robot, objects, physics, RAPIER, DEFAULT_PERCEPTION)

  const waiters: Array<(dt: number) => void> = []
  const ctx = {
    world: {
      robot,
      objects,
      model,
      get sightings() {
        return sightings
      },
      now: 0,
      observationDetail: 'full',
      groundHeightAt: () => 0
    } as unknown as WorldView,
    signal: new AbortController().signal,
    report: () => {},
    nextFrame: () => new Promise<number>((resolve) => waiters.push(resolve))
  } satisfies SkillContext

  return {
    physics,
    robot,
    model,
    ctx,
    step: () => {
      for (const resolve of waiters.splice(0)) resolve(STEP)
      robot.update(STEP)
      physics.step()
      // Perception runs on its own, as it does in the world.
      sightings = perceive(robot, objects, physics, RAPIER, DEFAULT_PERCEPTION)
      model.update(sightings, 0)
    }
  }
}

async function runScan(
  robot: Robot,
  ctx: SkillContext,
  step: () => void
): Promise<{ observation: string; turned: number; seconds: number }> {
  let turned = 0
  let previous = robot.heading
  let frames = 0
  let done = false

  const run = scan.run(robot, {}, ctx)
  void run.then(() => (done = true))
  while (!done && frames < 60 * 30) {
    step()
    await Promise.resolve()
    let delta = robot.heading - previous
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    turned += Math.abs(delta)
    previous = robot.heading
    frames++
  }

  return { observation: (await run).observation, turned, seconds: frames / 60 }
}

it('turns one circle, not two, and comes back to where it started', async () => {
  const { robot, ctx, step } = scene()
  const start = robot.heading

  const { turned, seconds, observation } = await runScan(robot, ctx, step)
  console.log(`${(turned / (Math.PI * 2)).toFixed(2)} turns in ${seconds.toFixed(1)}s:`, observation)

  // One revolution plus the small correction, nowhere near the old two.
  expect(turned).toBeGreaterThan(Math.PI * 1.8)
  expect(turned).toBeLessThan(Math.PI * 2.6)

  let offBy = robot.heading - start
  while (offBy > Math.PI) offBy -= Math.PI * 2
  while (offBy < -Math.PI) offBy += Math.PI * 2
  expect(Math.abs(offBy)).toBeLessThan(0.05)
})

it('reports what it found, then reports nothing new on a repeat', async () => {
  const { robot, ctx, step } = scene()

  const first = await runScan(robot, ctx, step)
  console.log('first:', first.observation)
  expect(first.observation).toContain('Found:')
  expect(first.observation).toContain('blue_block')

  const second = await runScan(robot, ctx, step)
  console.log('second:', second.observation)
  expect(second.observation).toContain('Nothing new')
  expect(second.observation).not.toContain('Found:')
})

it('still enumerates everything in proprioceptive mode, where nothing else does', async () => {
  const { robot, ctx, step } = scene()
  ;(ctx.world as { observationDetail: string }).observationDetail = 'proprioceptive'

  await runScan(robot, ctx, step)
  // The second scan is the one that used to say "nothing new" and strand the
  // model, because the observation in this mode names no objects at all.
  const second = await runScan(robot, ctx, step)

  console.log('proprioceptive repeat:', second.observation)
  expect(second.observation).toContain('In view:')
  expect(second.observation).toContain('red_block')
  expect(second.observation).toContain('blue_block')
  expect(second.observation).toContain('green_block')
})

it('reports an object that moved since it was last seen', async () => {
  const { robot, ctx, step, physics } = scene()
  await runScan(robot, ctx, step)

  // Shift the red block well away while the robot is not looking at it.
  const red = (ctx.world.objects as WorldObject[]).find((o) => o.spec.id === 'red_block')
  red?.moveTo(1, 0.15, 3)
  physics.step()

  const after = await runScan(robot, ctx, step)
  console.log('after moving:', after.observation)
  expect(after.observation).toContain('red_block has moved')
})
