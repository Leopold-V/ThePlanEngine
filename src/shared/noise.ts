/**
 * Deterministic value noise, shared by everything that generates a world.
 *
 * Pure and dependency-free: the same seed gives the same numbers in the main
 * process, the renderer and a test, which is the property scenarios rest on.
 */

/** Integer hash to 0..1. `Math.imul` keeps it exact in 32 bits across engines. */
export function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Three-dimensional variant, for anything carved out of a volume. */
export function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h =
    Math.imul(ix, 0x27d4eb2d) ^
    Math.imul(iy, 0x9e3779b1) ^
    Math.imul(iz, 0x165667b1) ^
    Math.imul(seed, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2d)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function valueNoise(x: number, z: number, seed: number): number {
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

export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = x - ix
  const fy = y - iy
  const fz = z - iz

  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const w = fz * fz * (3 - 2 * fz)

  const lerp = (a: number, b: number, t: number): number => a * (1 - t) + b * t
  const at = (dx: number, dy: number, dz: number): number =>
    hash3(ix + dx, iy + dy, iz + dz, seed)

  const x00 = lerp(at(0, 0, 0), at(1, 0, 0), u)
  const x10 = lerp(at(0, 1, 0), at(1, 1, 0), u)
  const x01 = lerp(at(0, 0, 1), at(1, 0, 1), u)
  const x11 = lerp(at(0, 1, 1), at(1, 1, 1), u)

  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w)
}

/** Four octaves, normalised to 0..1. */
export function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0
  let amplitude = 1
  let frequency = 1
  let total = 0

  for (let octave = 0; octave < octaves; octave++) {
    sum += amplitude * valueNoise(x * frequency, z * frequency, seed + octave * 101)
    total += amplitude
    amplitude *= 0.5
    frequency *= 2
  }

  return sum / total
}

export function fbm3(x: number, y: number, z: number, seed: number, octaves = 3): number {
  let sum = 0
  let amplitude = 1
  let frequency = 1
  let total = 0

  for (let octave = 0; octave < octaves; octave++) {
    sum +=
      amplitude * valueNoise3(x * frequency, y * frequency, z * frequency, seed + octave * 131)
    total += amplitude
    amplitude *= 0.5
    frequency *= 2
  }

  return sum / total
}

/** Peaks where the underlying noise crosses its midpoint. 0..1. */
export function ridged(x: number, z: number, seed: number): number {
  return 1 - Math.abs(fbm(x, z, seed) * 2 - 1)
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Mulberry32: small, fast, and identical across engines. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
