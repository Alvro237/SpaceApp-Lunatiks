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
 * over it as a thin line (drawRelief.ts). Where the mask stands above the drawn ground instead, the band up to it
 * takes the shade of the last ground the ray met only while the relief is incomplete (rings still to come, or the
 * eye still high above them, `fillToMask`) or the gap is a hair (MASK_GAP_DEG): once the ground is drawn to
 * FULL_REACH_M, a wider gap is left as the sky the heights say it is, with the mask's line across it.
 *
 * Far ground in view is read from the patches where there are any (patches.ts, light.ts GroundStack): the same
 * walk, with steps of the patch's finer cell there.
 *
 * Shading: radiance of a lunar-Lambert surface (McEwen 1991), R = (1 - L) mu0 + 2 L mu0 / (mu0 + mu), with mu0 the
 * cosine of the incidence times the visible share of the solar disc (light.ts) and mu the cosine of the emission
 * angle towards the eye. The limb-darkening weight L falls with the phase angle g (L = 1 - g / 150°, a linear
 * stand-in for the tabulated values). A fixed exposure maps R to the screen. Shadowed ground keeps a floor of
 * AMBIENT so that its shape still reads: the real shadows are darker than drawn. At night the ground facing the
 * Earth is lit by earthshine (the Earth as a second light with its own disc and shadows, light.ts
 * earthshineRatio), with the exposure raised as a camera would (the view says so).
 *
 * Albedo: this place's own photo multiplies the displayed brightness (after the tone curve, writePixel), as the photo views of the globe and of the polar
 * map drape the mosaic over the LOLA relief. Where a detail tile has been read (detailPhoto.ts: the far ground the
 * ray casting finds visible, at the mosaic's own 100 m) it is used, and the ray steps no longer than DETAIL_STEP_M
 * there so the photo's detail is not stepped over; elsewhere the photo read over each ring's cells (rings.ts). The
 * mosaic keeps the shadows it was photographed with; their floor (ALBEDO_MIN) leaves that ground to the light of
 * the chosen instant. Without a photo the ground is plain regolith (albedo 1).
 */
import { R_M } from '../../terrain/tileset'
import type { GroundTexture } from '../groundTexture'
import { BLOCK, type GroundStack, bilinear, lightFromHorizon, tileOf } from './light'
import { RING_N, ringHalf } from './rings'

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
  /** Regolith grain under the DEM's cell, near the feet only (groundTexture.ts), as before; null: none. */
  grain?: GroundTexture | null
  /**
   * Paint the band between the drawn ground and the mask whatever its height (see the file comment); default: only
   * while the rings do not reach FULL_REACH_M. Set during the arrival descent, where the eye is far above the rings.
   */
  fillToMask?: boolean
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
/**
 * The ground between two steps is drawn straight, which is off from the bilinear heights by an amount that grows
 * with the square of the step; seen from the eye that is an angle, and what matters is that angle against a pixel.
 * So NEAR_GROWTH holds for pixels up to NEAR_REF_DEG across (a full-resolution frame at the widest usual field) and
 * grows in proportion for coarser ones (the lighter frames drawn while the view moves), up to NEAR_GROWTH_MAX.
 */
const NEAR_REF_DEG = 0.0625
const NEAR_GROWTH_MAX = 0.16
const STEP_CELLS = 1
const FIRST_STEP_M = 0.3
/**
 * Ray steps over ground with a finer photo: no longer than DETAIL_STEP_M (about a Kaguya TC pixel) or
 * DETAIL_STEP_REL of the distance, whichever is longer (a step at 10 km already covers several pixels of the screen
 * along the ray at grazing incidence).
 */
export const DETAIL_STEP_M = 20
const DETAIL_STEP_REL = 0.004
/** Grain: metres per level-0 texel, and how strongly it modulates the albedo. */
const GRAIN_M = 0.04
const GRAIN_GAIN = 0.55
/**
 * The grain (the regolith texture of a WAC patch of another place, groundTexture.ts) is laid near the feet only and
 * fades out linearly to nothing at GRAIN_REACH_M: farther, only the real photo of the place shows (a patch repeated
 * at larger scales would draw the same craters again and again). Eye height used for its footprint, metres.
 */
const GRAIN_REACH_M = 200
const GRAIN_EYE_M = 1.7
const LOG_GRAIN = Math.log2(GRAIN_M)
/**
 * The rings count as the whole relief once the outermost reaches this far, metres; the band between the drawn ground
 * and a higher mask is then painted only up to MASK_GAP_DEG (file comment).
 */
export const FULL_REACH_M = 200_000
export const MASK_GAP_DEG = 0.08

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

/** Trilinear: the two mip levels around the pixel's footprint, each bilinear, blended; 1 (no grain) past the last. */
function grainAt(tex: GroundTexture, logFoot: number, u: number, v: number): number {
  const top = tex.levels.length - 1
  const l = Math.max(0, logFoot)
  if (l >= top) return 1
  const l0 = Math.floor(l)
  const f = l - l0
  const a = grainLevel(tex, l0, u, v)
  const b = l0 + 1 >= top ? 1 : grainLevel(tex, l0 + 1, u, v)
  return a + (b - a) * f
}

/**
 * Render into `out` (cleared to transparent): pixel (i, j) covers CSS x = (i + 0.5) scale, y = (j + 0.5) scale.
 * `horizonAt` is the mask's elevation (degrees) at an azimuth. Returns the number of ray steps taken.
 *
 * Columns are independent: `i0`..`i1` renders a slice of them (the image is cleared when the slice starts at column
 * 0), so a full-resolution image can be built over several frames (drawRelief.ts).
 */
export function renderRelief(
  out: ImageData,
  scale: number,
  c: ColumnCamera,
  horizonAt: (az: number) => number,
  s: ReliefScene,
  i0 = 0,
  i1 = out.width,
): number {
  const w = out.width
  const h = out.height
  const px = out.data
  if (i0 === 0) px.fill(0)
  const { stack } = s
  const rows = (el: number) => (c.cy - (el - c.pitch) / c.degPerPx) / scale - 0.5
  const f = stack.frame
  const nR = stack.rings.length
  const gridCell = stack.grids.map((r) => r.cellM / f.k0)
  const idx = stack.idx
  const heights = stack.grids.map((r) => r.heights)
  const size = stack.size
  const tiles = stack.tiles
  const blockMax = stack.blockMax
  const blocks = stack.blocks
  const blockO = stack.blockO
  const fillAll = s.fillToMask ?? ringHalf(stack.rings[nR - 1].cellM) < FULL_REACH_M
  const gapRows = MASK_GAP_DEG / (scale * c.degPerPx)
  const NM1 = RING_N - 1
  const CEN = NM1 / 2
  const S = s.sun
  const twoR = 2 * R_M
  const headroom = stack.maxU - s.eyeM
  // an eye above every height in the stack: the highest ground rises in the view out to its own horizon, at tStar.
  // Not during the arrival descent (fillToMask): there each frame stops at once and paints the band to the mask
  const tStar = headroom < 0 && !s.fillToMask ? Math.sqrt(-headroom * twoR) : 0
  let steps = 0
  const E = s.earth ?? [0, 0, 1]
  const earthRatio = s.earthRatio ?? 0
  const exposure = s.exposure ?? 1
  const detailAt = s.detailAt
  const grain = s.grain ?? null
  const dTheta = scale * c.degPerPx * D
  const nearGrowth = Math.min(NEAR_GROWTH_MAX, Math.max(NEAR_GROWTH, (NEAR_GROWTH * scale * c.degPerPx) / NEAR_REF_DEG))
  // set by albedoAt(): whether the last point read had a finer photo
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
  /** Bilinear normal of grid g at (u, v), normalised, into nrm. */
  const normalAt = (g: number, u: number, v: number) => {
    const N = s.normals[g]
    const m = size[g]
    const i0 = u < m - 1 ? Math.floor(u) : m - 2
    const j0 = v < m - 1 ? Math.floor(v) : m - 2
    const fu = u - i0
    const fv = v - j0
    const o = 3 * (j0 * m + i0)
    const o1 = o + 3
    const o2 = o + 3 * m
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
    if (!s.sunlight && !hasEarth) return 0
    normalAt(k, u, v)
    // towards the eye
    const il = 1 / Math.sqrt(t * t + up * up)
    const vx = -t * sa * il
    const vy = -t * ca * il
    const vz = -up * il
    const mu = Math.max(0, nrm[0] * vx + nrm[1] * vy + nrm[2] * vz)
    let R = 0
    if (s.sunlight) {
      const cosI = nrm[0] * S[0] + nrm[1] * S[1] + nrm[2] * S[2]
      if (cosI > 0) {
        const mu0 = cosI * lightFromHorizon(bilinear(s.sunlight[k], u, v, size[k]), rSun)
        if (mu0 > 0) R += lunarLambert(mu0, mu, S[0], S[1], S[2], vx, vy, vz)
      }
    }
    if (hasEarth) {
      const cosI = nrm[0] * E[0] + nrm[1] * E[1] + nrm[2] * E[2]
      if (cosI > 0) {
        const me = cosI * lightFromHorizon(bilinear(s.earthlight![k], u, v, size[k]), rEarth)
        if (me > 0) R += earthRatio * lunarLambert(me, mu, E[0], E[1], E[2], vx, vy, vz)
      }
    }
    return R * exposure
  }
  /**
   * Albedo of the ground at a point (east, north metres) in ring k: the finer photo where a tile covers it, else the
   * ring's photo, else 1. Read for every pixel at the point its line of sight meets, so the photo lies on the slope
   * as the heights put it (not stretched between two ray steps).
   */
  const albedoAt = (k: number, e: number, n: number): number => {
    if (detailAt) {
      const d = detailAt(e, n)
      if (d === d) {
        lastFine = true
        return d
      }
    }
    lastFine = false
    const A = s.albedo?.[k]
    if (!A) return 1
    const q = idx[k]
    const u = Math.min(NM1, Math.max(0, q.au * e + q.bu * n + CEN))
    const v = Math.min(NM1, Math.max(0, q.av * e + q.bv * n + CEN))
    return bilinear(A, u, v)
  }
  // tangent of each screen row's elevation angle (the inverse of rows())
  const tanRow = new Float64Array(h)
  // the same, as the test "is this ground under the rows filled so far?": ground at tangent up / t lies at or below
  // the centre of row r when up <= tanCut[r] t. Rows 90° or more from the level are never (or always) reached
  const tanCut = new Float64Array(h)
  for (let r = 0; r < h; r++) {
    const el = c.pitch + (c.cy - (r + 0.5) * scale) * c.degPerPx
    tanRow[r] = Math.tan(el * D)
    tanCut[r] = el >= 89.9 ? Infinity : el <= -89.9 ? -Infinity : tanRow[r]
  }
  for (let i = Math.max(0, i0); i < Math.min(w, i1); i++) {
    const az = c.yaw + ((i + 0.5) * scale - c.cx) * c.degPerPx
    const sa = Math.sin(az * D)
    const ca = Math.cos(az * D)
    const maskRow = Math.max(0, rows(horizonAt(((az % 360) + 360) % 360)))
    const maskTop = Math.ceil(maskRow)
    let top = h // rows >= top are filled
    let t = FIRST_STEP_M
    let k = 0
    let first = true
    // the previous step: grid sample (and its ring), distance and level; its screen row and its radiance only once
    // they are needed (most steps are hidden, or raise the ground by less than a row)
    let pY = 0
    let pYok = false
    let pK = 0
    let pG = 0
    let pU = 0
    let pV = 0
    let pT = 0
    let pUp = 0
    let pR = NaN
    // the antialiased top edge: the row the ground only partly covers, from the step that covers most of it. Drawn
    // once the column is done (every row filled later lies above it or over it)
    let eRow = -1
    let eAlpha = 0
    let eK = 0
    let eG = 0
    let eU = 0
    let eV = 0
    let eT = 0
    let eUp = 0
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
      // the patch over this tile of the ring, where there is one: finer heights of the same ground
      let g = k
      const T = tiles[k]
      if (T !== null) {
        const tile = tileOf(u, v)
        const p = tile < 0 ? -1 : T[tile]
        if (p >= 0) {
          const q = idx[p]
          g = p
          u = q.au * e + q.bu * n + q.cu
          v = q.av * e + q.bv * n + q.cv
        }
      }
      // bilinear height
      const H = heights[g]
      const m = size[g]
      const i0 = u < m - 1 ? Math.floor(u) : m - 2
      const j0 = v < m - 1 ? Math.floor(v) : m - 2
      const fu = u - i0
      const fv = v - j0
      const o = j0 * m + i0
      const hg = (H[o] * (1 - fu) + H[o + 1] * fu) * (1 - fv) + (H[o + m] * (1 - fu) + H[o + m + 1] * fu) * fv
      const drop = (t * t) / twoR
      const up = hg - drop - s.eyeM
      steps++
      let R = NaN
      let seen = false
      let y = 0
      let yOk = false
      // under the rows filled so far (by its tangent: no angle needed), unless nothing is filled yet
      if (first || top === h || up > tanCut[top] * t) {
        y = rows(Math.atan2(up, t) / D)
        yOk = true
        seen = first || y < top
      }
      if (seen) {
        if (first) {
          // the first step also stands for the ground between it and the feet
          first = false
          R = radiance(g, u, v, t, up, sa, ca)
          pY = h
          pYok = true
          pR = R
          pT = t
          pUp = up
        }
        const r0 = Math.max(0, Math.ceil(y))
        const rTop = Math.min(top, h) - 1
        if (rTop >= r0) {
          if (R !== R) R = radiance(g, u, v, t, up, sa, ca)
          if (pR !== pR) pR = radiance(pG, pU, pV, pT, pUp, sa, ca)
          if (!pYok) pY = rows(Math.atan2(pUp, pT) / D)
          const span = pY - y
          const dT = t - pT
          const dU = up - pUp
          for (let r = rTop; r >= r0; r--) {
            // where this row's line of sight meets the ground between the previous step and this one (the ground
            // taken as straight between them): a = 0 at this step, 1 at the previous; by rows if the segment is
            // degenerate
            let a = span > 1e-9 ? Math.min(1, Math.max(0, (r - y) / span)) : 0
            const tn = tanRow[r]
            const den = dU - tn * dT
            if (den > 1e-12 || den < -1e-12) {
              const f = (tn * pT - pUp) / den
              if (f >= 0 && f <= 1) a = 1 - f
            }
            const ta = t + (pT - t) * a
            const ea = ta * sa
            const na = ta * ca
            const alb = albedoAt(k, ea, na)
            writePixel(px, 4 * (r * w + i), R + (pR - R) * a, alb, ta, ea, na, dTheta, grain, 255)
          }
        }
        // the row above the filled ones, partly covered: kept if it covers more of it than the steps before did
        const edge = r0 - 1
        if (edge >= 0 && y < r0) {
          const alpha = Math.round(255 * Math.min(1, r0 - y))
          if (edge !== eRow || alpha > eAlpha) {
            eRow = edge
            eAlpha = alpha
            eK = k
            eG = g
            eU = u
            eV = v
            eT = t
            eUp = up
          }
        }
        if (r0 < top) top = r0
      }
      pY = y
      pYok = yOk
      pK = k
      pG = g
      pU = u
      pV = v
      pT = t
      pUp = up
      pR = R
      let stepM = Math.min(STEP_CELLS * gridCell[g], nearGrowth * t)
      // finer steps only while the ray sees ground with a finer photo (ground hidden behind a ridge needs none)
      if (seen && lastFine && stepM > DETAIL_STEP_M) stepM = Math.max(DETAIL_STEP_M, DETAIL_STEP_REL * t)
      if (!seen && top < h) {
        // hidden ground: if even the highest sample of this block (light.ts BLOCK) would stay under the rows filled
        // so far all the way across it, walk to just before the ray leaves the block in one step. Ground at height
        // H stands (H - eye) / t' - t' / 2R up (as a tangent) at distance t': highest at this end of the stretch, or
        // for H under the eye at its own horizon sqrt(2 R (eye - H)) if that falls inside the stretch
        const nb = blocks[g]
        const bo = blockO[g]
        const bi = Math.floor((u - bo) / BLOCK)
        const bj = Math.floor((v - bo) / BLOCK)
        if (bi >= 0 && bj >= 0 && bi < nb && bj < nb) {
          const q = idx[g]
          const du = q.au * sa + q.bu * ca
          const dv = q.av * sa + q.bv * ca
          const u0 = bo + BLOCK * bi
          const v0 = bo + BLOCK * bj
          const lim = m - 1
          // metres along the ray to the block's edge (kept inside the grid's own samples)
          const xu = du > 0 ? (Math.min(lim, u0 + BLOCK) - u) / du : du < 0 ? (Math.max(0, u0) - u) / du : Infinity
          const xv = dv > 0 ? (Math.min(lim, v0 + BLOCK) - v) / dv : dv < 0 ? (Math.max(0, v0) - v) / dv : Infinity
          const jump = Math.min(xu, xv) - 0.01 * gridCell[g]
          if (jump > stepM) {
            const dH = blockMax[g][bj * nb + bi] - s.eyeM
            let tb = t
            if (dH < 0) {
              const own = Math.sqrt(-dH * twoR)
              tb = own < t ? t : own > t + jump ? t + jump : own
            }
            if (dH - (tb * tb) / twoR <= tanCut[top] * tb) stepM = jump
          }
        }
      }
      t += Math.max(0.02, stepM)
      // nothing farther can show: even the highest ground in the rings would stay below the rows filled so far
      // (ground at that height stands highest in the view here, or at tStar while the ray has not reached it)
      if ((steps & 7) === 0) {
        const tb = t < tStar ? tStar : t
        const lift = headroom - (tb * tb) / twoR
        if (top < h ? lift <= tanCut[top] * tb : rows(Math.atan2(lift, tb) / D) >= top) {
          k = nR
          break
        }
      }
    }
    // beyond the rings (or beyond what can show), up to the mask: the shade of the ground where the ray stopped
    // (only a hair's gap once the relief is whole: file comment)
    if (top > maskTop && !first && (fillAll || top - maskRow <= gapRows)) {
      const R = pR !== pR ? radiance(pG, pU, pV, pT, pUp, sa, ca) : pR
      const alb = albedoAt(pK, pT * sa, pT * ca)
      for (let r = Math.min(top, h) - 1; r >= maskTop; r--) writePixel(px, 4 * (r * w + i), R, alb, pT, 0, 0, dTheta, null, 255)
    } else if (eRow >= 0 && eRow < top) {
      const ee = eT * sa
      const en = eT * ca
      writePixel(px, 4 * (eRow * w + i), radiance(eG, eU, eV, eT, eUp, sa, ca), albedoAt(eK, ee, en), eT, ee, en, dTheta, grain, eAlpha)
    }
  }
  return steps
}

/** tone() tabulated: TONE_STEPS entries per unit of radiance up to TONE_MAX (the curve is flat beyond). */
const TONE_MAX = 4
const TONE_STEPS = 512
const TONE_LUT = Float32Array.from({ length: TONE_MAX * TONE_STEPS + 2 }, (_, i) => tone(i / TONE_STEPS))

/**
 * One pixel: the light (radiance without the albedo) through the tone curve, then times the photo's albedo, as the
 * globe and the polar map multiply the photo by their light. Taken after the curve, the photo's contrast stays
 * visible on brightly lit slopes, where the curve is flat and an albedo inside the radiance would vanish.
 */
function writePixel(
  px: Uint8ClampedArray,
  o: number,
  R: number,
  albedo: number,
  t: number,
  e: number,
  n: number,
  dTheta: number,
  grain: GroundTexture | null,
  alpha: number,
): void {
  // partial edge pixels keep the higher alpha already written
  if (alpha < 255 && px[o + 3] >= alpha) return
  let b = TONE_LUT[R > 0 ? (R < TONE_MAX ? (R * TONE_STEPS) | 0 : TONE_MAX * TONE_STEPS) : 0] * albedo
  if (grain !== null && t < GRAIN_REACH_M) {
    // footprint of the pixel on the ground: t dTheta across the ray, about t^2 dTheta / h along it at grazing
    // incidence (h: eye height); their geometric mean picks the mip level, so far grain blurs out instead of aliasing
    const foot = t * dTheta * Math.sqrt(Math.max(1, t / GRAIN_EYE_M))
    const g = grainAt(grain, Math.log2(Math.max(1e-6, foot)) - LOG_GRAIN, e / GRAIN_M + 311, n / GRAIN_M + 517)
    b *= 1 + (g - 1) * GRAIN_GAIN * (1 - t / GRAIN_REACH_M)
  }
  // Uint8ClampedArray rounds and clamps
  px[o] = TINT_R * b
  px[o + 1] = TINT_G * b
  px[o + 2] = TINT_B * b
  px[o + 3] = alpha
}
