import * as THREE from 'three'
import type { Robot } from './Robot.js'
import type { WorldObject } from './objects.js'
import type { PerceptionConfig, Sighting } from './perception.js'

/** Small enough to stay affordable in tokens, large enough to read labels. */
const WIDTH = 640
const HEIGHT = 480
/** JPEG rather than PNG: a rendered 3D frame compresses far better as one. */
const QUALITY = 0.72
const EYE_HEIGHT = 1.5

export interface CameraFrame {
  mediaType: 'image/jpeg'
  /** Base64 payload with no data: prefix. */
  base64: string
  labelled: string[]
}

/**
 * Renders what the robot can see, with the id of each visible object drawn onto
 * it.
 *
 * The labels are not decoration. Every movement skill takes world coordinates,
 * and a model looking at raw pixels has no way to produce them — it can see a
 * block but cannot say where it is. Drawing ids in gives it referents it can
 * name, which is what makes `approach(red_block)` possible from vision alone.
 */
export class CameraView {
  private readonly camera: THREE.PerspectiveCamera
  private readonly target: THREE.WebGLRenderTarget
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly pixels = new Uint8Array(WIDTH * HEIGHT * 4)

  constructor() {
    this.camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.3, 600)
    this.target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT)

    this.canvas = document.createElement('canvas')
    this.canvas.width = WIDTH
    this.canvas.height = HEIGHT
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('Could not create a 2D context for the robot camera.')
    this.ctx = ctx
  }

  /**
   * Renders one frame from the robot's eye. Off-screen and on demand — this is
   * not part of the per-frame loop.
   */
  capture(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    robot: Robot,
    objects: WorldObject[],
    sightings: Sighting[],
    perception: PerceptionConfig
  ): CameraFrame {
    const eye = robot.position
    this.camera.position.set(eye.x, eye.y + EYE_HEIGHT, eye.z)
    // Match the sensor the observation uses, so the picture and the text agree.
    this.camera.fov = Math.min(170, perception.halfAngleDeg * 2)
    // Far enough to reach the horizon. Range limits what perception *reports*,
    // not what a lens can see — clipping the photo at sensor range hid every
    // landmark beyond it, which is the opposite of what a camera is for.
    // A three.js camera looks down its local -Z, but heading 0 faces world +Z,
    // so the yaw needs half a turn or the robot photographs what is behind it.
    // Sensor heading, not body heading: the camera is in the head and turns
    // with it, which is what makes a glance to one side mean anything.
    this.camera.rotation.set(0, robot.sensorHeading + Math.PI, 0, 'YXZ')
    this.camera.updateProjectionMatrix()
    this.camera.updateMatrixWorld(true)

    const previousTarget = renderer.getRenderTarget()
    renderer.setRenderTarget(this.target)
    renderer.render(scene, this.camera)
    renderer.readRenderTargetPixels(this.target, 0, 0, WIDTH, HEIGHT, this.pixels)
    renderer.setRenderTarget(previousTarget)

    this.drawPixels()
    const labelled = this.drawLabels(objects, sightings)

    return {
      mediaType: 'image/jpeg',
      base64: this.canvas.toDataURL('image/jpeg', QUALITY).split(',')[1] ?? '',
      labelled
    }
  }

  /** WebGL reads bottom-up, so the rows go back in reverse. */
  private drawPixels(): void {
    const image = this.ctx.createImageData(WIDTH, HEIGHT)
    const rowBytes = WIDTH * 4
    for (let y = 0; y < HEIGHT; y++) {
      const from = (HEIGHT - 1 - y) * rowBytes
      image.data.set(this.pixels.subarray(from, from + rowBytes), y * rowBytes)
    }
    this.ctx.putImageData(image, 0, 0)
  }

  /** Marks each visible object with its id, projected to where it appears. */
  private drawLabels(objects: WorldObject[], sightings: Sighting[]): string[] {
    const drawn: string[] = []
    this.ctx.font = '600 15px ui-monospace, monospace'
    this.ctx.textBaseline = 'middle'
    this.ctx.lineWidth = 2

    for (const sighting of sightings) {
      const object = objects.find((o) => o.spec.id === sighting.id)
      if (!object) continue

      const top = object.position.clone()
      top.y += object.spec.size[1] / 2
      const ndc = top.project(this.camera)
      if (ndc.z > 1) continue

      const x = ((ndc.x + 1) / 2) * WIDTH
      const y = ((1 - ndc.y) / 2) * HEIGHT
      if (x < 0 || x > WIDTH || y < 0 || y > HEIGHT) continue

      const text = sighting.id
      const width = this.ctx.measureText(text).width

      this.ctx.fillStyle = 'rgba(10, 12, 18, 0.82)'
      this.ctx.fillRect(x - width / 2 - 6, y - 22, width + 12, 20)
      this.ctx.strokeStyle = '#4c7dff'
      this.ctx.strokeRect(x - width / 2 - 6, y - 22, width + 12, 20)

      this.ctx.fillStyle = '#ffffff'
      this.ctx.textAlign = 'center'
      this.ctx.fillText(text, x, y - 12)

      // A tick down to the object, so a label cannot be mistaken for a neighbour.
      this.ctx.strokeStyle = 'rgba(76, 125, 255, 0.9)'
      this.ctx.beginPath()
      this.ctx.moveTo(x, y - 2)
      this.ctx.lineTo(x, y + 8)
      this.ctx.stroke()

      drawn.push(text)
    }

    return drawn
  }

  dispose(): void {
    this.target.dispose()
  }
}
