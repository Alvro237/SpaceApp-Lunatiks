/**
 * The real sky behind the globe: NASA SVS Deep Star Maps 2020 (about 1.7 billion stars from Hipparcos-2, Tycho-2
 * and Gaia DR2, the Milky Way included), an equirectangular map in J2000 right ascension and declination built by
 * pipeline/lunarnav/sky.py into data/sky (the build checks that the 25 brightest Bright Star Catalogue stars fall on
 * the map within 0.33 pixels).
 *
 * It sits behind the catalogue points of starField.ts and turns with them: each pixel's scene direction is taken
 * back to the Moon frame (orbit.ts: x = x_ME, y = z_ME, z = −y_ME) and then to the inertial frame with the transpose
 * of the same IAU rotation (horizon/stars.ts, inertialToMoon), and the map is read at that right ascension and
 * declination. The map's centre column is 0 h and right ascension grows to the left, so u = 0.5 − α / 360°.
 *
 * Drawn at the far plane with the depth test on, like the points: the Moon covers it. The brightness factor is a
 * presentation choice (the globe is not an exposure); the map's own colours are kept.
 */
import * as THREE from 'three'
import { inertialToMoon } from '../horizon/stars'
import { DATA_BASE } from '../time/staticData'

/** Multiplies the map's colours on screen (presentation choice: the Milky Way visible without hiding the Moon). */
const GAIN = 1.0

const VERT = /* glsl */ `
out vec3 vDir;
void main() {
  vDir = position;
  // at infinity: only the camera's rotation applies; depth pinned to the far plane
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
}
`
const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform mat3 uRot;        // inertial (J2000) -> Moon-fixed
uniform float uGain;
in vec3 vDir;
layout(location = 0) out highp vec4 fragColor;
const float PI = 3.141592653589793;
void main() {
  vec3 s = normalize(vDir);
  vec3 i = transpose(uRot) * vec3(s.x, -s.z, s.y);
  float ra = atan(i.y, i.x);
  float dec = asin(clamp(i.z, -1.0, 1.0));
  vec2 uv = vec2(0.5 - ra / (2.0 * PI), 0.5 + dec / PI);
  // the u seam (right ascension 180°) would pick the smallest mip level along a one-pixel line: take the derivatives
  // of a copy of u whose seam is elsewhere when they are smaller
  float u2 = fract(uv.x + 0.5);
  vec2 dx = vec2(dFdx(uv.x), dFdx(uv.y));
  vec2 dy = vec2(dFdy(uv.x), dFdy(uv.y));
  float dx2 = dFdx(u2);
  float dy2 = dFdy(u2);
  if (abs(dx2) < abs(dx.x)) dx.x = dx2;
  if (abs(dy2) < abs(dy.x)) dy.x = dy2;
  fragColor = vec4(textureGrad(uMap, uv, dx, dy).rgb * uGain, 1.0);
}
`

/**
 * The 4k map (1.3 MB) loads first, so the opening view does not wait for the 8k one (3.8 MB). Large-texture desktop
 * GPUs then swap in the 8k map after UPGRADE_DELAY_MS (128 MB of GPU memory against 32 MB); others keep the 4k.
 */
const UPGRADE_DELAY_MS = 10_000

function wantsLargeMap(gl: THREE.WebGLRenderer): boolean {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
  return gl.capabilities.maxTextureSize >= 16384 && !coarse
}

export class SkyMap {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.ShaderMaterial
  private texture: THREE.Texture | null = null
  /** Rank of the map shown: 0 the 4k, 1 the 8k; -1 none yet. */
  private rank = -1
  private upgrade: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  /** Stops the downloads of a sky that is gone before they finish. */
  private readonly abort = new AbortController()
  private lastMs = NaN

  constructor(gl: THREE.WebGLRenderer) {
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: null }, uRot: { value: new THREE.Matrix3() }, uGain: { value: GAIN } },
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1_000_001 // before the catalogue points, which blend over it
    this.mesh.visible = false // until the map has arrived; the catalogue points show meanwhile

    this.load(gl, 'starmap_4k.jpg', 0)
    if (wantsLargeMap(gl)) this.upgrade = setTimeout(() => this.load(gl, 'starmap_8k.jpg', 1), UPGRADE_DELAY_MS)
  }

  /**
   * Loads a map and shows it unless a sharper one (higher rank) is already shown. The JPEG is decoded off the main
   * thread (createImageBitmap): handed to the GPU as an <img>, the 8k map was decoded inside the frame that first
   * drew it, which froze the picture for about 0.7 s ten seconds after the globe opened (measured 2026-11-15). The
   * bitmap is flipped while decoding (WebGL does not flip a bitmap on upload) and freed once it is on the GPU. A
   * browser that cannot do this takes the old path.
   */
  private load(gl: THREE.WebGLRenderer, file: string, rank: number): void {
    const url = `${DATA_BASE}sky/${file}`
    const show = (tex: THREE.Texture) => {
      if (this.disposed || rank < this.rank) {
        tex.dispose()
        return false
      }
      tex.colorSpace = THREE.NoColorSpace // the file holds the colours to show (the canvas is not colour-managed)
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.ClampToEdgeWrapping
      tex.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
      tex.needsUpdate = true
      this.texture?.dispose()
      this.texture = tex
      this.rank = rank
      this.material.uniforms.uMap.value = tex
      this.mesh.visible = true
      return true
    }
    const viaImage = () => void new THREE.TextureLoader().load(url, show)
    if (typeof createImageBitmap !== 'function') return viaImage()
    fetch(url, { signal: this.abort.signal })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((blob) => createImageBitmap(blob, { imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
      .then((bitmap) => {
        const tex = new THREE.Texture(bitmap)
        tex.flipY = false
        tex.onUpdate = () => {
          tex.onUpdate = null
          bitmap.close()
        }
        if (!show(tex)) bitmap.close()
      })
      .catch(() => {
        if (!this.disposed) viaImage()
      })
  }

  /** Turn the sky to the Moon's orientation at this instant (skipped while the time has not moved a second). */
  update(tMs: number): void {
    if (Math.abs(tMs - this.lastMs) < 1000) return
    this.lastMs = tMs
    const m = inertialToMoon(tMs)
    ;(this.material.uniforms.uRot.value as THREE.Matrix3).set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8])
  }

  dispose(): void {
    this.disposed = true
    this.abort.abort()
    clearTimeout(this.upgrade)
    this.texture?.dispose()
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
