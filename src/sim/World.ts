import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { Robot } from './Robot.js'
import { WorldModel } from './WorldModel.js'
import { CameraRig, type CameraMode } from './CameraRig.js'
import { CameraView } from './CameraView.js'
import { Hud, type BubbleTone } from './Hud.js'
import { VoxelTerrain } from './VoxelTerrain.js'
import { Sky } from './Sky.js'
import { resolveScene } from '@shared/worldgen.js'
import { DebugVisuals } from './debugVisuals.js'
import { describe } from './observe.js'
import { DEFAULT_SCENE, WorldObject, type SceneDefinition } from './objects.js'
import { DEFAULT_PERCEPTION, perceive, type PerceptionConfig, type Sighting } from './perception.js'
import { senseGround, type GroundReading } from './terrainSense.js'
import type { WorldView } from './WorldView.js'
import type { WorldSnapshot } from '@shared/scenario.js'
import type { ObservationDetail } from '@shared/profile.js'
import type { CameraFrame } from './CameraView.js'

const GROUND_HALF_EXTENT = 25
/** Half-width of the shadow box carried along with the robot. */
const SHADOW_FRUSTUM = 16
const FIXED_STEP = 1 / 60
/** Never simulate more than this per frame, so a stalled tab can't spiral. */
const MAX_FRAME_DELTA = 0.1
/** Perception runs at 10Hz — raycasting every object at 60Hz is wasted work. */
const PERCEPTION_INTERVAL = 0.1

export type Ticker = (dt: number) => void

/**
 * Rapier's WASM module is a process-wide singleton, so `init()` must resolve
 * once and be shared. Calling it concurrently — which React StrictMode provokes
 * by double-mounting — reinitialises the module underneath live handles and
 * throws "recursive use of an object" out of the physics step.
 */
let rapierReady: Promise<void> | null = null

function initRapier(): Promise<void> {
  rapierReady ??= RAPIER.init()
  return rapierReady
}

/**
 * Owns the three.js scene, the Rapier world, and the frame loop. The MVP scene
 * is deliberately an empty plane: the only variable under test is whether the
 * model can plan, not whether it can navigate clutter.
 */
export class World {
  readonly scene: THREE.Scene
  readonly robot: Robot
  readonly objects: WorldObject[] = []
  readonly model = new WorldModel()

  private readonly rig: CameraRig
  private readonly hud: Hud
  private readonly sky = new Sky()
  private voxels: VoxelTerrain | null = null
  private readonly debug = new DebugVisuals()
  private readonly cameraView = new CameraView()
  private perceptionConfig: PerceptionConfig = DEFAULT_PERCEPTION
  private detail: ObservationDetail = 'full'
  private sightings: Sighting[] = []
  private ground: GroundReading[] = []
  private simTime = 0
  private sincePerception = 0

  private readonly renderer: THREE.WebGLRenderer
  private key!: THREE.DirectionalLight
  private readonly physics: RAPIER.World
  private readonly tickers = new Set<Ticker>()
  private readonly resizeObserver: ResizeObserver

  private accumulator = 0
  private lastTime = 0
  private frameHandle = 0
  private disposed = false

  static async create(canvas: HTMLCanvasElement): Promise<World> {
    await initRapier()
    return new World(canvas)
  }

  private constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene()
    // The dome is the background; anything behind it is never seen.
    this.scene.add(this.sky.mesh)
    this.scene.fog = new THREE.Fog(this.sky.horizon, 22, 48)

    this.rig = new CameraRig(canvas)
    this.hud = new Hud(canvas)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.addLighting()

    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    this.robot = new Robot(RAPIER, this.physics)
    this.scene.add(this.robot.mesh)

    this.loadScene(DEFAULT_SCENE)

    this.debug.setPerception(this.perceptionConfig)
    this.scene.add(this.debug.group)

    this.resizeObserver = new ResizeObserver(() => this.resize(canvas))
    this.resizeObserver.observe(canvas)
    this.resize(canvas)
  }

  /** Registered functions run once per fixed physics step. */
  addTicker(fn: Ticker): () => void {
    this.tickers.add(fn)
    return () => this.tickers.delete(fn)
  }

  /** Sensor parameters come from the robot profile; pushed in before each run. */
  setPerception(config: PerceptionConfig): void {
    this.perceptionConfig = config
    this.debug.setPerception(config)
    // First person shows the same cone the model is told about, so what the
    // operator sees in that mode is genuinely what the robot has.
    this.rig.setPovFov(config.halfAngleDeg * 2)
    // Re-sense immediately so the next observation reflects the new sensor.
    this.updatePerception()
  }

  /**
   * How much the observation may say. Pushed in from the resolved profile
   * alongside the sensor settings, so perception skills can tell whether the
   * model has any other channel to what is around it.
   */
  setObservationDetail(detail: ObservationDetail): void {
    this.detail = detail
  }

  /** The active camera, for anything that needs to project into the view. */
  get camera(): THREE.PerspectiveCamera {
    return this.rig.camera
  }

  get cameraMode(): CameraMode {
    return this.rig.current
  }

  setCameraMode(mode: CameraMode): void {
    this.rig.setMode(mode)
  }

  /**
   * Puts a line above the robot's head. `speech` is the robot talking out loud
   * through the `say` skill; `thought` is the model's narration to the operator,
   * kept visually distinct so the two are never confused.
   */
  speak(text: string, tone: BubbleTone = 'speech'): void {
    this.hud.say('robot', text, () => this.robot.headPosition, tone)
  }

  /** Toggles the field-of-view overlay. Purely a view concern. */
  setDebugVisuals(on: boolean): void {
    this.debug.setVisible(on)
    if (!on) {
      for (const object of this.objects) {
        DebugVisuals.setHighlighted(object.mesh.material as THREE.MeshStandardMaterial, false)
      }
    }
  }

  /** Simulation seconds elapsed, for ageing beliefs in the inspector. */
  get simTimeSeconds(): number {
    return this.simTime
  }

  /**
   * The robot's sensory report, as the model receives it.
   *
   * `proprioceptive` reports only pose and grip — what encoders and a gripper
   * sensor give you for free. Everything else has to be earned with `look`,
   * which is the point: a text manifest of every object does not scale to a
   * large world, and an image does.
   */
  observationText(detail: ObservationDetail = 'full'): string {
    // No ground readings here either: the shape of the ground three metres out
    // is sight, and this mode has none. What is underfoot is already in the
    // pose, which is the part encoders genuinely give you.
    if (detail === 'proprioceptive') return describe(this.robot)
    // `full` is the classical stack, where detection and recognition arrive
    // together, so it simply names everything it senses. That is a property of
    // how the report is written, not of the belief map — which records only
    // what a camera genuinely recognised, whatever mode is running.
    return describe(
      this.robot,
      this.model,
      this.sightings,
      this.simTime,
      detail === 'full',
      this.ground
    )
  }

  /**
   * Renders with the robot's own body and the operator's overlay hidden.
   *
   * Both the photograph and the live first-person view are taken from inside
   * the head, where the robot's own mesh fills the frame and the field-of-view
   * wedge covers everything else. A carried object stays visible, because you
   * do see what you are holding. Shared by both so they cannot drift apart.
   */
  private fromInsideTheHead<T>(render: () => T): T {
    const debugWasVisible = this.debug.group.visible
    this.debug.group.visible = false
    this.robot.mesh.visible = false
    try {
      return render()
    } finally {
      this.robot.mesh.visible = true
      this.debug.group.visible = debugWasVisible
    }
  }

  /** Renders the robot's eye view. Off-screen and on demand. */
  capture(): CameraFrame | null {
    return this.fromInsideTheHead(() => {
      const frame = this.cameraView.capture(
        this.renderer,
        this.scene,
        this.robot,
        this.objects,
        this.sightings,
        this.perceptionConfig
      )
      // Taking the photograph is the recognition step: what the camera has in
      // frame is what the robot can now name. Everything else it has merely
      // bumped into stays anonymous.
      this.model.recognise(frame.labelled)
      // The model gets this frame either way; showing it is what lets the
      // operator see the one moment the robot does something visual.
      this.hud.flashPhoto(
        `data:${frame.mediaType};base64,${frame.base64}`,
        frame.labelled.length > 0 ? frame.labelled.join(' · ') : 'nothing recognised'
      )
      return frame
    })
  }

  /**
   * The narrow surface skills act through.
   *
   * `sightings` and `now` are getters, not values: a skill holds this object for
   * its whole run, so a snapshot would go stale the moment the robot moved —
   * which silently made `scan` report only what was visible when it started.
   */
  view(): WorldView {
    const world = this
    return {
      robot: this.robot,
      objects: this.objects,
      model: this.model,
      get sightings() {
        return world.sightings
      },
      get ground() {
        return world.ground
      },
      get now() {
        return world.simTime
      },
      perception: this.perceptionConfig,
      get observationDetail() {
        return world.detail
      },
      find: (id) => this.objects.find((o) => o.spec.id === id),
      groundHeightAt: (x, z) => this.groundHeightAt(x, z),
      capture: () => this.capture(),
      say: (text) => this.speak(text, 'speech'),
      grasp: (object) => this.grasp(object),
      release: (x, z) => this.release(x, z)
    }
  }

  /**
   * Swaps in a new scene and puts the robot at its starting pose. A scenario
   * has to start from a known state, which the constructor-only scene loading
   * could not provide.
   */
  resetTo(scene: SceneDefinition, start: { x: number; z: number; headingDeg: number }): void {
    this.robot.hold(null)
    for (const object of this.objects) {
      this.scene.remove(object.mesh)
      object.dispose(this.physics)
    }
    this.objects.length = 0

    this.loadScene(scene)

    // The scene is loaded first, so the start pose lands on the new ground
    // rather than at the old world's height.
    this.robot.teleport(
      start.x,
      start.z,
      THREE.MathUtils.degToRad(start.headingDeg),
      this.groundHeightAt(start.x, start.z)
    )
    this.model.clear()
    this.hud.clear()
    this.sightings = []
    this.ground = []
    this.updatePerception()
  }

  /**
   * Plain world state for scoring. Deliberately data-only so criteria
   * evaluation never touches three.js, Rapier, or the renderer.
   */
  snapshot(): WorldSnapshot {
    const p = this.robot.position
    return {
      robot: { x: p.x, y: p.y, z: p.z, holding: this.robot.held?.spec.id ?? null },
      objects: this.objects.map((o) => {
        const pos = o.position
        return {
          id: o.spec.id,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          size: o.spec.size,
          up: o.up
        }
      })
    }
  }

  /**
   * Ground height at a point. Anything placing something on the ground must ask
   * rather than assume zero — the world has not been flat since v0.6.
   */
  groundHeightAt(x: number, z: number): number {
    return this.voxels?.heightAt(x, z) ?? 0
  }

  /** Metres from the centre of the world to its edge. */
  get halfExtent(): number {
    return this.voxels?.world.spec.halfExtent ?? GROUND_HALF_EXTENT
  }

  private loadScene(scene: SceneDefinition): void {
    const resolved = resolveScene(scene)

    this.voxels?.dispose(this.scene, this.physics)
    this.voxels = new VoxelTerrain(resolved.voxel, RAPIER, this.physics)
    this.voxels.addTo(this.scene)
    this.applyHaze(resolved.voxel.spec.halfExtent)

    for (const spec of resolved.objects) {
      const object = new WorldObject(spec, RAPIER, this.physics)
      this.objects.push(object)
      this.scene.add(object.mesh)
    }
  }

  /** Keeps the far haze just past the edge, whatever size the world is. */
  private applyHaze(halfExtent: number): void {
    // Tinted to the horizon, so distance dissolves into smog instead of into
    // a dark band that reads as the edge of the map.
    this.scene.fog = new THREE.Fog(this.sky.horizon, halfExtent * 0.55, halfExtent * 2.2)
  }

  private updatePerception(): void {
    this.sightings = perceive(
      this.robot,
      this.objects,
      this.physics,
      RAPIER,
      this.perceptionConfig
    )
    this.model.update(this.sightings, this.simTime)
    // The ground is sensed on the same tick and through the same cone as the
    // objects standing on it — it is one sensor, not two.
    this.ground = senseGround(this.robot, (x, z) => this.groundHeightAt(x, z), this.perceptionConfig)

    if (this.debug.group.visible) {
      const visible = new Set(this.sightings.map((s) => s.id))
      for (const object of this.objects) {
        DebugVisuals.setHighlighted(
          object.mesh.material as THREE.MeshStandardMaterial,
          visible.has(object.spec.id)
        )
      }
    }
  }

  private grasp(object: WorldObject): void {
    object.setCarried(RAPIER, true)
    this.robot.hold(object)
    // In hand, not in the world: drop it from the map so it isn't also
    // reported as a remembered object lying on the floor.
    this.model.forget(object.spec.id)
  }

  private release(x: number, z: number): WorldObject | null {
    const object = this.robot.held
    if (!object) return null

    this.robot.hold(null)
    object.setCarried(RAPIER, false)
    // Released at carry height so it falls the last short distance and settles
    // on whatever is beneath — which is what makes stacking work.
    object.moveTo(x, this.robot.position.y + 1.05, z)
    return object
  }

  start(): void {
    this.lastTime = performance.now()
    const loop = (now: number): void => {
      if (this.disposed) return
      this.frameHandle = requestAnimationFrame(loop)

      const delta = Math.min((now - this.lastTime) / 1000, MAX_FRAME_DELTA)
      this.lastTime = now
      this.accumulator += delta

      while (this.accumulator >= FIXED_STEP) {
        this.accumulator -= FIXED_STEP
        this.simTime += FIXED_STEP
        for (const tick of this.tickers) tick(FIXED_STEP)
        this.robot.update(FIXED_STEP)
        this.physics.step()

        this.sincePerception += FIXED_STEP
        if (this.sincePerception >= PERCEPTION_INTERVAL) {
          this.sincePerception = 0
          this.updatePerception()
        }
      }

      for (const object of this.objects) object.syncMesh()
      // The wedge shows where the sensors point, which is the head.
      this.debug.update(this.robot.position, this.robot.sensorHeading)
      this.followWithLight()
      this.sky.follow(this.robot.position)

      // Framing runs on the frame delta, not the fixed step: it is direction,
      // not simulation, and it should stay smooth however physics is pacing.
      this.rig.update(delta, this.robot)
      if (this.rig.current === 'pov') {
        this.fromInsideTheHead(() => this.renderer.render(this.scene, this.rig.camera))
      } else {
        this.renderer.render(this.scene, this.rig.camera)
      }
      this.hud.update(this.rig.camera)
    }
    this.frameHandle = requestAnimationFrame(loop)
  }

  dispose(): void {
    // Double-free of the Rapier world is a hard WASM crash, not a no-op.
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frameHandle)
    this.resizeObserver.disconnect()
    this.rig.dispose()
    this.hud.dispose()
    this.voxels?.dispose(this.scene, this.physics)
    this.sky.dispose()
    this.debug.dispose()
    this.renderer.dispose()
    this.physics.free()
  }

  private resize(canvas: HTMLCanvasElement): void {
    const width = canvas.clientWidth || 1
    const height = canvas.clientHeight || 1
    this.rig.setAspect(width / height)
    this.renderer.setSize(width, height, false)
    // Cached so bubble projection never has to read layout per frame.
    this.hud.setSize(width, height)
  }

  private addLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x1a1d26, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(6, 10, 5)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 60
    const frustum = SHADOW_FRUSTUM
    key.shadow.camera.left = -frustum
    key.shadow.camera.right = frustum
    key.shadow.camera.top = frustum
    key.shadow.camera.bottom = -frustum
    this.scene.add(key)
    this.scene.add(key.target)
    this.key = key
  }

  /**
   * Walks the key light along with the robot.
   *
   * A single fixed shadow camera cannot cover a 60m world at a useful
   * resolution: stretched to fit it, shadows turn to mush, and left small it
   * draws a hard edge across the ground where its frustum stops. Moving it
   * keeps a tight, sharp box around wherever anyone is actually looking.
   */
  private followWithLight(): void {
    const p = this.robot.position
    this.key.position.set(p.x + 6, p.y + 10, p.z + 5)
    this.key.target.position.set(p.x, p.y, p.z)
    this.key.target.updateMatrixWorld()
  }

}
