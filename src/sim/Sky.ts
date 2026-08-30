import * as THREE from 'three'

/** Well inside every camera's far plane, so it is never clipped away. */
const RADIUS = 300

/**
 * A gradient dome, so the world ends in sky rather than in nothing.
 *
 * A flat dark background reads as a void: the terrain simply stops, and the
 * horizon — the thing that tells you how big a landscape is — does not exist.
 * A vertical gradient with a warm band at eye level costs one sphere and gives
 * distance something to fade into, which matters most in the robot's own camera
 * where there is no other depth cue at range.
 */
export class Sky {
  readonly mesh: THREE.Mesh
  /** What fog should be tinted with, so terrain dissolves into the horizon. */
  readonly horizon: THREE.Color

  constructor(zenith = 0x0a0f1c, horizon = 0x3b4a66, ground = 0x141824) {
    this.horizon = new THREE.Color(horizon)

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        // Never occludes anything, and never writes depth it does not own.
        depthWrite: false,
        fog: false,
        uniforms: {
          zenith: { value: new THREE.Color(zenith) },
          horizon: { value: new THREE.Color(horizon) },
          ground: { value: new THREE.Color(ground) }
        },
        vertexShader: `
          varying vec3 vDirection;
          void main() {
            vDirection = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 zenith;
          uniform vec3 horizon;
          uniform vec3 ground;
          varying vec3 vDirection;
          void main() {
            float h = vDirection.y;
            // Tight band at the horizon, easing to zenith above and to a dark
            // floor below, so the join reads as distance rather than as a seam.
            vec3 sky = mix(horizon, zenith, smoothstep(0.0, 0.55, h));
            vec3 below = mix(horizon, ground, smoothstep(0.0, -0.25, h));
            gl_FragColor = vec4(h > 0.0 ? sky : below, 1.0);
          }
        `
      })
    )
    // It is scenery at infinity: never cull it, never let it sort against solids.
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1
  }

  /** Keeps the dome centred on the viewer, so its edge can never be reached. */
  follow(position: THREE.Vector3): void {
    this.mesh.position.copy(position)
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}
