import * as THREE from 'three'
import type { PerceptionConfig } from './perception.js'

const SEGMENTS = 48
const HIGHLIGHT = 0x2a3550

/**
 * Draws what the robot can see, so a perception miss is obvious rather than
 * inferred from numbers: a ground wedge for the field of view, and a tint on
 * objects currently in sight.
 *
 * This is a view concern only — nothing here feeds the observation, so what the
 * model receives is unaffected by whether the overlay is on.
 */
export class DebugVisuals {
  readonly group = new THREE.Group()

  private readonly wedge: THREE.Mesh
  private readonly material: THREE.MeshBasicMaterial

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      color: 0x4c7dff,
      transparent: true,
      opacity: 0.09,
      side: THREE.DoubleSide,
      depthWrite: false
    })

    this.wedge = new THREE.Mesh(new THREE.BufferGeometry(), this.material)
    // Just above the grid, so it reads as a floor overlay rather than z-fighting.
    this.wedge.position.y = 0.02
    this.wedge.renderOrder = 1
    this.group.add(this.wedge)
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible
  }

  /**
   * Rebuilds the wedge for the current sensor. A triangle fan symmetric about
   * +Z, so the mesh can simply be rotated by the robot's heading.
   */
  setPerception(config: PerceptionConfig): void {
    const half = THREE.MathUtils.degToRad(Math.min(config.halfAngleDeg, 180))
    const positions: number[] = [0, 0, 0]

    for (let i = 0; i <= SEGMENTS; i++) {
      const a = -half + (2 * half * i) / SEGMENTS
      positions.push(Math.sin(a) * config.range, 0, Math.cos(a) * config.range)
    }

    const indices: number[] = []
    for (let i = 1; i <= SEGMENTS; i++) indices.push(0, i, i + 1)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)

    this.wedge.geometry.dispose()
    this.wedge.geometry = geometry
  }

  /** Follows the robot each frame. */
  update(position: THREE.Vector3, heading: number): void {
    this.group.position.set(position.x, 0, position.z)
    this.group.rotation.y = heading
  }

  /** Tints an object's material while it is in view. */
  static setHighlighted(material: THREE.MeshStandardMaterial, on: boolean): void {
    material.emissive.setHex(on ? HIGHLIGHT : 0x000000)
  }

  dispose(): void {
    this.wedge.geometry.dispose()
    this.material.dispose()
  }
}
