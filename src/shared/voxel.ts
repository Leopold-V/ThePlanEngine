import { clamp, fbm, fbm3, ridged, smoothstep } from './noise.js'

/**
 * The world as a volume of blocks rather than a sheet of heights.
 *
 * A heightfield has exactly one ground height per column, which is what made
 * caves, overhangs, arches and buildings-you-go-inside impossible rather than
 * merely hard. A voxel volume can express all of them, and it hands back for
 * free two things the heightfield needed careful tuning to fake: a ledge is
 * just a taller column, and a ramp is a staircase.
 *
 * Pure data and pure functions. The mesh and the collider are built from this
 * in `sim/`; nothing here knows three.js or Rapier exists.
 */

export const BLOCK = {
  air: 0,
  stone: 1,
  dirt: 2,
  grass: 3,
  sand: 4,
  water: 5,
  wood: 6,
  leaf: 7,
  plank: 8
} as const

export type BlockId = (typeof BLOCK)[keyof typeof BLOCK]

/** Water is drawn and waded through, not stood on. Everything else is solid. */
export function isSolid(block: BlockId): boolean {
  return block !== BLOCK.air && block !== BLOCK.water
}

export interface VoxelSpec {
  seed: number
  /** Metres from centre to edge. */
  halfExtent: number
  /**
   * Metres per block.
   *
   * 0.5 is chosen against the robot, not for looks: it is 1.6m tall, steps up
   * 0.55m and jumps 1.1m, so one block is a stride and two blocks is a jump.
   * That makes every climb decision legible at a glance.
   */
  blockSize: number
  /** Blocks of vertical room, top to bottom. */
  height: number
  /** Block layer whose top face sits at world y = 0. */
  groundLevel: number
  /** Peak-to-trough surface variation, in blocks. */
  relief: number
  /** Metres per noise cell for the broad landforms. */
  featureSize: number
  /** Blocks below `groundLevel` that standing water fills to. */
  seaDepth: number
  /** Radius in metres held flat at the origin, so a spawn is never on a slope. */
  clearingRadius: number
  /** Hollow the volume out. A heightfield could never do this. */
  caves: boolean
}

export const DEFAULT_VOXEL: VoxelSpec = {
  seed: 1337,
  halfExtent: 30,
  blockSize: 0.5,
  height: 48,
  groundLevel: 24,
  // Steep enough that ledges of two blocks occur, which is what makes a jump
  // a real decision rather than scenery. Gentler than this and every rise is a
  // single step the robot walks up without thinking.
  relief: 16,
  featureSize: 11,
  seaDepth: 3,
  clearingRadius: 5,
  caves: true
}

/**
 * A filled volume, addressed in block coordinates with the origin at a corner.
 *
 * One flat array rather than chunks: a 60m world at half-metre blocks is
 * 120 x 120 x 48, well under a megabyte. Chunking is what you reach for when a
 * world streams, and this one does not.
 */
export class VoxelWorld {
  readonly sizeX: number
  readonly sizeZ: number
  readonly sizeY: number
  private readonly blocks: Uint8Array

  constructor(readonly spec: VoxelSpec) {
    this.sizeX = Math.max(1, Math.round((spec.halfExtent * 2) / spec.blockSize))
    this.sizeZ = this.sizeX
    this.sizeY = Math.max(1, Math.round(spec.height))
    this.blocks = new Uint8Array(this.sizeX * this.sizeZ * this.sizeY)
  }

  private index(bx: number, by: number, bz: number): number {
    return by * this.sizeX * this.sizeZ + bz * this.sizeX + bx
  }

  inside(bx: number, by: number, bz: number): boolean {
    return bx >= 0 && bx < this.sizeX && by >= 0 && by < this.sizeY && bz >= 0 && bz < this.sizeZ
  }

  get(bx: number, by: number, bz: number): BlockId {
    if (!this.inside(bx, by, bz)) return BLOCK.air
    return this.blocks[this.index(bx, by, bz)] as BlockId
  }

  set(bx: number, by: number, bz: number, block: BlockId): void {
    if (!this.inside(bx, by, bz)) return
    this.blocks[this.index(bx, by, bz)] = block
  }

  // --- world space and block space ------------------------------------------

  /** Block column containing a world x. */
  blockX(x: number): number {
    return Math.floor((x + this.spec.halfExtent) / this.spec.blockSize)
  }

  blockZ(z: number): number {
    return Math.floor((z + this.spec.halfExtent) / this.spec.blockSize)
  }

  /**
   * The world y of a block layer's top face.
   *
   * `groundLevel` is the topmost solid layer in the clearing, so its top face
   * is world zero and a robot standing there has its feet at zero — which is
   * what every scene written before voxels assumes.
   */
  topOf(by: number): number {
    return (by - this.spec.groundLevel) * this.spec.blockSize
  }

  /** World position of a block's low corner in each axis. */
  cornerOf(bx: number, by: number, bz: number): [number, number, number] {
    const s = this.spec.blockSize
    return [
      bx * s - this.spec.halfExtent,
      (by - this.spec.groundLevel - 1) * s,
      bz * s - this.spec.halfExtent
    ]
  }

  /**
   * Height of the surface under a point, exactly rather than approximately.
   *
   * The heightfield could only interpolate, and disagreed with its own collider
   * by a few centimetres, which is why props had to be dropped from above and
   * left to settle. A column scan returns the true top face of the block the
   * robot will stand on.
   */
  groundHeightAt(x: number, z: number): number {
    const bx = clamp(this.blockX(x), 0, this.sizeX - 1)
    const bz = clamp(this.blockZ(z), 0, this.sizeZ - 1)
    for (let by = this.sizeY - 1; by >= 0; by--) {
      if (isSolid(this.get(bx, by, bz))) return this.topOf(by)
    }
    return this.topOf(-1)
  }

  /** The block sitting on the surface, for deciding what a place looks like. */
  surfaceBlockAt(x: number, z: number): BlockId {
    const bx = clamp(this.blockX(x), 0, this.sizeX - 1)
    const bz = clamp(this.blockZ(z), 0, this.sizeZ - 1)
    for (let by = this.sizeY - 1; by >= 0; by--) {
      const block = this.get(bx, by, bz)
      if (isSolid(block)) return block
    }
    return BLOCK.air
  }

  /** True when a solid block occupies this world point. */
  solidAtWorld(x: number, y: number, z: number): boolean {
    const by = Math.floor(y / this.spec.blockSize) + this.spec.groundLevel
    return isSolid(this.get(this.blockX(x), by, this.blockZ(z)))
  }
}

/** Builds a world from its spec. Same spec, same world, every time. */
export function generateVoxelWorld(spec: VoxelSpec): VoxelWorld {
  const world = new VoxelWorld(spec)
  const { blockSize, groundLevel } = spec
  const seaTop = groundLevel - spec.seaDepth

  for (let bx = 0; bx < world.sizeX; bx++) {
    const x = bx * blockSize - spec.halfExtent
    for (let bz = 0; bz < world.sizeZ; bz++) {
      const z = bz * blockSize - spec.halfExtent
      const surface = surfaceLevel(spec, x, z)

      for (let by = 0; by <= surface && by < world.sizeY; by++) {
        // Grass on top, a little dirt under it, stone all the way down. Sand
        // takes over near the waterline, which is what makes a shore read as a
        // shore rather than as grass that happens to stop.
        const depth = surface - by
        const shore = surface <= seaTop + 1
        let block: BlockId = BLOCK.stone
        if (depth === 0) block = shore ? BLOCK.sand : BLOCK.grass
        else if (depth <= 2) block = shore ? BLOCK.sand : BLOCK.dirt

        if (spec.caves && carved(spec, bx, by, bz, surface)) continue
        world.set(bx, by, bz, block)
      }

      // Standing water fills whatever the land left below the line.
      for (let by = surface + 1; by <= seaTop && by < world.sizeY; by++) {
        world.set(bx, by, bz, BLOCK.water)
      }
    }
  }

  return world
}

/** Topmost solid layer for a column, in block indices. */
export function surfaceLevel(spec: VoxelSpec, x: number, z: number): number {
  const scale = spec.featureSize
  const broad = (fbm(x / (scale * 2.4), z / (scale * 2.4), spec.seed) - 0.5) * 2
  const crests = ridged(x / (scale * 0.7), z / (scale * 0.7), spec.seed + 991) - 0.5
  const grain = (fbm(x / (scale * 0.22), z / (scale * 0.22), spec.seed + 77) - 0.5) * 2

  let rise = spec.relief * (broad * 0.78 + crests * 0.5 + grain * 0.07)

  // Level ground at the origin, easing out over the same distance again.
  if (spec.clearingRadius > 0) {
    const r = Math.hypot(x, z)
    if (r < spec.clearingRadius) rise = 0
    else if (r < spec.clearingRadius * 2) {
      rise *= smoothstep(spec.clearingRadius, spec.clearingRadius * 2, r)
    }
  }

  // Quantised last: the world is made of blocks, so a ledge is a whole number
  // of them. Terracing needed a mask and a tuned sample rate on a heightfield;
  // here it is simply what the representation already is.
  return clamp(Math.round(spec.groundLevel + rise), 1, spec.height - 1)
}

/**
 * Hollows the volume out, which is the thing a heightfield structurally cannot
 * do.
 *
 * Kept below the surface and above the floor, so a cave is found by going into
 * a hillside rather than by falling through the ground.
 */
function carved(spec: VoxelSpec, bx: number, by: number, bz: number, surface: number): boolean {
  if (by < 2 || by > surface - 2) return false
  return fbm3(bx / 9, by / 6, bz / 9, spec.seed + 4242) > 0.62
}
