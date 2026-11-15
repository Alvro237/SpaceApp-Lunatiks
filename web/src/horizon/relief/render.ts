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
 * The ground is drawn up to its own silhouette, so a ridge or a crater wall rising above the site's horizon mask
 * shows as the wall it is, with its photo and its light (the mask comes from a coarser grid away from the poles:
 * 3.8 km cells against the rings' 60-118 m, and misses near slopes). The mask, the skyline the metrics use, is drawn
 * over it as a thin line (drawRelief.ts). Where the mask stands above the rings' ground instead, the band up to it
 * takes the shade of the last ground the ray met.
 *
 * Shading: radiance of a lunar-Lambert surface (McEwen 1991), R = (1 - L) mu0 + 2 L mu0 / (mu0 + mu), with mu0 the
 * cosine of the incidence times the visible share of the solar disc (light.ts) and mu the cosine of the emission
 * angle towards the eye. The limb-darkening weight L falls with the phase angle g (L = 1 - g / 150°, a linear
 * stand-in for the tabulated values). A fixed exposure maps R to the screen. Shadowed ground keeps a floor of
 * AMBIENT so that its shape still reads: the real shadows are darker than drawn. At night the ground facing the
 * Earth is lit by earthshine (the Earth as a second light with its own disc and shadows, light.ts
 * earthshineRatio), with the exposure raised as a camera would (the view says so).
 *
 * Albedo: this place's own LROC WAC mosaic multiplies the radiance, as the photo views of the globe and of the polar
 * map drape the mosaic over the LOLA relief. Where a detail tile has been read (detailPhoto.ts: the far ground the
 * ray casting finds visible, at the mosaic's own 100 m) it is used, and the ray steps no longer than DETAIL_STEP_M
 * there so the photo's detail is not stepped over; elsewhere the photo read over each ring's cells (rings.ts). The
 * mosaic keeps the shadows it was photographed with; their floor (ALBEDO_MIN) leaves that ground to the light of
 * the chosen instant. Without a photo the ground is plain regolith (albedo 1).
 */
import { R_M } from '../../terrain/tileset'
import type { GroundTexture } from '../groundTexture'
import { type GroundStack, bilinear, lightFromHorizon } from './light'
import { RING_N } from './rings'

export interface ReliefScene {
  stack: GroundStack
  normals: Float32Array[]
  /**
   * Height of the terrain horizon towards the Sun over the Sun's centre, degrees, per ring sample (light.ts
   * ringLightHorizon); null until the worker has answered. Interpolated per pixel, then turned into the visible
   * share of the disc, so the edges of shadows are smooth and fall where the geometry puts them.
   */
  sunlight: Float32Array[] | null
  /** Eye level above the sphere, metres. */
  eyeM: number
  /** Sun direction in the observer's frame (east, north, up), for the emission and phase angles. */
  sun: [number, number, number]
  /** Angular radii of the Sun and the Earth, degrees (defaults 0.2666 and 0.95). */
  sunRadiusDeg?: number
  earthRadiusDeg?: number
  /**
   * Earthshine: horizon over the Earth per ring (as `sunlight`; null by day or with the Earth down),
   * the Earth's direction, and its irradiance as a fraction of sunlight (light.ts earthshineRatio).
   */
  earthlight?: Float32Array[] | null
  earth?: [number, number, number]
  earthRatio?: number
  /** Multiplies the radiance before the tone curve: 1 by day, raised at night so the earthlit ground reads. */
  exposure?: number
  /** Albedo per ring (rings.ts ringAlbedo), aligned with stack.rings; null or missing: plain regolith. */
  albedo?: (Float32Array | null | undefined)[]
  /** Albedo from the finer photo tiles at a point (east, north metres from the observer), or NaN where none is loaded. */
  detailAt?: (e: number, n: number) => number
  /** Pixel of that finer photo, metres (where the grain stops adding detail). */
  detailPixelM?: number
  /** Regolith grain under the DEM's cell, near the feet only (groundTexture.ts), as before; null: none. */
  grain?: GroundTexture | null
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
/**
 * Ray steps over ground with a finer photo: no longer than DETAIL_STEP_M (about a Kaguya TC pixel) or
 * DETAIL_STEP_REL of the distance, whichever is longer (a step at 10 km already covers several pixels of the screen
 * along the ray at grazing incidence).
 */
export const DETAIL_STEP_M = 20
const DETAIL_STEP_REL = 0.004
/**
 * Grain: the regolith texture of the LROC WAC patch (groundTexture.ts), the same at the feet as on a hill 10 km
 * away. Its world scale steps up in octaves of GRAIN_M x 2^L with the pixel's footprint on the ground (fixed to the
 * ground, so it does not swim as the view turns), and it is laid only below the resolution of the photo there: full
 * where a pixel covers under a quarter of a photo pixel, none where it covers a whole one (the photo's own detail
 * takes over). GRAIN_GAIN: how strongly it modulates the albedo.
 */
const GRAIN_M = 0.04
const GRAIN_GAIN = 0.55
const LOG_GRAIN = Math.log2(GRAIN_M)
/** Pixel of the photo read for each ring when no finer tile covers the ground, metres (WAC 100 m at best). */
const RING_PHOTO_MIN_M = 100


/** Limb-darkening weight L = max(0, 1 - g / 150°) tabulated over cos g in [-1, 1] (LAMBERT_STEPS + 1 entries). */
const LAMBERT_STEPS = 4096
const LAMBERT_LUT = Float32Array.from({ length: LAMBERT_STEPS + 1 }, (_, i) => Math.max(0, 1 - Math.acos(-1 + (2 * i) / LAMBERT_STEPS) / (150 * D)))

/** Display level (0..1) of a radiance. */
export const tone = (r: number) => AMBIENT + (1 - AMBIENT) * (1 - Math.exp(-EXPOSURE * Math.max(0, r)))

function mirror(t: number, n: number): number {
  const p = t & (2 * n - 1)
  return p < n ? p : 2 * n - 1 - p
}

/** Bilinear sample of one mip level at level-0 texel coordinates (mirrored repeat, so no seams). */
function grainLevel(tex: GroundTexture, lv: number, u: number, v: number): number {
  const s = tex.sizes[lv]
  const k = 1 << lv
  const x = u / k - 0.5
  const y = v / k - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const L = tex.levels[lv]
  const xa = mirror(x0, s)
  const xb = mirror(x0 + 1, s)
  const ya = mirror(y0, s) * s
  const yb = mirror(y0 + 1, s) * s
  return (L[ya + xa] * (1 - fx) + L[ya + xb] * fx) * (1 - fy) + (L[yb + xa] * (1 - fx) + L[yb + xb] * fx) * fy
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
  const detailAt = s.detailAt
  const detailPx = s.detailPixelM ?? 20
  const grain = s.grain ?? null
  const dTheta = scale * c.degPerPx * D
  // set by radiance() for the step it shades: emission cosine, and the pixel of the photo used there (metres)
  let lastMu = 1
  let lastPhotoM = RING_PHOTO_MIN_M
  let lastFine = false
  /** Lunar-Lambert radiance for one light: direct factor mu0, light direction L, unit vector towards the eye. */
  const lunarLambert = (mu0: number, mu: number, Lx: number, Ly: number, Lz: number, vx: number, vy: number, vz: number): number => {
    const cosG = Lx * vx + Ly * vy + Lz * vz
    const L = LAMBERT_LUT[Math.round((Math.max(-1, Math.min(1, cosG)) + 1) * (LAMBERT_STEPS / 2))]
    return (1 - L) * mu0 + (2 * L * mu0) / (mu0 + mu + 1e-6)
  }
  /**
   * Radiance of the ground at a step (k, u, v in ring k), t metres out, `up` metres above the eye, in units of a
   * sunlit surface, times the exposure: sunlight plus earthshine scaled by its share of sunlight.
   */
  const rSun = s.sunRadiusDeg ?? 0.2666
  const rEarth = s.earthRadiusDeg ?? 0.95
  const nrm = new Float64Array(3)
  /** Bilinear normal of ring k at (u, v), normalised, into nrm. */
  const normalAt = (k: number, u: number, v: number) => {
    const N = s.normals[k]
    const i0 = u < NM1 ? Math.floor(u) : NM1 - 1
    const j0 = v < NM1 ? Math.floor(v) : NM1 - 1
    const fu = u - i0
    const fv = v - j0
    const o = 3 * (j0 * RING_N + i0)
    const o1 = o + 3
    const o2 = o + 3 * RING_N
    const o3 = o2 + 3
    const w0 = (1 - fu) * (1 - fv)
    const w1 = fu * (1 - fv)
    const w2 = (1 - fu) * fv
    const w3 = fu * fv
    const x = N[o] * w0 + N[o1] * w1 + N[o2] * w2 + N[o3] * w3
    const y = N[o + 1] * w0 + N[o1 + 1] * w1 + N[o2 + 1] * w2 + N[o3 + 1] * w3
    const z = N[o + 2] * w0 + N[o1 + 2] * w1 + N[o2 + 2] * w2 + N[o3 + 2] * w3
    const il = 1 / Math.sqrt(x * x + y * y + z * z)
    nrm[0] = x * il
    nrm[1] = y * il
    nrm[2] = z * il
  }
  const radiance = (k: number, u: number, v: number, t: number, up: number, sa: number, ca: number): number => {
    const hasEarth = s.earthlight && earthRatio > 0
    lastFine = false
    if (!s.sunlight && !hasEarth) return 0
    normalAt(k, u, v)
    // towards the eye
    const il = 1 / Math.sqrt(t * t + up * up)
    const vx = -t * sa * il
    const vy = -t * ca * il
    const vz = -up * il
    const mu = Math.max(0, nrm[0] * vx + nrm[1] * vy + nrm[2] * vz)
    lastMu = mu
    let R = 0
    if (s.sunlight) {
      const cosI = nrm[0] * S[0] + nrm[1] * S[1] + nrm[2] * S[2]
      if (cosI > 0) {
        const mu0 = cosI * lightFromHorizon(bilinear(s.sunlight[k], u, v), rSun)
        if (mu0 > 0) R += lunarLambert(mu0, mu, S[0], S[1], S[2], vx, vy, vz)
      }
    }
    if (hasEarth) {
      const cosI = nrm[0] * E[0] + nrm[1] * E[1] + nrm[2] * E[2]
      if (cosI > 0) {
        const me = cosI * lightFromHorizon(bilinear(s.earthlight![k], u, v), rEarth)
        if (me > 0) R += earthRatio * lunarLambert(me, mu, E[0], E[1], E[2], vx, vy, vz)
      }
    }
    const fine = detailAt ? detailAt(t * sa, t * ca) : NaN
    if (fine === fine) {
      lastFine = true
      lastPhotoM = detailPx
      return R * exposure * fine
    }
    lastPhotoM = Math.max(RING_PHOTO_MIN_M, ringCell[k])
    const A = s.albedo?.[k]
    return R * exposure * (A ? bilinear(A, u, v) : 1)
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
    while (top > 0) {
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
      let seen = false
      if (y < top || pY !== pY) {
        seen = true
        R = radiance(k, u, v, t, up, sa, ca)
        if (pY !== pY) {
          // the first step also stands for the ground between it and the feet
          pY = h
          pR = R
          pT = t
        } else if (pR !== pR) pR = radiance(pK, pU, pV, pT, pUp, sa, ca)
        const r0 = Math.max(0, Math.ceil(y))
        const span = pY - y
        for (let r = Math.min(top, h) - 1; r >= r0; r--) {
          const a = span > 1e-9 ? Math.min(1, Math.max(0, (r - y) / span)) : 0 // 0 at this step, 1 at the previous
          const ta = t + (pT - t) * a
          writePixel(px, 4 * (r * w + i), R + (pR - R) * a, ta, ta * sa, ta * ca, dTheta, lastMu, lastPhotoM, grain, 255)
        }
        // antialiased top edge: the row the ground only partly covers
        const edge = r0 - 1
        if (edge >= 0 && edge < top && y < r0) writePixel(px, 4 * (edge * w + i), R, t, e, n, dTheta, lastMu, lastPhotoM, grain, Math.round(255 * Math.min(1, r0 - y)))
        if (r0 < top) top = r0
      }
      pY = y
      pK = k
      pU = u
      pV = v
      pT = t
      pUp = up
      pR = R
      let stepM = Math.min(STEP_CELLS * ringCell[k], NEAR_GROWTH * t)
      // finer steps only while the ray sees ground with a finer photo (ground hidden behind a ridge needs none)
      if (seen && lastFine && stepM > DETAIL_STEP_M) stepM = Math.max(DETAIL_STEP_M, DETAIL_STEP_REL * t)
      t += Math.max(0.02, stepM)
      // nothing farther can show: even the highest ground in the rings would stay below the rows filled so far
      if ((steps & 7) === 0 && rows(Math.atan2(headroom - (t * t) / twoR, t) / D) >= top) {
        k = nR
        break
      }
    }
    // beyond the rings (or beyond what can show), up to the mask: the shade of the ground where the ray stopped
    if (top > maskTop && pY === pY) {
      const R = pR !== pR ? radiance(pK, pU, pV, pT, pUp, sa, ca) : pR
      for (let r = Math.min(top, h) - 1; r >= maskTop; r--) writePixel(px, 4 * (r * w + i), R, pT, 0, 0, dTheta, 1, RING_PHOTO_MIN_M, null, 255)
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
  mu: number,
  photoM: number,
  grain: GroundTexture | null,
  alpha: number,
): void {
  // partial edge pixels keep the higher alpha already written
  if (alpha < 255 && px[o + 3] >= alpha) return
  let b = TONE_LUT[R > 0 ? (R < TONE_MAX ? (R * TONE_STEPS) | 0 : TONE_MAX * TONE_STEPS) : 0]
  if (grain !== null) {
    // footprint of the pixel on the ground: t dTheta across the ray, t dTheta / mu along it (mu: emission cosine;
    // long on level ground seen at grazing, short on a slope facing the eye); their geometric mean
    const foot = t * dTheta * Math.sqrt(1 / Math.max(0.02, mu))
    const ratio = foot / photoM
    if (ratio < 1) {
      const weight = ratio <= 0.25 ? 1 : Math.log2(1 / ratio) / 2
      // two octaves of the patch around the footprint, blended: fixed to the ground, constant detail on screen
      const lf = Math.max(0, Math.log2(Math.max(1e-6, foot)) - LOG_GRAIN)
      const l0 = Math.floor(lf)
      const f = lf - l0
      const s0 = GRAIN_M * 2 ** l0
      const g0 = grainLevel(grain, 0, e / s0 + 311, n / s0 + 517)
      const g1 = grainLevel(grain, 0, e / (2 * s0) + 311, n / (2 * s0) + 517)
      b *= 1 + (g0 + (g1 - g0) * f - 1) * GRAIN_GAIN * weight
    }
  }
  // Uint8ClampedArray rounds and clamps
  px[o] = TINT_R * b
  px[o + 1] = TINT_G * b
  px[o + 2] = TINT_B * b
  px[o + 3] = alpha
}
