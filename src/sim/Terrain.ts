import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import {
  buildHeightField,
  isFlat,
  sampledHeightAt,
  type HeightField,
  type TerrainSpec
} from '@shared/terrain.js'

/**
 * The ground: one heightfield collider and the mesh that matches it.
 *
 * A flat world is not a special case, just a spec with zero amplitude, so there
 * is a single code path and the scenes written before terrain existed keep
 * behaving exactly as they did.
 */
export class Terrain {
  readonly mesh: THREE.Mesh
  readonly grid: THREE.GridHelper | null
  /** Standing water, where the landform dips below the water level. */
  readonly water: THREE.Mesh | null
  private readonly field: HeightField
  private readonly collider: RAPIER.Collider

  constructor(
    readonly spec: TerrainSpec,
    rapier: typeof RAPIER,
    physics: RAPIER.World
  ) {
    this.field = buildHeightField(spec)
    const size = this.field.size

    const geometry = new THREE.PlaneGeometry(size, size, this.field.nrows, this.field.ncols)
    geometry.rotateX(-Math.PI / 2)

    // Each vertex is displaced by looking up its own world position rather than
    // by index arithmetic. Slower to build, but it cannot silently transpose.
    const position = geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < position.count; i++) {
      position.setY(i, sampledHeightAt(this.field, position.getX(i), position.getZ(i)))
    }
    position.needsUpdate = true
    geometry.computeVertexNormals()
    paintByHeight(geometry, position)

    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
    )
    this.mesh.receiveShadow = true

    // The grid is the only spatial reference in a photograph, but laid over
    // hills it slices through them, so it belongs to flat worlds only.
    this.grid = isFlat(spec)
      ? new THREE.GridHelper(size, Math.round(size), 0x4c7dff, 0x232838)
      : null
    if (this.grid) this.grid.position.y = 0.01

    // A single flat pane at the water line. Nothing physical: the robot has no
    // notion of swimming, and a puddle it can walk through is a better lie than
    // an invisible wall around every basin.
    this.water =
      isFlat(spec) || spec.waterLevel < -100
        ? null
        : new THREE.Mesh(
            new THREE.PlaneGeometry(size, size),
            new THREE.MeshStandardMaterial({
              color: 0x24405e,
              roughness: 0.18,
              metalness: 0.35,
              transparent: true,
              opacity: 0.82
            })
          )
    if (this.water) {
      this.water.rotation.x = -Math.PI / 2
      this.water.position.y = spec.waterLevel
      this.water.receiveShadow = true
    }

    this.collider = physics.createCollider(
      rapier.ColliderDesc.heightfield(this.field.nrows, this.field.ncols, this.field.heights, {
        x: size,
        y: 1,
        z: size
      })
    )
  }

  /**
   * Ground height at a point. Anything that puts an object on the ground must
   * go through this rather than assuming zero.
   */
  heightAt(x: number, z: number): number {
    return sampledHeightAt(this.field, x, z)
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.mesh)
    if (this.grid) scene.add(this.grid)
    if (this.water) scene.add(this.water)
  }

  dispose(scene: THREE.Scene, physics: RAPIER.World): void {
    scene.remove(this.mesh)
    if (this.grid) {
      scene.remove(this.grid)
      this.grid.dispose()
    }
    if (this.water) {
      scene.remove(this.water)
      this.water.geometry.dispose()
      ;(this.water.material as THREE.Material).dispose()
    }
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    physics.removeCollider(this.collider, false)
  }
}

/** Valley floor, open ground, and exposed high ground. */
const LOW = new THREE.Color(0x2c3a2e)
const MID = new THREE.Color(0x3b4a44)
const HIGH = new THREE.Color(0x6b7285)
/** Steep faces read as bare rock rather than as more of the same ground. */
const CLIFF = new THREE.Color(0x6b6357)

/**
 * Shades the ground by height and by steepness.
 *
 * Not decoration: an unshaded landscape is a flat dark field in the robot's own
 * camera, which is the one view that has to carry depth. Lighting alone does
 * not do it — the key light rakes across at a fixed angle, so a slope facing
 * away from it is indistinguishable from a valley. Steepness matters as much as
 * height, because it is what marks the terrace walls the robot has to jump.
 */
function paintByHeight(geometry: THREE.BufferGeometry, position: THREE.BufferAttribute): void {
  let lowest = Infinity
  let highest = -Infinity
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i)
    if (y < lowest) lowest = y
    if (y > highest) highest = y
  }

  const range = highest - lowest
  const normal = geometry.attributes.normal as THREE.BufferAttribute
  const colors = new Float32Array(position.count * 3)
  const shade = new THREE.Color()

  for (let i = 0; i < position.count; i++) {
    // A flat world has no range to map, so it stays the single base tone.
    const t = range < 0.01 ? 0 : (position.getY(i) - lowest) / range
    if (t < 0.5) shade.copy(LOW).lerp(MID, t * 2)
    else shade.copy(MID).lerp(HIGH, (t - 0.5) * 2)

    // An upward normal of 1 is level ground; nearer 0 is a wall.
    const steepness = 1 - Math.min(1, Math.max(0, normal.getY(i)))
    if (steepness > 0.25) {
      shade.lerp(CLIFF, Math.min(1, (steepness - 0.25) * 2.2))
    }

    colors[i * 3] = shade.r
    colors[i * 3 + 1] = shade.g
    colors[i * 3 + 2] = shade.b
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}
