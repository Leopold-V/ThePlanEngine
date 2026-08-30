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
/** Keeps the feet on the floor over bumps and down small steps. */
const SNAP_DISTANCE = 0.3
/**
 * How high a vertical step the robot walks up without being asked.
 *
 * Tied to the block size, not chosen for itself: blocks are 0.5m precisely so
 * that one is a stride and two are a jump, and this is the number that makes
 * the first half of that true. Raise it past a metre and the ledges the world
 * builds stop being decisions.
 */
const STEP_HEIGHT = 0.55
/** How fast a step is climbed. A block in about a third of a second. */
const STEP_CLIMB_RATE = 1.8
/** How far in front of the capsule the ground is felt for a step. */
const STEP_REACH = CAPSULE_RADIUS + 0.2
/** Steeper than this cannot be walked up; steeper than the second, it slides. */
const MAX_CLIMB_ANGLE = Math.PI / 4
const MIN_SLIDE_ANGLE = Math.PI * 0.3

// --- how the motion reads, none of which touches the collider ---------------
/** Reaches walking pace in about a quarter of a second: enough to read as mass. */
const ACCELERATION = 6
const TURN_ACCELERATION = 10
/** Bank into a turn, lean into a change of pace. Radians at full effort. */
const MAX_BANK = 0.13
const MAX_LEAN = 0.09
const CROUCH_DEPTH = 0.16
const CROUCH_RECOVERY = 0.42
/** Impact speed, m/s, that produces a full-depth landing crouch. */
const HARD_LANDING = 6
const HEAD_HEIGHT = 1.55
const MAX_GAZE_YAW = Math.PI * 0.39
const MAX_GAZE_PITCH = Math.PI * 0.19

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
  /** Kept for the step probe, which has to ask the world what is underfoot. */
  private readonly physics: RAPIER.World

  private readonly leftArm: THREE.Group
  private readonly rightArm: THREE.Group
  private readonly leftLeg: THREE.Group
  private readonly rightLeg: THREE.Group
  private readonly head: THREE.Group

  private forwardInput = 0
  private turnInput = 0
  private waving = false
  private verticalVelocity = 0
  private gait = 0
  private waveClock = 0
  /** Horizontal speed carried through a jump; there is nothing to push against. */
  private launchSpeed = 0
  private airborne_ = false
  // Motion the eye reads rather than the physics: the collider stays upright
  // and moves at whatever `speed` says, while these shape how that looks.
  private speed = 0
  private turnRate = 0
  /** -1..1: how hard it is currently trying to change pace. Drives the lean. */
  private effort = 0
  private crouch = 0
  private idleClock = 0
  /** Commanded neck angle relative to the body, and where the neck actually is. */
  private gazeCommand = 0
  private gazeYaw_ = 0

  heading = 0

  constructor(rapier: typeof RAPIER, world: RAPIER.World) {
    this.rapier = rapier
    this.physics = world
    this.mesh = buildHumanoidMesh()
    // Yaw first, then the cosmetic lean and bank, or the two fight each other.
    this.mesh.rotation.order = 'YXZ'
    this.leftArm = this.mesh.getObjectByName('leftArm') as THREE.Group
    this.rightArm = this.mesh.getObjectByName('rightArm') as THREE.Group
    this.leftLeg = this.mesh.getObjectByName('leftLeg') as THREE.Group
    this.rightLeg = this.mesh.getObjectByName('rightLeg') as THREE.Group
    this.head = this.mesh.getObjectByName('head') as THREE.Group

    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(0, CENTER_HEIGHT, 0)
    )
    this.collider_ = world.createCollider(
      rapier.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
      this.body
    )

    this.controller = world.createCharacterController(0.01)
    // Left enabled for small bumps, but it is not what climbs a block: Rapier's
    // autostep will not lift this capsule 0.5m at any combination of height,
    // min width, controller offset, snap distance or timestep that was tried.
    // `stepAhead` does that; see `update`.
    this.controller.enableAutostep(0.3, 0.2, true)
    this.controller.enableSnapToGround(SNAP_DISTANCE)
    this.controller.setApplyImpulsesToDynamicBodies(true)
    // Left at the defaults, hills are either unclimbable or frictionless. A
    // slope the robot can walk up has to be a decision, not an accident.
    this.controller.setMaxSlopeClimbAngle(MAX_CLIMB_ANGLE)
    this.controller.setMinSlopeSlideAngle(MIN_SLIDE_ANGLE)
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

  /** Peak a jump may aim for. Above this it stops being a humanoid. */
  static readonly MAX_JUMP_HEIGHT = 1.1

  /**
   * Horizontal speed a jump may launch at. Faster than a brisk run-up is not a
   * jump the body could have set up for.
   */
  static readonly MAX_LAUNCH_SPEED = 3

  /** Seconds a jump to `height` keeps the feet off the floor, landing level. */
  static airtime(height: number): number {
    return (2 * Math.sqrt(2 * -GRAVITY * height)) / -GRAVITY
  }

  /** The lowest jump that stays up long enough to carry `distance` forward. */
  static minimumHeightFor(distance: number): number {
    const seconds = distance / Robot.MAX_LAUNCH_SPEED
    return (-GRAVITY * seconds * seconds) / 8
  }

  /** True between leaving the floor and landing on something. */
  get airborne(): boolean {
    return this.airborne_
  }

  /**
   * Leaves the ground: `height` metres at the peak, carrying `distance` metres
   * forward along the current heading.
   *
   * Height and distance are not independent — the jump is ballistic, so the
   * height fixes how long there is to travel. Returns false if already in the
   * air, which is the only way to fail.
   */
  jump(height: number, distance: number): boolean {
    if (this.airborne_) return false

    const peak = THREE.MathUtils.clamp(height, 0.05, Robot.MAX_JUMP_HEIGHT)
    this.verticalVelocity = Math.sqrt(2 * -GRAVITY * peak)
    this.launchSpeed = THREE.MathUtils.clamp(
      distance / Robot.airtime(peak),
      0,
      Robot.MAX_LAUNCH_SPEED
    )
    this.airborne_ = true
    // Snap-to-ground exists to hold the feet down over bumps. Left on, it pulls
    // the robot straight back out of the jump on the frame it starts.
    this.controller.disableSnapToGround()
    return true
  }

  private land(): void {
    this.airborne_ = false
    this.launchSpeed = 0
    this.controller.enableSnapToGround(SNAP_DISTANCE)
  }

  /** Just above the head, in world space — where a speech bubble hangs. */
  get headPosition(): THREE.Vector3 {
    const p = this.position
    return new THREE.Vector3(p.x, p.y + HEAD_HEIGHT + 0.28, p.z)
  }

  /** The furthest the neck turns either way. */
  static readonly MAX_GAZE = MAX_GAZE_YAW

  /**
   * Points the head, relative to the body. This is a sensor command, not an
   * animation: the eyes, the camera and the field of view all follow the neck,
   * so turning the head really is looking somewhere else.
   */
  setGazeYaw(radians: number): void {
    this.gazeCommand = THREE.MathUtils.clamp(radians, -MAX_GAZE_YAW, MAX_GAZE_YAW)
  }

  /** Where the neck actually is, which lags the command. */
  get gazeYaw(): number {
    return this.gazeYaw_
  }

  /**
   * The direction the robot is sensing in: body plus neck.
   *
   * Everything that perceives uses this rather than `heading`. A humanoid turns
   * its head to look around and does not swivel its whole body to glance, and
   * for a while here the head turned while the sensors stayed bolted to the
   * chest — so the robot visibly looked at things it could not see.
   */
  get sensorHeading(): number {
    return this.heading + this.gazeYaw_
  }

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

  /**
   * Places the robot at a starting pose. Used when a scenario resets the world.
   * `groundY` is the terrain height at the spot — without it the robot spawns
   * buried in a hill or several metres above a valley.
   */
  teleport(x: number, z: number, heading: number, groundY = 0): void {
    this.stop()
    this.land()
    this.heading = heading
    this.verticalVelocity = 0
    this.gait = 0
    this.speed = 0
    this.turnRate = 0
    this.effort = 0
    this.crouch = 0
    this.gazeCommand = 0
    this.gazeYaw_ = 0
    this.head.rotation.set(0, 0, 0)
    // Clear any lean left over from the previous run's last movement.
    this.mesh.rotation.set(0, heading, 0)
    this.body.setTranslation({ x, y: groundY + CENTER_HEIGHT, z }, true)
    this.body.setNextKinematicTranslation({ x, y: groundY + CENTER_HEIGHT, z })
    this.syncMesh(0, 0)
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

  /**
   * How far the ground rises just in front of the feet, when that rise is a
   * step rather than a wall. Zero when there is nothing to climb.
   *
   * This exists because Rapier's autostep does not lift this capsule over a
   * 0.5m block — not at any height, min width, controller offset, snap distance
   * or timestep that was measured. Since blocks are 0.5m and the whole point of
   * that size is that one is a stride, the robot walked into the smallest
   * feature the terrain can make and stopped dead against it.
   *
   * Only static geometry counts. You step onto ground and ledges; clambering up
   * a crate you were walking over to pick up is not a step, it is a bug.
   */
  private stepAhead(): number {
    const t = this.body.translation()
    const feet = t.y - CENTER_HEIGHT
    const x = t.x + Math.sin(this.heading) * STEP_REACH
    const z = t.z + Math.cos(this.heading) * STEP_REACH
    const onlyStatic = (c: RAPIER.Collider): boolean => {
      const parent = c.parent()
      return parent === null || parent.isFixed()
    }

    // Downward from just above the tallest step allowed, so the first thing hit
    // is the surface the foot would land on.
    const top = feet + STEP_HEIGHT + 0.1
    const down = this.physics.castRay(
      new this.rapier.Ray({ x, y: top, z }, { x: 0, y: -1, z: 0 }),
      STEP_HEIGHT + 0.2,
      true,
      undefined,
      undefined,
      this.collider_,
      undefined,
      onlyStatic
    )
    if (!down) return 0

    const rise = top - down.timeOfImpact - feet
    // Below the first bound the controller copes on its own; above the second
    // it is a wall, and walls are what jumping is for.
    if (rise <= 0.06 || rise > STEP_HEIGHT) return 0

    // Nothing to hit its head on up there. The world has caves in it, and
    // stepping up into a ceiling would wedge the robot inside the rock.
    const headroom = this.physics.castRay(
      new this.rapier.Ray({ x, y: feet + rise + 0.05, z }, { x: 0, y: 1, z: 0 }),
      CENTER_HEIGHT * 2,
      true,
      undefined,
      undefined,
      this.collider_,
      undefined,
      onlyStatic
    )
    return headroom ? 0 : rise
  }

  update(dt: number): void {
    this.turnRate = ease(this.turnRate, this.turnInput * TURN_SPEED, TURN_ACCELERATION * dt)
    this.heading += this.turnRate * dt

    // Airborne there is nothing to push against, so the launch velocity is kept
    // and the walk input ignored until the feet are back on something. On the
    // ground, mass takes a moment to get going and a moment to stop.
    const wanted = this.forwardInput * WALK_SPEED
    this.effort = THREE.MathUtils.clamp((wanted - this.speed) / WALK_SPEED, -1, 1)
    this.speed = this.airborne_
      ? this.launchSpeed
      : ease(this.speed, wanted, ACCELERATION * dt)
    const speed = this.speed
    this.verticalVelocity += GRAVITY * dt

    // Climbing a step is a deliberate lift, not a fall interrupted — gravity is
    // held off while the foot is going up, or the two fight and the robot
    // shuffles at the ledge instead of mounting it.
    const climb = this.airborne_ || speed <= 0 ? 0 : this.stepAhead()
    if (climb > 0) this.verticalVelocity = 0

    const desired = {
      x: Math.sin(this.heading) * speed * dt,
      y: climb > 0 ? Math.min(climb, STEP_CLIMB_RATE * dt) : this.verticalVelocity * dt,
      z: Math.cos(this.heading) * speed * dt
    }

    // The carried object rides in front of the chest, well inside the range of
    // the character controller's shape cast. Left in, the controller treats it
    // as an obstacle and — since a block is exactly the autostep height — steps
    // onto the very thing the robot is holding, climbing itself upward a step
    // at a time until it ends up on top of the furniture.
    const held = this.heldObject?.collider.handle
    this.controller.computeColliderMovement(
      this.collider_,
      desired,
      undefined,
      undefined,
      held === undefined ? undefined : (c) => c.handle !== held
    )
    const moved = this.controller.computedMovement()

    // Only while descending. On the frame a jump starts the feet are still on
    // the floor, and zeroing there would cancel it before it left the ground.
    if (this.controller.computedGrounded() && this.verticalVelocity <= 0) {
      const impact = -this.verticalVelocity
      this.verticalVelocity = 0
      if (this.airborne_) {
        this.land()
        // Absorb the landing in proportion to how hard it was.
        this.crouch = Math.min(1, impact / HARD_LANDING)
      }
    }

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

    // The legs ease to rest in mid-air rather than walking through the arc.
    this.syncMesh(dt, this.airborne_ ? 0 : Math.abs(speed))
  }

  private syncMesh(dt: number, speed: number): void {
    const t = this.body.translation()
    const settle = Math.min(1, dt * 6)

    this.crouch = Math.max(0, this.crouch - dt / CROUCH_RECOVERY)
    this.idleClock += dt
    // Breathing, but only while genuinely still, so it never fights the gait.
    const idle = speed < 0.02 && !this.airborne_ ? Math.sin(this.idleClock * 1.6) * 0.012 : 0

    this.mesh.position.set(t.x, t.y - CENTER_HEIGHT - this.crouch * CROUCH_DEPTH + idle, t.z)
    this.mesh.rotation.y = this.heading

    // Bank into the turn, lean into the change of pace. Cosmetic only — the
    // capsule the physics sees never tilts, so nothing here can trip the robot.
    const bank = -THREE.MathUtils.clamp(this.turnRate / TURN_SPEED, -1, 1) * MAX_BANK
    this.mesh.rotation.z += (bank - this.mesh.rotation.z) * settle
    this.mesh.rotation.x += (this.effort * MAX_LEAN - this.mesh.rotation.x) * settle

    this.updateGaze(settle)

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

    // Knees up through the arc, and absorbed on impact. Both override the gait,
    // which is why they come last.
    const quick = Math.min(1, dt * 8)
    if (this.airborne_) {
      this.leftLeg.rotation.x += (0.4 - this.leftLeg.rotation.x) * quick
      this.rightLeg.rotation.x += (0.22 - this.rightLeg.rotation.x) * quick
    } else if (this.crouch > 0.01) {
      const bend = this.crouch * 0.5
      this.leftLeg.rotation.x += (bend - this.leftLeg.rotation.x) * quick
      this.rightLeg.rotation.x += (bend - this.rightLeg.rotation.x) * quick
    }
  }

  /**
   * Eases the neck toward where it has been told to point.
   *
   * The neck has no pitch on purpose. Perception has no vertical limit — it is
   * a horizontal cone — so a head that tilted would aim a camera at things the
   * field of view does not cull, which is the same mismatch between what the
   * robot appears to look at and what it actually senses that mounting the
   * sensors here was meant to remove.
   */
  private updateGaze(settle: number): void {
    this.gazeYaw_ += (this.gazeCommand - this.gazeYaw_) * settle
    this.head.rotation.y = this.gazeYaw_
  }
}

/** Moves `value` toward `target` by at most `step`. */
function ease(value: number, target: number, step: number): number {
  const delta = target - value
  if (Math.abs(delta) <= step) return target
  return value + Math.sign(delta) * step
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

  // The head is a pivot so it can turn independently of the body. Its contents
  // sit in head-local space, hung off a neck at 1.45.
  const head = new THREE.Group()
  head.name = 'head'
  head.rotation.order = 'YXZ'
  head.position.set(0, 1.45, 0)
  head.add(add(new THREE.SphereGeometry(0.14, 24, 16), shell, 0.1))

  // Eyes have to clear the skull to be visible at all — inside its radius they
  // render nothing, and without a face there is no reading where it is looking.
  for (const side of [0.06, -0.06]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.045, 0.06), dark)
    eye.position.set(side, 0.11, 0.115)
    eye.castShadow = true
    head.add(eye)
  }
  root.add(head)

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
