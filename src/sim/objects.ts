import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'

export type ObjectKind = 'block' | 'table' | 'marker'

/**
 * A thing in the world, as data. Scenes are declared rather than constructed so
 * that a v0.3 scenario — a scene plus a goal plus success criteria — can be a
 * document rather than code.
 */
export interface ObjectSpec {
  /** The handle the model uses. Keep it readable: `red_block`, not `obj_7`. */
  id: string
  kind: ObjectKind
  color: number
  /** Full extents in metres. */
  size: [number, number, number]
  /** Centre position at spawn. */
  position: [number, number, number]
  graspable: boolean
  mass: number
}

export interface SceneDefinition {
  id: string
  name: string
  objects: ObjectSpec[]
}

/**
 * Objects are spread well beyond a single field of view, so finding them is a
 * real part of the task rather than a formality.
 */
export const DEFAULT_SCENE: SceneDefinition = {
  id: 'blocks-and-table',
  name: 'Blocks and a table',
  objects: [
    {
      id: 'table',
      kind: 'table',
      color: 0x8b6b4a,
      size: [1.6, 0.75, 1.0],
      position: [5, 0.375, 1],
      graspable: false,
      mass: 40
    },
    {
      id: 'red_block',
      kind: 'block',
      color: 0xe0524d,
      size: [0.3, 0.3, 0.3],
      position: [2, 0.15, 3],
      graspable: true,
      mass: 1
    },
    {
      id: 'blue_block',
      kind: 'block',
      color: 0x4c7dff,
      size: [0.3, 0.3, 0.3],
      position: [-4, 0.15, 2],
      graspable: true,
      mass: 1
    },
    {
      id: 'green_block',
      kind: 'block',
      color: 0x38d39f,
      size: [0.3, 0.3, 0.3],
      position: [-2, 0.15, -5],
      graspable: true,
      mass: 1
    },
    {
      id: 'marker_post',
      kind: 'marker',
      color: 0xf5c451,
      size: [0.2, 1.4, 0.2],
      position: [7, 0.7, -6],
      graspable: false,
      mass: 5
    }
  ]
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
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.6, metalness: 0.1 })
    )
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true

    this.body = physics.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(...spec.position)
        // Objects that settle should stay settled rather than jitter forever.
        .setLinearDamping(0.4)
        .setAngularDamping(0.6)
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
}
