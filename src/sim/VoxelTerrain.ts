import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import { BLOCK, isEmissive, isSolid, type BlockId, type VoxelWorld } from '@shared/voxel.js'

/**
 * Turns a volume of blocks into something you can see and walk on.
 *
 * Only faces between a solid block and open space are emitted, so a 120x120x48
 * volume becomes tens of thousands of quads rather than hundreds of thousands
 * of cubes. Three meshes come out of one pass, because they need different
 * materials: the bulk of the world, the neon that lights itself, and the
 * runoff, which is transparent and has no collider.
 *
 * Rapier has no voxel shape, so the collider is a static trimesh built from the
 * same faces the eye sees. That is the point of doing both in one pass — the
 * thing the robot walks into cannot drift from the thing on screen.
 */

/** Ground level, wet and near-black. Everything else reads against it. */
const PALETTE: Record<BlockId, number> = {
  [BLOCK.air]: 0x000000,
  [BLOCK.concrete]: 0x7d848c,
  [BLOCK.asphalt]: 0x1b1e24,
  [BLOCK.rubble]: 0x4e463a,
  [BLOCK.rust]: 0x8a4f2c,
  [BLOCK.slab]: 0x2b3038,
  [BLOCK.sludge]: 0x123c3a,
  [BLOCK.panel]: 0x5a6472,
  [BLOCK.neonCyan]: 0x2ff0e0,
  [BLOCK.neonPink]: 0xff3d9a
}

/** Face directions, with the neighbour they look at and their winding. */
const FACES: { normal: [number, number, number]; corners: [number, number, number][] }[] = [
  { normal: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] }
]

/**
 * Top faces read flat without this — every one identically lit, so a landscape
 * of steps turns into a single grey field. A small per-column tint restores the
 * grain that vertex normals alone cannot give a world made of cubes.
 */
function grainAt(bx: number, by: number, bz: number): number {
  const n = Math.sin(bx * 12.9898 + by * 4.1414 + bz * 78.233) * 43758.5453
  return 0.9 + (n - Math.floor(n)) * 0.2
}

interface Buffers {
  positions: number[]
  normals: number[]
  colors: number[]
}

function emptyBuffers(): Buffers {
  return { positions: [], normals: [], colors: [] }
}

function toGeometry(b: Buffers): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3))
  geometry.computeBoundingSphere()
  return geometry
}

export class VoxelTerrain {
  readonly meshes: THREE.Mesh[] = []
  private readonly collider: RAPIER.Collider | null

  constructor(
    readonly world: VoxelWorld,
    rapier: typeof RAPIER,
    physics: RAPIER.World
  ) {
    const solid = emptyBuffers()
    const neon = emptyBuffers()
    const fluid = emptyBuffers()
    const shade = new THREE.Color()

    const size = world.spec.blockSize

    for (let by = 0; by < world.sizeY; by++) {
      for (let bz = 0; bz < world.sizeZ; bz++) {
        for (let bx = 0; bx < world.sizeX; bx++) {
          const block = world.get(bx, by, bz)
          if (block === BLOCK.air) continue

          const liquid = block === BLOCK.sludge
          const target = liquid ? fluid : isEmissive(block) ? neon : solid
          const [ox, oy, oz] = world.cornerOf(bx, by, bz)
          const tint = liquid ? 1 : grainAt(bx, by, bz)
          shade.setHex(PALETTE[block] ?? 0xff00ff).multiplyScalar(tint)

          for (const face of FACES) {
            const [nx, ny, nz] = face.normal
            const neighbour = world.get(bx + nx, by + ny, bz + nz)
            // A face is only worth drawing where it meets open space. Runoff
            // shows only against air, or its own surface disappears; solids
            // show against anything that is not solid, so a submerged wall is
            // still there under the transparent water.
            const hidden = liquid ? neighbour !== BLOCK.air : isSolid(neighbour)
            if (hidden) continue

            const [a, b2, c, d] = face.corners as [number, number, number][]
            for (const corner of [a, b2, c, a, c, d]) {
              target.positions.push(
                ox + (corner[0] as number) * size,
                oy + (corner[1] as number) * size,
                oz + (corner[2] as number) * size
              )
              target.normals.push(nx, ny, nz)
              target.colors.push(shade.r, shade.g, shade.b)
            }
          }
        }
      }
    }

    if (solid.positions.length > 0) {
      const mesh = new THREE.Mesh(
        toGeometry(solid),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.12 })
      )
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.meshes.push(mesh)
    }

    if (neon.positions.length > 0) {
      // Lit rather than shaded: in a world this dark the signage is the only
      // thing that reads at distance, and it has to survive the fog.
      this.meshes.push(
        new THREE.Mesh(
          toGeometry(neon),
          new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false })
        )
      )
    }

    if (fluid.positions.length > 0) {
      const mesh = new THREE.Mesh(
        toGeometry(fluid),
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.08,
          metalness: 0.6,
          transparent: true,
          opacity: 0.86
        })
      )
      mesh.receiveShadow = true
      this.meshes.push(mesh)
    }

    this.collider =
      solid.positions.length > 0
        ? physics.createCollider(
            rapier.ColliderDesc.trimesh(
              new Float32Array(solid.positions),
              new Uint32Array(solid.positions.length / 3).map((_, i) => i)
            )
          )
        : null
  }

  /** Exact, because a column scan finds the true top face of a block. */
  heightAt(x: number, z: number): number {
    return this.world.groundHeightAt(x, z)
  }

  addTo(scene: THREE.Scene): void {
    for (const mesh of this.meshes) scene.add(mesh)
  }

  dispose(scene: THREE.Scene, physics: RAPIER.World): void {
    for (const mesh of this.meshes) {
      scene.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    this.meshes.length = 0
    if (this.collider) physics.removeCollider(this.collider, false)
  }
}
