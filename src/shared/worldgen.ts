import type { ObjectSpec, SceneDefinition, WorldGenSpec } from './scene.js'
import {
  buildHeightField,
  sampledHeightAt,
  FLAT_TERRAIN,
  type TerrainSpec
} from './terrain.js'

/**
 * Turns a seed into a world.
 *
 * Everything here is a pure function of the spec, which is the property the
 * rest of the app leans on: a scenario stores four numbers, and the same four
 * numbers rebuild the identical landscape on any machine, so a score stays
 * attributable to a world that can be regenerated rather than to one that
 * happened to be on disk.
 *
 * The output is ordinary `ObjectSpec`s and a `TerrainSpec`. Nothing downstream
 * — perception, criteria, the snapshot — can tell a generated world from a
 * hand-written one, which is the whole reason the two collapse here.
 */

export interface ResolvedScene {
  objects: ObjectSpec[]
  terrain: TerrainSpec
}

/** Collapses either kind of scene document into contents the world can load. */
export function resolveScene(scene: SceneDefinition): ResolvedScene {
  if (scene.generate) return generate(scene.generate)
  return {
    objects: scene.objects ?? [],
    terrain: scene.terrain ?? FLAT_TERRAIN
  }
}

export function terrainSpecFor(spec: WorldGenSpec): TerrainSpec {
  return {
    seed: spec.seed,
    halfExtent: spec.halfExtent,
    // About a two-metre cell: fine enough to walk over, coarse enough to build.
    samples: Math.max(8, Math.round(spec.halfExtent)),
    amplitude: spec.hilliness * 2.4,
    featureSize: 14,
    clearingRadius: 5
  }
}

/** Nothing spawns closer than this to the origin, so a run starts in the open. */
const CLEARING = 6
/** Props this close together read as a pile rather than as scenery. */
const MIN_SEPARATION = 1.7
/**
 * Props are placed this far above the ground and left to fall. The height
 * lookup approximates the collider to within a few centimetres, so placing
 * flush would embed some of them — see `sampledHeightAt`.
 */
const SETTLE_MARGIN = 0.04

const CRATE_COLORS = [0xb5763f, 0xa8683a, 0xc08a4d]
const BOULDER_COLORS = [0x4a4e58, 0x555a66, 0x3f434c]

function generate(spec: WorldGenSpec): ResolvedScene {
  const terrain = terrainSpecFor(spec)
  const field = buildHeightField(terrain)
  const random = mulberry32(spec.seed)

  const area = (spec.halfExtent * 2) ** 2
  const total = Math.max(6, Math.round((spec.density * area) / 100))
  const crates = Math.round(total * 0.4)
  const boulders = Math.round(total * 0.45)
  const posts = Math.max(2, total - crates - boulders)

  const taken: { x: number; z: number }[] = []
  const objects: ObjectSpec[] = []

  const place = (): { x: number; z: number } | null => {
    const limit = spec.halfExtent - 2
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = (random() * 2 - 1) * limit
      const z = (random() * 2 - 1) * limit
      if (Math.hypot(x, z) < CLEARING) continue
      if (taken.some((p) => Math.hypot(p.x - x, p.z - z) < MIN_SEPARATION)) continue
      taken.push({ x, z })
      return { x, z }
    }
    return null
  }

  const add = (
    id: string,
    kind: ObjectSpec['kind'],
    size: [number, number, number],
    color: number,
    graspable: boolean,
    mass: number,
    fixed: boolean
  ): void => {
    const spot = place()
    if (!spot) return
    const ground = sampledHeightAt(field, spot.x, spot.z)
    objects.push({
      id,
      kind,
      color,
      size,
      position: [spot.x, ground + size[1] / 2 + SETTLE_MARGIN, spot.z],
      graspable,
      mass,
      ...(fixed ? { fixed: true } : {})
    })
  }

  // Crates are the things worth carrying, so they stay a graspable block size.
  for (let i = 1; i <= crates; i++) {
    const side = 0.3 + random() * 0.12
    add(`crate_${i}`, 'block', [side, side, side], pick(random, CRATE_COLORS), true, 1, false)
  }

  // Boulders are the obstacles and the things worth climbing. Sized across the
  // range that matters: some walkable-over, some needing a jump.
  for (let i = 1; i <= boulders; i++) {
    const width = 0.8 + random() * 1.6
    const height = 0.35 + random() * 0.95
    const depth = 0.8 + random() * 1.6
    add(
      `boulder_${i}`,
      'boulder',
      [width, height, depth],
      pick(random, BOULDER_COLORS),
      false,
      60,
      true
    )
  }

  // Tall, thin and brightly coloured: something to navigate by from a distance.
  for (let i = 1; i <= posts; i++) {
    add(`post_${i}`, 'marker', [0.22, 1.6 + random() * 0.8, 0.22], 0xf5c451, false, 5, true)
  }

  return { objects, terrain }
}

function pick(random: () => number, from: number[]): number {
  return from[Math.floor(random() * from.length)] as number
}

/** Mulberry32: small, fast, and identical across engines. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
