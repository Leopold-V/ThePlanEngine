import type { ObjectSpec, SceneDefinition, WorldGenSpec } from './scene.js'
import {
  buildHeightField,
  sampledHeightAt,
  FLAT_TERRAIN,
  type TerrainSpec
} from './terrain.js'
import { generateVoxelWorld, type VoxelWorld } from './voxel.js'

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
  /** Present when the scene is a volume. The world draws this instead. */
  voxel?: VoxelWorld
}

/** Collapses every kind of scene document into contents the world can load. */
export function resolveScene(scene: SceneDefinition): ResolvedScene {
  if (scene.voxel) {
    const voxel = generateVoxelWorld(scene.voxel)
    return {
      voxel,
      // Props stand on the blocks. Exactly on them, since a column scan gives
      // the true top face rather than an interpolated guess.
      objects: (scene.objects ?? []).map((spec) => ({
        ...spec,
        position: [
          spec.position[0],
          voxel.groundHeightAt(spec.position[0], spec.position[2]) + spec.size[1] / 2,
          spec.position[2]
        ] as [number, number, number]
      })),
      terrain: FLAT_TERRAIN
    }
  }
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
    // Just under the valley floors, so only the deepest basins fill.
    waterLevel: -spec.hilliness * 1.05,
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
/** Warmer and lighter than rock, so built things read as built. */
const STONE_COLORS = [0x9a8f7d, 0x8b8171, 0xa89b86]
/** Deep, desaturated greens — foliage should not out-shout the landmarks. */
const FOLIAGE_COLORS = [0x3f5c46, 0x47654d, 0x374f3f, 0x506b4f]

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
  /** Wall footprints, so nothing later spawns inside one. */
  const built: { x: number; z: number; halfX: number; halfZ: number }[] = []
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
      // Nothing grows or is stacked in standing water.
      if (sampledHeightAt(field, x, z) < terrain.waterLevel + 0.15) continue
      if (taken.some((p) => Math.hypot(p.x - x, p.z - z) < MIN_SEPARATION)) continue
      // A wall covers metres, not a point, so a separation check on its centre
      // is not enough to keep a crate from spawning inside it.
      if (
        built.some(
          (b) =>
            Math.abs(x - b.x) < b.halfX + MIN_SEPARATION &&
            Math.abs(z - b.z) < b.halfZ + MIN_SEPARATION
        )
      ) {
        continue
      }
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

  // Ruins go down first, because they claim ground rather than a point and
  // everything else has to be placed around them.
  //
  // Axis-aligned on purpose, and not only because `ObjectSpec` has no rotation:
  // rectilinear runs read as *built*, which is the whole reason they are here.
  // Tall enough to block sight and refuse a jump, so they have to be routed
  // around rather than dodged — a wall is the first thing in this world that
  // local steering genuinely cannot solve by swerving.
  const runs = Math.max(2, Math.round(total * 0.09))
  let wallIndex = 0
  let pillarIndex = 0

  for (let r = 0; r < runs; r++) {
    const anchor = place(0.22, 10)
    if (!anchor) continue

    const alongX = random() < 0.5
    const segments = 2 + Math.floor(random() * 3)
    let offset = -2

    for (let s = 0; s < segments; s++) {
      const length = 2.4 + random() * 2.6
      const height = 1.7 + random() * 0.9
      const cx = anchor.x + (alongX ? offset + length / 2 : 0)
      const cz = anchor.z + (alongX ? 0 : offset + length / 2)
      if (Math.abs(cx) > limit || Math.abs(cz) > limit) break

      const size: [number, number, number] = alongX
        ? [length, height, 0.55]
        : [0.55, height, length]
      const ground = sampledHeightAt(field, cx, cz)
      // Sunk slightly, so an uneven footing shows as a wall standing in the
      // ground rather than one floating above it.
      objects.push({
        id: `wall_${++wallIndex}`,
        kind: 'wall',
        color: pick(random, STONE_COLORS),
        size,
        position: [cx, ground + height / 2 - 0.15, cz],
        graspable: false,
        mass: 400,
        fixed: true
      })
      built.push({ x: cx, z: cz, halfX: size[0] / 2, halfZ: size[2] / 2 })

      // Gaps often enough that a run is a barrier with a way through, not a
      // sealed box the robot can only give up against.
      offset += length + (random() < 0.45 ? 1.6 + random() * 1.4 : 0.05)
    }

    // A standing pillar or two at the end, for a silhouette worth steering by.
    if (random() < 0.7) {
      const height = 2.4 + random() * 1.4
      const px = anchor.x + (alongX ? offset + 0.6 : 1.2)
      const pz = anchor.z + (alongX ? 1.2 : offset + 0.6)
      if (Math.abs(px) <= limit && Math.abs(pz) <= limit) {
        objects.push({
          id: `pillar_${++pillarIndex}`,
          kind: 'pillar',
          color: pick(random, STONE_COLORS),
          size: [0.7, height, 0.7],
          position: [px, sampledHeightAt(field, px, pz) + height / 2 - 0.15, pz],
          graspable: false,
          mass: 300,
          fixed: true
        })
        built.push({ x: px, z: pz, halfX: 0.35, halfZ: 0.35 })
      }
    }
  }

  // Trees last among the fixed things, and gathered tightly so they read as
  // groves rather than as an orchard. They are the strongest signal that this is
  // a place rather than a heightfield, and the cheapest cover to walk between.
  const trees = Math.round(total * 0.55)
  for (let i = 1; i <= trees; i++) {
    const height = 3.2 + random() * 2.6
    // The footprint is the trunk, not the canopy — you walk under branches.
    const trunk = 0.34 + random() * 0.16
    add(
      `tree_${i}`,
      'tree',
      [trunk, height, trunk],
      pick(random, FOLIAGE_COLORS),
      false,
      200,
      true,
      0.45,
      6
    )
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
