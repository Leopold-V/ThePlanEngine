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

/**
 * Face directions, flattened.
 *
 * Six faces, each six vertices, each three components — written out as plain
 * numbers rather than nested arrays because this is read once per visible face
 * and building a tuple there allocates millions of short-lived arrays.
 */
const FACE_NORMALS = [
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1]
] as const

/** Two triangles per face, as 18 offsets in the block's unit cube. */
const FACE_CORNERS: readonly (readonly number[])[] = [
  [0, 1, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0],
  [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1],
  [1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1],
  [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0],
  [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1],
  [0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0]
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

/**
 * Grows by writing into typed arrays rather than pushing onto plain ones.
 *
 * The first cut pushed every component onto a JS array — roughly seven million
 * pushes for a full world, which took over five seconds. Counting faces first
 * and filling exact buffers afterwards is the whole of the difference.
 */
class Buffers {
  positions: Float32Array
  normals: Float32Array
  colors: Float32Array
  count = 0

  constructor(faces: number) {
    const values = faces * 6 * 3
    this.positions = new Float32Array(values)
    this.normals = new Float32Array(values)
    this.colors = new Float32Array(values)
  }

  push(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, g: number, b: number): void {
    const i = this.count * 3
    this.positions[i] = x
    this.positions[i + 1] = y
    this.positions[i + 2] = z
    this.normals[i] = nx
    this.normals[i + 1] = ny
    this.normals[i + 2] = nz
    this.colors[i] = r
    this.colors[i + 1] = g
    this.colors[i + 2] = b
    this.count++
  }

  toGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    geometry.computeBoundingSphere()
    return geometry
  }
}

export class VoxelTerrain {
  readonly meshes: THREE.Mesh[] = []
  private readonly collider: RAPIER.Collider | null

  constructor(
    readonly world: VoxelWorld,
    rapier: typeof RAPIER,
    physics: RAPIER.World
  ) {
    // Two passes. The first only counts, so the second can write into buffers
    // that are already exactly the right size.
    let solidFaces = 0
    let neonFaces = 0
    let fluidFaces = 0
    this.eachVisibleFace((block) => {
      if (block === BLOCK.sludge) fluidFaces++
      else if (isEmissive(block)) neonFaces++
      else solidFaces++
    })

    const solid = new Buffers(solidFaces)
    const neon = new Buffers(neonFaces)
    const fluid = new Buffers(fluidFaces)
    const shade = new THREE.Color()
    const size = world.spec.blockSize

    this.eachVisibleFace((block, bx, by, bz, faceIndex) => {
      const liquid = block === BLOCK.sludge
      const into = liquid ? fluid : isEmissive(block) ? neon : solid
      const tint = liquid ? 1 : grainAt(bx, by, bz)
      shade.setHex(PALETTE[block] ?? 0xff00ff).multiplyScalar(tint)

      const ox = bx * size - world.spec.halfExtent
      const oy = (by - world.spec.groundLevel - 1) * size
      const oz = bz * size - world.spec.halfExtent
      const normal = FACE_NORMALS[faceIndex] as readonly number[]
      const corners = FACE_CORNERS[faceIndex] as readonly number[]

      for (let v = 0; v < 18; v += 3) {
        into.push(
          ox + (corners[v] as number) * size,
          oy + (corners[v + 1] as number) * size,
          oz + (corners[v + 2] as number) * size,
          normal[0] as number,
          normal[1] as number,
          normal[2] as number,
          shade.r,
          shade.g,
          shade.b
        )
      }
    })

    if (solid.count > 0) {
      const mesh = new THREE.Mesh(
        solid.toGeometry(),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.12 })
      )
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.meshes.push(mesh)
    }

    if (neon.count > 0) {
      // Lit rather than shaded: in a world this dark the signage is the only
      // thing that reads at distance, and it has to survive the fog.
      this.meshes.push(
        new THREE.Mesh(
          neon.toGeometry(),
          new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false })
        )
      )
    }

    if (fluid.count > 0) {
      const mesh = new THREE.Mesh(
        fluid.toGeometry(),
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
      solid.count > 0
        ? physics.createCollider(
            rapier.ColliderDesc.trimesh(
              solid.positions,
              new Uint32Array(solid.count).map((_, i) => i)
            )
          )
        : null
  }

  /**
   * Visits every face where a block meets open space.
   *
   * Shared by the counting pass and the filling pass so the two cannot
   * disagree about which faces exist — the classic way a two-pass mesher goes
   * wrong is for one pass to see a face the other does not.
   */
  private eachVisibleFace(
    visit: (block: BlockId, bx: number, by: number, bz: number, faceIndex: number) => void
  ): void {
    const { world } = this
    for (let by = 0; by < world.sizeY; by++) {
      for (let bz = 0; bz < world.sizeZ; bz++) {
        for (let bx = 0; bx < world.sizeX; bx++) {
          const block = world.get(bx, by, bz)
          if (block === BLOCK.air) continue
          const liquid = block === BLOCK.sludge

          for (let f = 0; f < 6; f++) {
            const normal = FACE_NORMALS[f] as readonly number[]
            const neighbour = world.get(
              bx + (normal[0] as number),
              by + (normal[1] as number),
              bz + (normal[2] as number)
            )
            // Runoff shows only against air, or its own surface disappears.
            // Solids show against anything not solid, so a submerged wall is
            // still there beneath the transparent water.
            if (liquid ? neighbour !== BLOCK.air : isSolid(neighbour)) continue
            visit(block, bx, by, bz, f)
          }
        }
      }
    }
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
