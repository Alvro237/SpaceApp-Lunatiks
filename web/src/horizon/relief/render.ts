/**
 * Draws the real ground of the horizon view from the rings (rings.ts) as the observer sees it.
 *
 * Method: one ray per screen column, as in height-field ray casting. Along the column's azimuth the ray walks
 * outwards from the observer's feet; at each step it reads the ground level of the finest ring there (curvature
 * included, light.ts GroundStack), turns it into an elevation angle seen from the eye, and fills the rows between
 * that angle and the highest one filled so far. Nearer ground is met first, so a ridge hides what lies behind it
 * exactly as it does for the eye. Attributes are interpolated between steps row by row, so the image is smooth
 * however long a step is. The view's projection is the linear one of project.ts (one CSS pixel is the same
 * number of degrees across and up).
 *
 * The skyline stays the site's horizon mask (the one the metrics use): nothing is drawn above it, and where the
 * rings end below it (beyond 164 km with the 5 m DEM) the band up to it takes the last ground's shade.
 *
 * Shading: radiance of a lunar-Lambert surface (McEwen 1991), R = (1 - L) mu0 + 2 L mu0 / (mu0 + mu), with mu0 the
 * cosine of the incidence times the visible share of the solar disc (light.ts) and mu the cosine of the emission
 * angle towards the eye. The limb-darkening weight L falls with the phase angle g (L = 1 - g / 150°, a linear
 * stand-in for the tabulated values). A fixed exposure maps R to the screen. Shadowed ground keeps a floor of
 * AMBIENT so that its shape still reads: the real shadows are darker than drawn. At night the ground facing the
 * Earth is lit by earthshine (the Earth as a second light with its own disc and shadows, light.ts
 * earthshineRatio), with the exposure raised as a camera would (the view says so). Below the DEM's cell, a fine
 * regolith grain from the LROC WAC patch (groundTexture.ts) modulates the albedo near the feet only.
 */
import { R_M } from '../../terrain/tileset'
import type { GroundTexture } from '../groundTexture'
import { type GroundStack, bilinear } from './light'
import { RING_N } from './rings'

export interface ReliefScene {
  stack: GroundStack
  normals: Float32Array[]
  /** Direct sunlight factor per ring (light.ts ringSunlight); null until the worker has answered. */
  sunlight: Float32Array[] | null
  /** Eye level above the sphere, metres. */
  eyeM: number
  /** Sun direction in the observer's frame (east, north, up), for the emission and phase angles. */
  sun: [number, number, number]
  /**
   * Earthshine: direct-light factor of the Earth's disc per ring (as `sunlight`; null by day or with the Earth down),
   * the Earth's direction, and its irradiance as a fraction of sunlight (light.ts earthshineRatio).
   */
  earthlight?: Float32Array[] | null
  earth?: [number, number, number]
  earthRatio?: number
  /** Multiplies the radiance before the tone curve: 1 by day, raised at night so the earthlit ground reads. */
  exposure?: number
  grain: GroundTexture | null
}

export interface ColumnCamera {
  yaw: number
  pitch: number
  cx: number
  cy: number
  degPerPx: number
}

const D = Math.PI / 180
/** Regolith colour at full display level, sRGB. */
const TINT_R = 206
const TINT_G = 200
const TINT_B = 191
const EXPOSURE = 2.4
/** Display level of ground that gets no direct sunlight. */
export const AMBIENT = 0.075
/**
 * Ray steps: near the eye they grow with the distance (NEAR_GROWTH of it, so the perspective between two steps
 * stays close to linear), up to one cell of the ring they cross (STEP_CELLS): bilinear heights between two samples
 * are what a step of one cell reads anyway.
 */
const NEAR_GROWTH = 0.04
const STEP_CELLS = 1
const FIRST_STEP_M = 0.3
/** Grain: metres per level-0 texel, and how strongly it modulates the albedo. */
const GRAIN_M = 0.04
const GRAIN_GAIN = 0.55
const LOG_GRAIN = Math.log2(GRAIN_M)


/** Display level (0..1) of a radiance. */
export const tone = (r: number) => AMBIENT + (1 - AMBIENT) * (1 - Math.exp(-EXPOSURE * Math.max(0, r)))

function mirror(t: number, n: number): number {
  const p = t & (2 * n - 1)
  return p < n ? p : 2 * n - 1 - p
}

function grainAt(tex: GroundTexture, logFoot: number, u: number, v: number): number {
  const lv = logFoot <= 0 ? 0 : Math.round(logFoot)
  if (lv >= tex.levels.length - 1) return 1
  const s = tex.sizes[lv]
  const k = 1 << lv
  const x = Math.floor(u / k)
  const y = Math.floor(v / k)
  return tex.levels[lv][mirror(y, s) * s + mirror(x, s)]
}

/**
 * Render into `out` (cleared to transparent): pixel (i, j) covers CSS x = (i + 0.5) scale, y = (j + 0.5) scale.
 * `horizonAt` is the mask's elevation (degrees) at an azimuth. Returns the number of ray steps taken.
 */
export function renderRelief(out: ImageData, scale: number, c: ColumnCamera, horizonAt: (az: number) => number, s: ReliefScene): number {
  const w = out.width
  const h = out.height
  const px = out.data
  px.fill(0)
  const { stack } = s
  const dTheta = scale * c.degPerPx * D
  const rows = (el: number) => (c.cy - (el - c.pitch) / c.degPerPx) / scale - 0.5
  const f = stack.frame
  const nR = stack.rings.length
  const ringCell = stack.rings.map((r) => r.cellM / f.k0)
  const idx = stack.idx
  const heights = stack.rings.map((r) => r.heights)
  const NM1 = RING_N - 1
  const CEN = NM1 / 2
  const S = s.sun
  const twoR = 2 * R_M
  const headroom = stack.maxU - s.eyeM
  let steps = 0
  const E = s.earth ?? [0, 0, 1]
  const earthRatio = s.earthRatio ?? 0
  const exposure = s.exposure ?? 1
  /** Lunar-Lambert radiance for one light: direct factor mu0, light direction L, unit vector towards the eye. */
  const lunarLambert = (mu0: number, mu: number, Lx: number, Ly: number, Lz: number, vx: number, vy: number, vz: number): number => {
    const cosG = Lx * vx + Ly * vy + Lz * vz
    const L = Math.max(0, 1 - Math.acos(Math.max(-1, Math.min(1, cosG))) / (150 * D))
    return (1 - L) * mu0 + (2 * L * mu0) / (mu0 + mu + 1e-6)
  }
  /**
   * Radiance of the ground at a step (k, u, v in ring k), t metres out, `up` metres above the eye, in units of a
   * sunlit surface, times the exposure: sunlight plus earthshine scaled by its share of sunlight.
   */
  const radiance = (k: number, u: number, v: number, t: number, up: number, sa: number, ca: number): number => {
    const mu0 = s.sunlight ? bilinear(s.sunlight[k], u, v) : 0
    const me = s.earthlight && earthRatio > 0 ? bilinear(s.earthlight[k], u, v) : 0
    if (!(mu0 > 0) && !(me > 0)) return 0
    const o = 3 * (Math.min(NM1, Math.round(v)) * RING_N + Math.min(NM1, Math.round(u)))
    const N = s.normals[k]
    // towards the eye
    const il = 1 / Math.sqrt(t * t + up * up)
    const vx = -t * sa * il
    const vy = -t * ca * il
    const vz = -up * il
    const mu = Math.max(0, N[o] * vx + N[o + 1] * vy + N[o + 2] * vz)
    let R = 0
    if (mu0 > 0) R += lunarLambert(mu0, mu, S[0], S[1], S[2], vx, vy, vz)
    if (me > 0) R += earthRatio * lunarLambert(me, mu, E[0], E[1], E[2], vx, vy, vz)
    return R * exposure
  }
  for (let i = 0; i < w; i++) {
    const az = c.yaw + ((i + 0.5) * scale - c.cx) * c.degPerPx
    const sa = Math.sin(az * D)
    const ca = Math.cos(az * D)
    const maskRow = Math.max(0, rows(horizonAt(((az % 360) + 360) % 360)))
    const maskTop = Math.ceil(maskRow)
    let top = h // rows >= top are filled
    let t = FIRST_STEP_M
    let k = 0
    // the previous step: screen row, ring sample and distance; its radiance only once it is needed
    let pY = NaN
    let pK = 0
    let pU = 0
    let pV = 0
    let pT = 0
    let pUp = 0
    let pR = NaN
    while (top > maskTop) {
      // finest ring under the ray (rings only get coarser outwards)
      const e = t * sa
      const n = t * ca
      let u = 0
      let v = 0
      for (; k < nR; k++) {
        const q = idx[k]
        u = q.au * e + q.bu * n + CEN
        v = q.av * e + q.bv * n + CEN
        if (u >= 0 && v >= 0 && u <= NM1 && v <= NM1) break
      }
      if (k >= nR) break
      // bilinear height
      const H = heights[k]
      const i0 = u < NM1 ? Math.floor(u) : NM1 - 1
      const j0 = v < NM1 ? Math.floor(v) : NM1 - 1
      const fu = u - i0
      const fv = v - j0
      const o = j0 * RING_N + i0
      const hg = (H[o] * (1 - fu) + H[o + 1] * fu) * (1 - fv) + (H[o + RING_N] * (1 - fu) + H[o + RING_N + 1] * fu) * fv
      const drop = (t * t) / twoR
      const up = hg - drop - s.eyeM
      const y = rows(Math.atan2(up, t) / D)
      steps++
      let R = NaN
      if (y < top || pY !== pY) {
        R = radiance(k, u, v, t, up, sa, ca)
        if (pY !== pY) {
          // the first step also stands for the ground between it and the feet
          pY = h
          pR = R
          pT = t
        } else if (pR !== pR) pR = radiance(pK, pU, pV, pT, pUp, sa, ca)
        const r0 = Math.max(maskTop, Math.ceil(y))
        const span = pY - y
        for (let r = Math.min(top, h) - 1; r >= r0; r--) {
          const a = span > 1e-9 ? Math.min(1, Math.max(0, (r - y) / span)) : 0 // 0 at this step, 1 at the previous
          const ta = t + (pT - t) * a
          writePixel(px, 4 * (r * w + i), R + (pR - R) * a, ta, ta * sa, ta * ca, dTheta, s.grain, 255)
        }
        // antialiased top edge: the row the ground only partly covers
        const edge = r0 - 1
        if (edge >= maskTop && edge < top && y < r0) writePixel(px, 4 * (edge * w + i), R, t, e, n, dTheta, s.grain, Math.round(255 * Math.min(1, r0 - y)))
        if (r0 < top) top = r0
      }
      pY = y
      pK = k
      pU = u
      pV = v
      pT = t
      pUp = up
      pR = R
      t += Math.max(0.02, Math.min(STEP_CELLS * ringCell[k], NEAR_GROWTH * t))
      // nothing farther can show: even the highest ground in the rings would stay below the rows filled so far
      if ((steps & 7) === 0 && rows(Math.atan2(headroom - (t * t) / twoR, t) / D) >= top) {
        k = nR
        break
      }
    }
    // beyond the rings (or beyond what can show), up to the mask: the shade of the ground where the ray stopped
    if (top > maskTop && pY === pY) {
      const R = pR !== pR ? radiance(pK, pU, pV, pT, pUp, sa, ca) : pR
      for (let r = Math.min(top, h) - 1; r >= maskTop; r--) writePixel(px, 4 * (r * w + i), R, pT, 0, 0, dTheta, null, 255)
    }
  }
  return steps
}

/** tone() tabulated: TONE_STEPS entries per unit of radiance up to TONE_MAX (the curve is flat beyond). */
const TONE_MAX = 4
const TONE_STEPS = 512
const TONE_LUT = Float32Array.from({ length: TONE_MAX * TONE_STEPS + 2 }, (_, i) => tone(i / TONE_STEPS))

function writePixel(
  px: Uint8ClampedArray,
  o: number,
  R: number,
  t: number,
  e: number,
  n: number,
  dTheta: number,
  grain: GroundTexture | null,
  alpha: number,
): void {
  // partial edge pixels keep the higher alpha already written
  if (alpha < 255 && px[o + 3] >= alpha) return
  let b = TONE_LUT[R > 0 ? (R < TONE_MAX ? (R * TONE_STEPS) | 0 : TONE_MAX * TONE_STEPS) : 0]
  if (grain !== null && t < 60) {
    const logFoot = Math.log2(Math.max(1e-6, 2 * t * dTheta)) - LOG_GRAIN
    const g = grainAt(grain, logFoot, e / GRAIN_M + 311, n / GRAIN_M + 517)
    b *= 1 + (g - 1) * GRAIN_GAIN
  }
  // Uint8ClampedArray rounds and clamps
  px[o] = TINT_R * b
  px[o + 1] = TINT_G * b
  px[o + 2] = TINT_B * b
  px[o + 3] = alpha
}
