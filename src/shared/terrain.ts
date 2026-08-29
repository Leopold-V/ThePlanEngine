/**
 * The ground, as a small document rather than a mesh.
 *
 * A procedural world cannot be stored as an enumerated list — a 50m landscape
 * at half-metre resolution is ten thousand numbers, which would swamp a scenario
 * document and make a run record unreadable. So terrain is stored as the spec
 * that produces it and rebuilt on demand. Same spec, same ground, every time:
 * that is what keeps a scenario reproducible and a score attributable.
 *
 * Pure data and pure functions, so the generator, the simulation and the main
 * process can all agree on the ground without any of them importing three.js.
 */

export interface TerrainSpec {
  seed: number
  /** Metres from centre to edge. The ground is `2 * halfExtent` square. */
  halfExtent: number
  /** Height samples per side. Spacing is `2 * halfExtent / samples` metres. */
  samples: number
  /** Highest peak above the base plane. 0 gives a flat world. */
  amplitude: number
  /** Metres per noise cell. Larger means broader, gentler landforms. */
  featureSize: number
  /** Radius around the origin held level, so a spawn is never on a slope. */
  clearingRadius: number
}

/** What every scene written before terrain existed assumes. */
export const FLAT_TERRAIN: TerrainSpec = {
  seed: 0,
  halfExtent: 25,
  samples: 8,
  amplitude: 0,
  featureSize: 1,
  clearingRadius: 0
}

export function isFlat(spec: TerrainSpec): boolean {
  return spec.amplitude === 0
}

/**
 * Heights laid out exactly as Rapier's heightfield collider wants them:
 * column-major, `(nrows + 1) * (ncols + 1)` entries, element `(row, col)` at
 * index `col * (nrows + 1) + row`.
 *
 * **Rows run along z and columns along x**, which is the transpose of the
 * obvious reading. Getting this backwards produces a landscape that looks
 * entirely plausible and is mirrored about the diagonal relative to its own
 * collider, so the robot walks into invisible hills. It is verified against the
 * collider by raycast rather than reasoned about.
 */
export interface HeightField {
  heights: Float32Array
  nrows: number
  ncols: number
  /** Metres across, in both x and z. */
  size: number
}

export function buildHeightField(spec: TerrainSpec): HeightField {
  const nrows = Math.max(1, Math.floor(spec.samples))
  const ncols = nrows
  const size = spec.halfExtent * 2
  const heights = new Float32Array((nrows + 1) * (ncols + 1))

  for (let col = 0; col <= ncols; col++) {
    const x = -spec.halfExtent + (col / ncols) * size
    for (let row = 0; row <= nrows; row++) {
      const z = -spec.halfExtent + (row / nrows) * size
      heights[col * (nrows + 1) + row] = terrainHeightAt(spec, x, z)
    }
  }

  return { heights, nrows, ncols, size }
}

/**
 * Ground height at a point, interpolated across the sampled grid.
 *
 * This — not `terrainHeightAt` — is what anything placing an object on the
 * ground must use: the collider is made of flat facets between samples, so the
 * analytic surface sits well above or below the one things actually rest on.
 *
 * It is still an approximation of the collider, not a match. Rapier splits each
 * cell into two triangles while this interpolates bilinearly, so the two agree
 * exactly at sample points and drift by a few centimetres inside a cell —
 * measured at 3cm on 1m cells with 3m of relief. Anything placed on the ground
 * should therefore be dropped from slightly above it and left to settle, rather
 * than positioned flush and trusted.
 */
export function sampledHeightAt(field: HeightField, x: number, z: number): number {
  const half = field.size / 2
  // Rows along z, columns along x — see the note on HeightField.
  const rowAxis = clamp(((z + half) / field.size) * field.nrows, 0, field.nrows)
  const colAxis = clamp(((x + half) / field.size) * field.ncols, 0, field.ncols)

  const row = Math.min(Math.floor(rowAxis), field.nrows - 1)
  const col = Math.min(Math.floor(colAxis), field.ncols - 1)
  const fz = rowAxis - row
  const fx = colAxis - col

  const at = (r: number, c: number): number =>
    field.heights[c * (field.nrows + 1) + r] as number

  const near = at(row, col) * (1 - fz) + at(row + 1, col) * fz
  const far = at(row, col + 1) * (1 - fz) + at(row + 1, col + 1) * fz
  return near * (1 - fx) + far * fx
}

/** The underlying surface, before it is sampled onto the collider's grid. */
export function terrainHeightAt(spec: TerrainSpec, x: number, z: number): number {
  if (isFlat(spec)) return 0

  const n = fbm(x / spec.featureSize, z / spec.featureSize, spec.seed)
  let height = (n - 0.5) * 2 * spec.amplitude

  // Level ground at the origin, easing out over the same distance again, so the
  // robot never begins a run halfway up a hill or inside one.
  if (spec.clearingRadius > 0) {
    const r = Math.hypot(x, z)
    if (r < spec.clearingRadius) return 0
    if (r < spec.clearingRadius * 2) {
      const t = (r - spec.clearingRadius) / spec.clearingRadius
      height *= t * t * (3 - 2 * t)
    }
  }

  return height
}

/** Four octaves of value noise, normalised to 0..1. */
function fbm(x: number, z: number, seed: number): number {
  let sum = 0
  let amplitude = 1
  let frequency = 1
  let total = 0

  for (let octave = 0; octave < 4; octave++) {
    sum += amplitude * valueNoise(x * frequency, z * frequency, seed + octave * 101)
    total += amplitude
    amplitude *= 0.5
    frequency *= 2
  }

  return sum / total
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz

  // Smoothstep, so the surface has no creases along the lattice lines.
  const u = fx * fx * (3 - 2 * fx)
  const v = fz * fz * (3 - 2 * fz)

  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)

  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/** Integer hash to 0..1. `Math.imul` keeps it exact in 32 bits across engines. */
function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
