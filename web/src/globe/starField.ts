/**
 * The real star field behind the globe: the naked-eye stars of the Yale Bright Star Catalogue (horizon/stars.ts) as
 * points at infinity. The globe's axes are fixed to the Moon, so the sky turns around it once a month: each frame
 * the stars' inertial directions are turned into the Moon's frame with the IAU orientation of that instant (the same
 * rotation the horizon view uses) and then into scene axes (orbit.ts: x = x_ME, y = z_ME, z = −y_ME).
 *
 * Drawn at the far plane with the depth test on: the Moon (lit or dark) covers the stars behind it. Size and opacity follow the
 * magnitude, the tint the colour index. They show at every hour (presentation: the globe is not an exposure).
 */
import * as THREE from 'three'
import { STARS, inertialToMoon, starColour } from '../horizon/stars'

const VERT = /* glsl */ `
uniform mat3 uRot;        // inertial (J2000) -> Moon-fixed
uniform float uPixelRatio;
in float size;
in vec4 tint;
out vec4 vTint;
void main() {
  vec3 m = uRot * position;
  vec3 dir = vec3(m.x, m.z, -m.y);
  // at infinity: only the camera's rotation applies; depth pinned to the far plane
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * dir, 1.0);
  gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
  gl_PointSize = size * uPixelRatio;
  vTint = tint;
}
`
const FRAG = /* glsl */ `
precision highp float;
in vec4 vTint;
layout(location = 0) out highp vec4 fragColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.35, d);
  fragColor = vec4(vTint.rgb, vTint.a * a);
}
`

export class StarField {
  readonly points: THREE.Points
  private readonly material: THREE.ShaderMaterial
  private lastMs = NaN

  constructor(pixelRatio: number) {
    const n = STARS.length
    const pos = new Float32Array(n * 3)
    const size = new Float32Array(n)
    const tint = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      const s = STARS[i]
      pos.set([s.x, s.y, s.z], i * 3)
      // the horizon view's rule (scenery.ts): 2.512 per magnitude, compressed for the screen
      const b = Math.pow(10, -0.4 * (s.vmag - 1))
      size[i] = 2 * Math.min(3.4, 0.7 + 0.95 * Math.pow(b, 0.38)) + 1
      const [r, g, bl] = starColour(s.bv)
      tint.set([r / 255, g / 255, bl / 255, Math.min(1, 0.3 + 0.75 * Math.pow(b, 0.45))], i * 4)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(size, 1))
    geometry.setAttribute('tint', new THREE.BufferAttribute(tint, 4))
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uRot: { value: new THREE.Matrix3() }, uPixelRatio: { value: pixelRatio } },
      // transparent objects are drawn after the opaque Moon (renderOrder only sorts within a pass), so the depth
      // test is what hides the stars behind the Moon, its night side included: their depth sits at the far plane
      transparent: true,
      depthTest: true,
      depthWrite: false,
    })
    this.points = new THREE.Points(geometry, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = -1_000_000
  }

  /** Turn the sky to the Moon's orientation at this instant (skipped while the time has not moved a second). */
  update(tMs: number, pixelRatio: number): void {
    this.material.uniforms.uPixelRatio.value = pixelRatio
    if (Math.abs(tMs - this.lastMs) < 1000) return
    this.lastMs = tMs
    const m = inertialToMoon(tMs)
    ;(this.material.uniforms.uRot.value as THREE.Matrix3).set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8])
  }

  dispose(): void {
    this.points.geometry.dispose()
    this.material.dispose()
  }
}
