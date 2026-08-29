import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import RAPIER from '@dimforge/rapier3d-compat'
import { Robot } from './Robot.js'
import { WorldModel } from './WorldModel.js'
import { CameraView } from './CameraView.js'
import { DebugVisuals } from './debugVisuals.js'
import { describe } from './observe.js'
import { DEFAULT_SCENE, WorldObject, type SceneDefinition } from './objects.js'
import { DEFAULT_PERCEPTION, perceive, type PerceptionConfig, type Sighting } from './perception.js'
import type { WorldView } from './WorldView.js'
import type { WorldSnapshot } from '@shared/scenario.js'
import type { ObservationDetail } from '@shared/profile.js'
import type { CameraFrame } from './CameraView.js'

const GROUND_HALF_EXTENT = 25
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
  readonly camera: THREE.PerspectiveCamera
  readonly robot: Robot
  readonly objects: WorldObject[] = []
  readonly model = new WorldModel()

  private readonly debug = new DebugVisuals()
  private readonly cameraView = new CameraView()
  private perceptionConfig: PerceptionConfig = DEFAULT_PERCEPTION
  private sightings: Sighting[] = []
  private simTime = 0
  private sincePerception = 0

  private readonly renderer: THREE.WebGLRenderer
  private readonly controls: OrbitControls
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
    this.scene.background = new THREE.Color(0x0b0d12)
    this.scene.fog = new THREE.Fog(0x0b0d12, 22, 48)

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200)
    this.camera.position.set(4.5, 3.4, 6)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.target.set(0, 1, 0)
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05

    this.addLighting()
    this.addGround()

    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(GROUND_HALF_EXTENT, 0.1, GROUND_HALF_EXTENT).setTranslation(
        0,
        -0.1,
        0
      )
    )

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
    // Re-sense immediately so the next observation reflects the new sensor.
    this.updatePerception()
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
    return detail === 'proprioceptive'
      ? describe(this.robot)
      : describe(this.robot, this.model, this.sightings, this.simTime)
  }

  /** Renders the robot's eye view. Off-screen and on demand. */
  capture(): CameraFrame | null {
    // The operator's debug overlay is not part of the world, and the camera
    // sits inside the robot's own head — neither belongs in the photo. A
    // carried object stays visible, because you do see what you are holding.
    const debugWasVisible = this.debug.group.visible
    this.debug.group.visible = false
    this.robot.mesh.visible = false

    try {
      return this.cameraView.capture(
        this.renderer,
        this.scene,
        this.robot,
        this.objects,
        this.sightings,
        this.perceptionConfig
      )
    } finally {
      this.robot.mesh.visible = true
      this.debug.group.visible = debugWasVisible
    }
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
      get now() {
        return world.simTime
      },
      perception: this.perceptionConfig,
      find: (id) => this.objects.find((o) => o.spec.id === id),
      capture: () => this.capture(),
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

    this.robot.teleport(start.x, start.z, THREE.MathUtils.degToRad(start.headingDeg))
    this.model.clear()
    this.sightings = []
    this.updatePerception()
  }

  /**
   * Plain world state for scoring. Deliberately data-only so criteria
   * evaluation never touches three.js, Rapier, or the renderer.
   */
  snapshot(): WorldSnapshot {
    const p = this.robot.position
    return {
      robot: { x: p.x, z: p.z, holding: this.robot.held?.spec.id ?? null },
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

  private loadScene(scene: SceneDefinition): void {
    for (const spec of scene.objects) {
      const object = new WorldObject(spec, RAPIER, this.physics)
      this.objects.push(object)
      this.scene.add(object.mesh)
    }
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
      this.debug.update(this.robot.position, this.robot.heading)

      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    }
    this.frameHandle = requestAnimationFrame(loop)
  }

  dispose(): void {
    // Double-free of the Rapier world is a hard WASM crash, not a no-op.
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frameHandle)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.debug.dispose()
    this.renderer.dispose()
    this.physics.free()
  }

  private resize(canvas: HTMLCanvasElement): void {
    const width = canvas.clientWidth || 1
    const height = canvas.clientHeight || 1
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  private addLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x1a1d26, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(6, 10, 5)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 1
    key.shadow.camera.far = 40
    const frustum = 14
    key.shadow.camera.left = -frustum
    key.shadow.camera.right = frustum
    key.shadow.camera.top = frustum
    key.shadow.camera.bottom = -frustum
    this.scene.add(key)
  }

  private addGround(): void {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_HALF_EXTENT * 2, GROUND_HALF_EXTENT * 2),
      new THREE.MeshStandardMaterial({ color: 0x141824, roughness: 0.95, metalness: 0 })
    )
    plane.rotation.x = -Math.PI / 2
    plane.receiveShadow = true
    this.scene.add(plane)

    // The grid is the model's only spatial reference, so keep it legible.
    const grid = new THREE.GridHelper(GROUND_HALF_EXTENT * 2, GROUND_HALF_EXTENT * 2, 0x4c7dff, 0x232838)
    grid.position.y = 0.01
    this.scene.add(grid)
  }
}
