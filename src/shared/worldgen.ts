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
    // Roughly a 0.55m cell. Coarser than this and a terrace edge becomes a
    // ramp: the collider interpolates across the cell, so a 0.85m drop spread
    // over 0.8m is a 46° slope — inside the 45° the robot can walk up, give or
    // take, which turns the ledge it was meant to jump into a gentle stroll.
    samples: Math.max(16, Math.round(spec.halfExtent * 3.6)),
    amplitude: spec.hilliness * 3.4,
    featureSize: 14,
    clearingRadius: 5,
    // Just under the robot's 1.1m ceiling, so a ledge is always clearable by a
    // deliberate jump and never by walking.
    terraceStep: 0.85
  }
}

/** Nothing spawns closer than this to the origin, so a run starts in the open. */
const CLEARING = 6
/** Rough centres props gather around, giving the map dense patches and open ground. */
const CLUSTERS = 5
/** Props this close together read as a pile rather than as scenery. */
const MIN_SEPARATION = 1.7
/**
 * Props are placed this far above the ground and left to fall. The height
 * lookup approximates the collider to within a few centimetres, so placing
 * flush would embed some of them — see `sampledHeightAt`.
 */
const SETTLE_MARGIN = 0.04

const CRATE_COLORS = [0xb5763f, 0xa8683a, 0xc08a4d]
/**
 * Lighter than the ground they sit on. Rock the same value as the terrain reads
 * as a hole rather than as a boulder, especially in the robot's own camera.
 */
const BOULDER_COLORS = [0x7a8090, 0x8b8f9c, 0x6d7382]

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
  const limit = spec.halfExtent - 2

  /**
   * Rock fields and stands of posts, not confetti.
   *
   * Uniform scatter is what makes a generated world read as noise: everything
   * evenly spaced, no clearings worth crossing and no clumps worth going round.
   * Props are drawn around a handful of centres instead, so the map gets dense
   * patches and open ground.
   */
  const centres = Array.from({ length: CLUSTERS }, () => {
    const angle = random() * Math.PI * 2
    const reach = CLEARING + random() * (limit - CLEARING)
    return { x: Math.cos(angle) * reach, z: Math.sin(angle) * reach }
  })

  /** How steep the ground is here — props do not belong on a cliff face. */
  const slopeAt = (x: number, z: number): number => {
    const h = sampledHeightAt(field, x, z)
    const dx = sampledHeightAt(field, x + 0.8, z) - h
    const dz = sampledHeightAt(field, x, z + 0.8) - h
    return Math.hypot(dx, dz) / 0.8
  }

  const place = (maxSlope: number, scatter: number): { x: number; z: number } | null => {
    for (let attempt = 0; attempt < 60; attempt++) {
      // Most things belong to a cluster; a few strays keep it from looking
      // arranged.
      const loose = random() < 0.2
      let x: number
      let z: number
      if (loose) {
        x = (random() * 2 - 1) * limit
        z = (random() * 2 - 1) * limit
      } else {
        const centre = centres[Math.floor(random() * centres.length)] as { x: number; z: number }
        x = centre.x + (random() * 2 - 1) * scatter
        z = centre.z + (random() * 2 - 1) * scatter
      }

      if (Math.abs(x) > limit || Math.abs(z) > limit) continue
      if (Math.hypot(x, z) < CLEARING) continue
      if (slopeAt(x, z) > maxSlope) continue
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
    fixed: boolean,
    maxSlope: number,
    scatter: number
  ): void => {
    const spot = place(maxSlope, scatter)
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

  // Crates are the things worth carrying, so they stay a graspable block size,
  // and they want level ground — a crate on a slope reads as debris.
  for (let i = 1; i <= crates; i++) {
    const side = 0.3 + random() * 0.12
    add(`crate_${i}`, 'block', [side, side, side], pick(random, CRATE_COLORS), true, 1, false, 0.35, 5)
  }

  // Boulders are the obstacles and the things worth climbing. Mostly modest,
  // with a long tail: a field of identically-sized rocks looks stamped, and the
  // occasional big one gives the eye something to measure the rest against.
  for (let i = 1; i <= boulders; i++) {
    const bulk = random() < 0.18 ? 1.7 + random() * 1.4 : 0.7 + random() * 0.9
    const width = bulk * (0.8 + random() * 0.5)
    const depth = bulk * (0.8 + random() * 0.5)
    const height = bulk * (0.5 + random() * 0.7)
    add(
      `boulder_${i}`,
      'boulder',
      [width, height, depth],
      pick(random, BOULDER_COLORS),
      false,
      60,
      true,
      0.7,
      7
    )
  }

  // Tall, thin and brightly coloured: something to navigate by from a distance,
  // so they are worth putting on high ground where they can actually be seen.
  for (let i = 1; i <= posts; i++) {
    add(`post_${i}`, 'marker', [0.22, 1.8 + random() * 1.2, 0.22], 0xf5c451, false, 5, true, 0.4, 11)
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
