import * as THREE from 'three'

/** Speech is what the robot says out loud; thought is narration to the operator. */
export type BubbleTone = 'speech' | 'thought'

/** Long enough to read, short enough not to hang over the scene. */
const BASE_MS = 2200
const MS_PER_CHAR = 45
const MAX_MS = 9000
const FADE_MS = 280
/** Bubbles get unreadable long before this; the transcript keeps the full text. */
const MAX_CHARS = 180
const PHOTO_HOLD_MS = 3200

interface Bubble {
  element: HTMLDivElement
  anchor: () => THREE.Vector3
  expiresAt: number
  removeAt: number
}

/**
 * The layer between the scene and the operator: speech above the robot's head,
 * and the photograph it just took.
 *
 * Styled inline rather than from the stylesheet so `sim/` stays self-contained —
 * the simulation can be dropped into any host page and still show its own
 * speech. Bubbles are keyed by owner, so a second robot gets its own.
 */
export class Hud {
  private readonly root: HTMLDivElement
  private readonly bubbles = new Map<string, Bubble>()
  private readonly projected = new THREE.Vector3()
  private photo: HTMLDivElement | null = null
  private photoTimer: ReturnType<typeof setTimeout> | null = null
  private width = 1
  private height = 1

  constructor(canvas: HTMLCanvasElement) {
    this.root = document.createElement('div')
    // Never intercept a drag: the camera controls live under this layer.
    this.root.style.cssText =
      'position:absolute;inset:0;overflow:hidden;pointer-events:none;' +
      "font-family:inherit;z-index:2"
    canvas.parentElement?.appendChild(this.root)
  }

  setSize(width: number, height: number): void {
    this.width = width
    this.height = height
  }

  /** Puts a line above `anchor`, replacing whatever that owner was saying. */
  say(owner: string, text: string, anchor: () => THREE.Vector3, tone: BubbleTone = 'speech'): void {
    const trimmed = text.trim()
    if (!trimmed) return
    this.bubbles.get(owner)?.element.remove()

    const shown = trimmed.length > MAX_CHARS ? `${trimmed.slice(0, MAX_CHARS).trimEnd()}…` : trimmed
    const element = document.createElement('div')
    element.textContent = shown
    element.style.cssText =
      'position:absolute;transform:translate(-50%,-100%) translateY(6px);' +
      'max-width:min(320px,42%);padding:0.45rem 0.7rem;border-radius:12px;' +
      'font-size:13px;line-height:1.35;white-space:pre-wrap;opacity:0;' +
      `transition:opacity ${FADE_MS}ms ease,transform ${FADE_MS}ms ease;` +
      (tone === 'speech'
        ? 'background:rgba(16,20,30,0.92);color:#eef1f8;border:1px solid #4c7dff;' +
          'box-shadow:0 6px 20px rgba(0,0,0,0.45);'
        : 'background:rgba(16,20,30,0.72);color:#aeb6c8;border:1px dashed #3a4256;' +
          'font-style:italic;box-shadow:0 6px 20px rgba(0,0,0,0.35);')
    this.root.appendChild(element)

    // Flush the starting style synchronously rather than waiting a frame: a
    // bubble raised while the loop is paused would otherwise never fade in.
    forceStyleFlush(element)
    element.style.opacity = '1'
    element.style.transform = 'translate(-50%,-100%) translateY(0)'

    const visibleFor = Math.min(MAX_MS, BASE_MS + shown.length * MS_PER_CHAR)
    const now = performance.now()
    this.bubbles.set(owner, {
      element,
      anchor,
      expiresAt: now + visibleFor,
      removeAt: now + visibleFor + FADE_MS
    })
  }

  /** Shows the frame the robot just captured, labels and all. */
  flashPhoto(dataUrl: string, caption: string): void {
    this.photo?.remove()
    if (this.photoTimer) clearTimeout(this.photoTimer)

    const frame = document.createElement('div')
    frame.style.cssText =
      'position:absolute;left:1rem;bottom:1rem;width:min(260px,32%);' +
      'border:1px solid #4c7dff;border-radius:10px;overflow:hidden;' +
      'background:rgba(11,13,18,0.92);box-shadow:0 10px 30px rgba(0,0,0,0.5);' +
      'opacity:0;transform:translateY(10px) scale(0.96);' +
      'transition:opacity 220ms ease,transform 220ms ease;'

    const image = document.createElement('img')
    image.src = dataUrl
    image.style.cssText = 'display:block;width:100%;height:auto;'
    frame.appendChild(image)

    const label = document.createElement('div')
    label.textContent = caption
    label.style.cssText =
      'padding:0.3rem 0.5rem;font-size:11px;color:#aeb6c8;' +
      'border-top:1px solid rgba(76,125,255,0.35);'
    frame.appendChild(label)

    this.root.appendChild(frame)
    this.photo = frame
    forceStyleFlush(frame)
    frame.style.opacity = '1'
    frame.style.transform = 'translateY(0) scale(1)'

    this.photoTimer = setTimeout(() => {
      frame.style.opacity = '0'
      frame.style.transform = 'translateY(10px) scale(0.96)'
      this.photoTimer = setTimeout(() => {
        frame.remove()
        if (this.photo === frame) this.photo = null
      }, 240)
    }, PHOTO_HOLD_MS)
  }

  /** Projects every live bubble to screen space. Called once per rendered frame. */
  update(camera: THREE.Camera): void {
    const now = performance.now()

    for (const [owner, bubble] of this.bubbles) {
      if (now >= bubble.removeAt) {
        bubble.element.remove()
        this.bubbles.delete(owner)
        continue
      }
      if (now >= bubble.expiresAt) {
        bubble.element.style.opacity = '0'
        bubble.element.style.transform = 'translate(-50%,-100%) translateY(-6px)'
      }

      this.projected.copy(bubble.anchor()).project(camera)
      // z > 1 means the anchor is behind the camera, where the projection flips.
      if (this.projected.z > 1) {
        bubble.element.style.visibility = 'hidden'
        continue
      }
      bubble.element.style.visibility = 'visible'
      bubble.element.style.left = `${((this.projected.x + 1) / 2) * this.width}px`
      bubble.element.style.top = `${((1 - this.projected.y) / 2) * this.height}px`
    }
  }

  /** Drops everything on screen. Used when a scenario resets the world. */
  clear(): void {
    for (const bubble of this.bubbles.values()) bubble.element.remove()
    this.bubbles.clear()
    if (this.photoTimer) clearTimeout(this.photoTimer)
    this.photo?.remove()
    this.photo = null
  }

  dispose(): void {
    this.clear()
    this.root.remove()
  }
}

/**
 * Reads a layout property to make the browser commit the element's current
 * styles, so the next assignment is a transition rather than an initial value.
 */
function forceStyleFlush(element: HTMLElement): void {
  void element.offsetWidth
}
