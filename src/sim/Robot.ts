import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { WorldObject } from './objects.js'

const CAPSULE_HALF_HEIGHT = 0.55
const CAPSULE_RADIUS = 0.25
/** Distance from body centre to the soles, used to place the mesh. */
const CENTER_HEIGHT = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS
const GRAVITY = -9.81
const WALK_SPEED = 1.4
const TURN_SPEED = Math.PI // rad/s

/**
 * A kinematic humanoid. Rapier owns the world and resolves collisions through a
 * character controller, but the robot never ragdolls — balance is not simulated,
 * so a model can never fail a task simply because bipedal walking is hard.
 *
 * Skills drive this through the intent setters (`setForward`, `setTurn`, ...);
 * `update` is the only place those intents become motion.
 */
export class Robot {
  readonly mesh: THREE.Group

  private readonly body: RAPIER.RigidBody
  private readonly collider_: RAPIER.Collider
  private readonly controller: RAPIER.KinematicCharacterController
  private heldObject: WorldObject | null = null
  private readonly rapier: typeof RAPIER

  private readonly leftArm: THREE.Group
  private readonly rightArm: THREE.Group
  private readonly leftLeg: THREE.Group
  private readonly rightLeg: THREE.Group

  private forwardInput = 0
  private turnInput = 0
  private waving = false
  private verticalVelocity = 0
  private gait = 0
  private waveClock = 0

  heading = 0

  constructor(rapier: typeof RAPIER, world: RAPIER.World) {
    this.rapier = rapier
    this.mesh = buildHumanoidMesh()
    this.leftArm = this.mesh.getObjectByName('leftArm') as THREE.Group
    this.rightArm = this.mesh.getObjectByName('rightArm') as THREE.Group
    this.leftLeg = this.mesh.getObjectByName('leftLeg') as THREE.Group
    this.rightLeg = this.mesh.getObjectByName('rightLeg') as THREE.Group

    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(0, CENTER_HEIGHT, 0)
    )
    this.collider_ = world.createCollider(
      rapier.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
      this.body
    )

    this.controller = world.createCharacterController(0.01)
    this.controller.enableAutostep(0.3, 0.2, true)
    this.controller.enableSnapToGround(0.3)
    this.controller.setApplyImpulsesToDynamicBodies(true)
  }

  /** Exposed so perception can exclude the robot from its own line-of-sight rays. */
  get collider(): RAPIER.Collider {
    return this.collider_
  }

  /** The object currently carried, if any. */
  get held(): WorldObject | null {
    return this.heldObject
  }

  /**
   * Reach for picking up and putting down, in metres. Comfortably larger than
   * `walk_to`'s arrival tolerance: the model aims for a spot near an object and
   * lands up to a quarter-metre off, so a tight reach would fail constantly for
   * reasons that say nothing about its planning.
   */
  static readonly REACH = 1.5

  /** Where a carried object rides: in front of the chest, at carry height. */
  carryAnchor(): THREE.Vector3 {
    const p = this.position
    return new THREE.Vector3(
      p.x + Math.sin(this.heading) * 0.45,
      p.y + 1.05,
      p.z + Math.cos(this.heading) * 0.45
    )
  }

  hold(object: WorldObject | null): void {
    this.heldObject = object
  }

  // --- state read by skills and by observe() ---------------------------------

  get position(): THREE.Vector3 {
    const t = this.body.translation()
    return new THREE.Vector3(t.x, t.y - CENTER_HEIGHT, t.z)
  }

  /** Compass-style heading in degrees, 0 = +Z, increasing counter-clockwise. */
  get headingDegrees(): number {
    return ((THREE.MathUtils.radToDeg(this.heading) % 360) + 360) % 360
  }

  get isMoving(): boolean {
    return this.forwardInput !== 0 || this.turnInput !== 0
  }

  // --- intents ---------------------------------------------------------------

  /** -1..1, scaled by walk speed. */
  setForward(value: number): void {
    this.forwardInput = THREE.MathUtils.clamp(value, -1, 1)
  }

  /** -1..1, scaled by turn speed. */
  setTurn(value: number): void {
    this.turnInput = THREE.MathUtils.clamp(value, -1, 1)
  }

  setWaving(value: boolean): void {
    this.waving = value
    if (!value) this.waveClock = 0
  }

  stop(): void {
    this.forwardInput = 0
    this.turnInput = 0
  }

  /** Shortest signed angle (radians) from current heading to a world point. */
  angleTo(x: number, z: number): number {
    const p = this.position
    const desired = Math.atan2(x - p.x, z - p.z)
    let delta = desired - this.heading
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    return delta
  }

  distanceTo(x: number, z: number): number {
    const p = this.position
    return Math.hypot(x - p.x, z - p.z)
  }

  // --- per-frame -------------------------------------------------------------

  update(dt: number): void {
    this.heading += this.turnInput * TURN_SPEED * dt

    const speed = this.forwardInput * WALK_SPEED
    this.verticalVelocity += GRAVITY * dt

    const desired = {
      x: Math.sin(this.heading) * speed * dt,
      y: this.verticalVelocity * dt,
      z: Math.cos(this.heading) * speed * dt
    }

    this.controller.computeColliderMovement(this.collider_, desired)
    const moved = this.controller.computedMovement()

    if (this.controller.computedGrounded()) this.verticalVelocity = 0

    const t = this.body.translation()
    this.body.setNextKinematicTranslation({
      x: t.x + moved.x,
      y: t.y + moved.y,
      z: t.z + moved.z
    })

    // A carried object rides the anchor; its body is kinematic while held, so
    // it still pushes the world around but cannot be knocked loose.
    if (this.heldObject) {
      const anchor = this.carryAnchor()
      this.heldObject.moveTo(anchor.x, anchor.y, anchor.z)
    }

    this.syncMesh(dt, Math.abs(speed))
  }

  private syncMesh(dt: number, speed: number): void {
    const t = this.body.translation()
    this.mesh.position.set(t.x, t.y - CENTER_HEIGHT, t.z)
    this.mesh.rotation.y = this.heading

    // Procedural gait: legs counter-swing with arms while moving, ease to rest otherwise.
    if (speed > 0.01) {
      this.gait += dt * speed * 6
      const swing = Math.sin(this.gait) * 0.45
      this.leftLeg.rotation.x = swing
      this.rightLeg.rotation.x = -swing
      if (!this.waving) {
        this.leftArm.rotation.x = -swing * 0.7
        this.rightArm.rotation.x = swing * 0.7
      }
    } else {
      this.gait = 0
      this.leftLeg.rotation.x *= 0.85
      this.rightLeg.rotation.x *= 0.85
      this.leftArm.rotation.x *= 0.85
      if (!this.waving) this.rightArm.rotation.x *= 0.85
    }

    if (this.waving) {
      this.waveClock += dt
      this.rightArm.rotation.z = -2.2
      this.rightArm.rotation.x = Math.sin(this.waveClock * 9) * 0.4
    } else {
      this.rightArm.rotation.z *= 0.85
    }
  }
}

function buildHumanoidMesh(): THREE.Group {
  const root = new THREE.Group()
  const shell = new THREE.MeshStandardMaterial({ color: 0xd8dee9, metalness: 0.6, roughness: 0.35 })
  const accent = new THREE.MeshStandardMaterial({ color: 0x4c7dff, metalness: 0.5, roughness: 0.4 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b303b, metalness: 0.7, roughness: 0.3 })

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, x = 0): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(x, y, 0)
    mesh.castShadow = true
    return mesh
  }

  root.add(add(new THREE.SphereGeometry(0.14, 24, 16), shell, 1.55))
  root.add(add(new THREE.BoxGeometry(0.1, 0.05, 0.12), dark, 1.56, 0.06))
  root.add(add(new THREE.BoxGeometry(0.1, 0.05, 0.12), dark, 1.56, -0.06))
  root.add(add(new THREE.CylinderGeometry(0.05, 0.05, 0.1), dark, 1.4))
  root.add(add(new THREE.BoxGeometry(0.36, 0.46, 0.22), accent, 1.1))
  root.add(add(new THREE.BoxGeometry(0.3, 0.14, 0.2), dark, 0.8))

  // Limbs hang from pivot groups so rotation happens at the joint, not the centre.
  const limb = (name: string, x: number, y: number, length: number): THREE.Group => {
    const pivot = new THREE.Group()
    pivot.name = name
    pivot.position.set(x, y, 0)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.11, length, 0.11), shell)
    mesh.position.y = -length / 2
    mesh.castShadow = true
    pivot.add(mesh)
    return pivot
  }

  root.add(limb('leftArm', 0.25, 1.3, 0.5))
  root.add(limb('rightArm', -0.25, 1.3, 0.5))
  root.add(limb('leftLeg', 0.1, 0.78, 0.72))
  root.add(limb('rightLeg', -0.1, 0.78, 0.72))

  return root
}
