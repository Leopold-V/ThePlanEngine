import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type CameraMode = 'follow' | 'orbit' | 'pov'

/** Where the chase camera sits relative to whatever it is watching. */
const FOLLOW_DISTANCE = 6
const FOLLOW_TARGET_HEIGHT = 1.1
/** How fast the look-at point catches up, per second. Low enough to feel filmed. */
const TARGET_DAMPING = 6
/** Seconds after the operator lets go before the camera drifts back behind. */
const HANDS_OFF_DELAY = 3.5
const RECENTER_RATE = 0.7
const EYE_HEIGHT = 1.5
const DEFAULT_FOV = 52
const DEFAULT_NEAR = 0.1
/**
 * First person sits inside the robot's own skull — its eye meshes are ~13cm
 * from the lens. Hiding the body handles that, but only while a visibility flag
 * is correct, and that flag has been wrong twice. Clipping everything closer
 * than this makes the robot's own geometry unrenderable rather than merely
 * hidden. A carried object rides ~0.64m out, so it stays in shot.
 */
const POV_NEAR = 0.3

/** Anything the camera can be pointed at. A robot satisfies it; so will the next one. */
export interface CameraSubject {
  position: THREE.Vector3
  /** Which way the body faces. The chase camera sits behind this. */
  heading: number
  /** Which way the head faces. First person looks along this. */
  sensorHeading: number
  isMoving: boolean
}

/**
 * The camera as a piece of direction rather than a debug view.
 *
 * `follow` keeps the subject framed and drifts back behind it once the operator
 * stops dragging — orbiting still works and always wins while a drag is live,
 * because a camera that fights you is worse than one that sits still. `orbit`
 * is the old fixed rig. `pov` cuts to the subject's own eyes.
 *
 * It takes a subject per frame rather than owning one, so pointing it at a
 * second robot later is an argument, not a rewrite.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private mode: CameraMode = 'follow'
  private sinceDrag = HANDS_OFF_DELAY
  private dragging = false
  private resetChase = false
  private povFov = DEFAULT_FOV
  private readonly lookTarget = new THREE.Vector3(0, 1, 0)
  // Scratch, so framing allocates nothing per frame.
  private readonly offset = new THREE.Vector3()
  private readonly desired = new THREE.Vector3()

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, DEFAULT_NEAR, 200)
    this.camera.position.set(4.5, 3.4, 6)
    this.camera.rotation.order = 'YXZ'

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.target.set(0, 1, 0)
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05
    this.controls.minDistance = 2.5
    this.controls.maxDistance = 22

    // A live drag suspends auto-framing entirely; nothing is more irritating
    // than a camera pulling against the mouse.
    this.controls.addEventListener('start', () => {
      this.dragging = true
      this.sinceDrag = 0
    })
    this.controls.addEventListener('end', () => {
      this.dragging = false
      this.sinceDrag = 0
    })
  }

  get current(): CameraMode {
    return this.mode
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return
    const leavingPov = this.mode === 'pov'
    this.mode = mode
    this.controls.enabled = mode !== 'pov'
    // Coming out of the head, the orbit rig's stored angles put the camera
    // somewhere arbitrary; re-seat it behind the subject instead.
    if (leavingPov) this.resetChase = true
    this.camera.fov = mode === 'pov' ? this.povFov : DEFAULT_FOV
    this.camera.near = mode === 'pov' ? POV_NEAR : DEFAULT_NEAR
    this.camera.updateProjectionMatrix()
  }

  /**
   * Matches first-person to the robot's actual sensor, so what the operator
   * sees in `pov` is the same cone the model is told about — and the same one
   * `look` photographs.
   */
  setPovFov(degrees: number): void {
    this.povFov = THREE.MathUtils.clamp(degrees, 20, 170)
    if (this.mode === 'pov') {
      this.camera.fov = this.povFov
      this.camera.updateProjectionMatrix()
    }
  }

  update(dt: number, subject: CameraSubject): void {
    if (this.mode === 'pov') {
      const eye = subject.position
      this.camera.position.set(eye.x, eye.y + EYE_HEIGHT, eye.z)
      // Same half-turn as the robot's camera: three.js looks down local -Z,
      // heading 0 faces world +Z.
      this.camera.rotation.set(0, subject.sensorHeading + Math.PI, 0, 'YXZ')
      return
    }

    this.sinceDrag += dt

    if (this.mode === 'follow') {
      if (this.resetChase) this.seatBehind(subject)

      const focus = subject.position
      this.lookTarget.set(focus.x, focus.y + FOLLOW_TARGET_HEIGHT, focus.z)
      // Exponential smoothing, so the framing is frame-rate independent.
      this.controls.target.lerp(this.lookTarget, 1 - Math.exp(-TARGET_DAMPING * dt))

      if (!this.dragging && this.sinceDrag > HANDS_OFF_DELAY && subject.isMoving) {
        this.driftBehind(subject.heading, dt)
      }

    }

    this.controls.update()
  }

  /** Puts the camera straight behind the subject, keeping the operator's zoom. */
  private seatBehind(subject: CameraSubject): void {
    this.resetChase = false
    const distance = THREE.MathUtils.clamp(FOLLOW_DISTANCE, 2.5, 22)
    const p = subject.position
    this.controls.target.set(p.x, p.y + FOLLOW_TARGET_HEIGHT, p.z)
    this.camera.position.set(
      p.x - Math.sin(subject.heading) * distance,
      p.y + FOLLOW_TARGET_HEIGHT + 1.5,
      p.z - Math.cos(subject.heading) * distance
    )
  }

  /**
   * Eases the camera round to the subject's back while it walks.
   *
   * Done by moving the camera rather than by setting an orbit angle: the
   * controls rebuild their spherical from `camera.position - target` on every
   * update, so nudging the position is enough and needs no private access.
   */
  private driftBehind(heading: number, dt: number): void {
    this.offset.copy(this.camera.position).sub(this.controls.target)
    const radius = this.offset.length()
    const horizontal = Math.hypot(this.offset.x, this.offset.z)
    // Directly overhead there is no azimuth to correct.
    if (radius < 1e-3 || horizontal < 1e-3) return

    // Behind means the camera-to-target offset points opposite the heading.
    this.desired.set(
      -Math.sin(heading) * horizontal,
      this.offset.y,
      -Math.cos(heading) * horizontal
    )
    this.offset.lerp(this.desired, 1 - Math.exp(-RECENTER_RATE * dt))
    // Keep the operator's zoom exactly; only the angle is ours to change.
    this.offset.setLength(radius)
    this.camera.position.copy(this.controls.target).add(this.offset)
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    this.controls.dispose()
  }
}
