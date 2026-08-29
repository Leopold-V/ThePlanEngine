import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import RAPIER from '@dimforge/rapier3d-compat'
import { Robot } from './Robot.js'

const GROUND_HALF_EXTENT = 25
const FIXED_STEP = 1 / 60
/** Never simulate more than this per frame, so a stalled tab can't spiral. */
const MAX_FRAME_DELTA = 0.1

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

    this.resizeObserver = new ResizeObserver(() => this.resize(canvas))
    this.resizeObserver.observe(canvas)
    this.resize(canvas)
  }

  /** Registered functions run once per fixed physics step. */
  addTicker(fn: Ticker): () => void {
    this.tickers.add(fn)
    return () => this.tickers.delete(fn)
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
        for (const tick of this.tickers) tick(FIXED_STEP)
        this.robot.update(FIXED_STEP)
        this.physics.step()
      }

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
