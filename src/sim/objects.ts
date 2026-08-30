import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { ObjectSpec } from '@shared/scene.js'

export type { ObjectKind, ObjectSpec, SceneDefinition } from '@shared/scene.js'
export { DEFAULT_SCENE } from '@shared/scene.js'

/**
 * A lumpy low-poly solid, inscribed in the spec's box.
 *
 * The collider stays the cuboid the spec describes, deliberately: the footprint
 * arithmetic in `criteria.ts`, `jump.ts` and `steering.ts` all assume an
 * axis-aligned box, and a convex hull here would quietly invalidate all three.
 * The rock is drawn *inside* that box, so the robot stops a few centimetres
 * early rather than clipping into something — the safe direction to be wrong.
 */
function rockGeometry(spec: ObjectSpec): THREE.BufferGeometry {
  const [w, h, d] = spec.size
  const geometry = new THREE.IcosahedronGeometry(0.5, 1)
  const position = geometry.attributes.position as THREE.BufferAttribute

  // Deterministic from the id, so the same seed rebuilds the same rocks.
  let hash = 0
  for (let i = 0; i < spec.id.length; i++) hash = (Math.imul(hash, 31) + spec.id.charCodeAt(i)) | 0

  /**
   * Keyed by position, not by vertex index.
   *
   * The geometry is non-indexed — every triangle carries its own copy of each
   * corner — so displacing by index moves the copies apart and the solid bursts
   * into loose shards. Hashing the coordinate makes every copy of a corner move
   * together, which is what keeps it a rock.
   */
  const dentAt = (x: number, y: number, z: number): number => {
    let k = Math.imul(Math.round(x * 512), 73856093)
    k ^= Math.imul(Math.round(y * 512), 19349663)
    k ^= Math.imul(Math.round(z * 512), 83492791)
    k = Math.imul(k ^ hash, 0x45d9f3b)
    const t = Math.sin((k >>> 0) * 0.0001) * 43758.5453
    return 0.78 + (t - Math.floor(t)) * 0.36
  }

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    const dent = dentAt(x, y, z)
    position.setXYZ(i, x * dent, y * dent, z * dent)
  }
  // Rotate before scaling, so a spun rock still fits the box it is drawn in.
  geometry.rotateY(((hash >>> 8) % 360) * (Math.PI / 180))
  // Inscribed rather than circumscribed, so nothing pokes out of the collider.
  geometry.scale(w * 0.96, h * 0.96, d * 0.96)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * A trunk with a canopy above it, drawn deliberately wider than its collider.
 *
 * Unlike a rock, a tree is *not* inscribed in its box. The spec's footprint is
 * the trunk, because that is the part you walk into — the canopy overhangs it
 * and you walk under branches. So the collider stays honest for the footprint
 * arithmetic while the tree still looks like a tree.
 */
function treeGeometry(spec: ObjectSpec): THREE.BufferGeometry {
  const [w, h] = spec.size
  let hash = 0
  for (let i = 0; i < spec.id.length; i++) hash = (Math.imul(hash, 31) + spec.id.charCodeAt(i)) | 0
  const wobble = ((hash >>> 7) % 100) / 100

  const trunkHeight = h * (0.42 + wobble * 0.12)
  const trunk = new THREE.CylinderGeometry(w * 0.3, w * 0.42, trunkHeight, 6)
  trunk.translate(0, trunkHeight / 2 - h / 2, 0)

  // Two stacked tiers read as foliage at this poly count; one reads as a hat.
  const spread = w * (1.9 + wobble * 0.7)
  const lower = new THREE.ConeGeometry(spread * 0.5, h * 0.46, 7)
  lower.translate(0, trunkHeight - h / 2 + h * 0.16, 0)
  const upper = new THREE.ConeGeometry(spread * 0.34, h * 0.38, 7)
  upper.translate(0, trunkHeight - h / 2 + h * 0.42, 0)

  const merged = mergeGeometries([trunk, lower, upper])
  merged.rotateY(wobble * Math.PI * 2)
  merged.computeVertexNormals()
  return merged
}

/** Concatenates position-only geometries. Enough for the shapes built here. */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  for (const part of parts) {
    const nonIndexed = part.index ? part.toNonIndexed() : part
    const array = (nonIndexed.attributes.position as THREE.BufferAttribute).array
    for (let i = 0; i < array.length; i++) positions.push(array[i] as number)
    if (nonIndexed !== part) nonIndexed.dispose()
    part.dispose()
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return merged
}

/**
 * A spawned object: its spec, its three.js mesh, and its Rapier body.
 *
 * Bodies are dynamic so objects fall, stack and get knocked over. Carrying
 * switches a body to kinematic and back — see `Robot.hold`.
 */
export class WorldObject {
  readonly mesh: THREE.Mesh
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider

  private carried = false

  constructor(
    readonly spec: ObjectSpec,
    rapier: typeof RAPIER,
    physics: RAPIER.World
  ) {
    const [w, h, d] = spec.size

    this.mesh = new THREE.Mesh(
      spec.kind === 'boulder'
        ? rockGeometry(spec)
        : spec.kind === 'tree'
          ? treeGeometry(spec)
          : new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({
        color: spec.color,
        roughness: spec.kind === 'boulder' || spec.kind === 'tree' ? 0.95 : 0.6,
        metalness: spec.kind === 'boulder' || spec.kind === 'tree' ? 0 : 0.1,
        flatShading: spec.kind === 'boulder' || spec.kind === 'tree'
      })
    )
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true

    this.body = physics.createRigidBody(
      (spec.fixed
        ? rapier.RigidBodyDesc.fixed()
        : rapier.RigidBodyDesc.dynamic()
            // Objects that settle should stay settled rather than jitter forever.
            .setLinearDamping(0.4)
            .setAngularDamping(0.6)
      ).setTranslation(...spec.position)
    )

    this.collider = physics.createCollider(
      rapier.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
        .setDensity(spec.mass / Math.max(w * h * d, 0.001))
        .setFriction(0.8),
      this.body
    )

    this.syncMesh()
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation()
    return new THREE.Vector3(t.x, t.y, t.z)
  }

  get isCarried(): boolean {
    return this.carried
  }

  /** Height of the object's centre above its base, for placing it on a surface. */
  get halfHeight(): number {
    return this.spec.size[1] / 2
  }

  /**
   * The body's local up axis in world space. Its y component is the cosine of
   * how far the object has tipped, which is how "still upright" is scored.
   */
  get up(): { x: number; y: number; z: number } {
    const r = this.body.rotation()
    const v = new THREE.Vector3(0, 1, 0).applyQuaternion(
      new THREE.Quaternion(r.x, r.y, r.z, r.w)
    )
    return { x: v.x, y: v.y, z: v.z }
  }

  /**
   * Carrying drives the body kinematically. It still pushes dynamic bodies
   * around, but nothing can knock it loose — the accepted trade for keeping
   * joint solving out of the critical path.
   */
  setCarried(rapier: typeof RAPIER, carried: boolean): void {
    this.carried = carried
    this.body.setBodyType(
      carried ? rapier.RigidBodyType.KinematicPositionBased : rapier.RigidBodyType.Dynamic,
      true
    )
    if (!carried) {
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }
  }

  moveTo(x: number, y: number, z: number): void {
    if (this.carried) this.body.setNextKinematicTranslation({ x, y, z })
    else this.body.setTranslation({ x, y, z }, true)
  }

  syncMesh(): void {
    const t = this.body.translation()
    const r = this.body.rotation()
    this.mesh.position.set(t.x, t.y, t.z)
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w)
  }

  /** Removes the body from physics and frees the mesh. Used when loading a scene. */
  dispose(physics: RAPIER.World): void {
    physics.removeRigidBody(this.body)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
