/**
 * Landscape painter of the first-person horizon view (docs/horizon-view-plan.md, Layer A): the terrain as layers at
 * known distances instead of one grey fill. Pure functions over typed arrays (no canvas, no DOM): `renderLandscape`
 * fills an RGBA buffer, `paintLandscape` puts that buffer on the canvas.
 *
 * What is drawn, and why it is justified:
 *  - Layers. The API gives, at each azimuth, up to three visible crests (the nearest two below the skyline and the
 *    skyline) with their distances and elevations (logic/horizon.py `ridge_planes`). The skyline itself is the site's
 *    mask, always: a nearer layer is clipped to it, so nothing is ever painted above the skyline the metrics use.
 *  - Light. Airless, so no haze and no sky glow: a surface is lit by the Sun by the cosine of the angle between its
 *    normal and the Sun, and by the Earth (a faint blue-white floor). The normal of a visible face is built from two
 *    slopes: the ridge line's own slope across the view (known) and an assumed tilt along the view (FACE_SLOPE_DEG at
 *    the crest, easing to BASE_SLOPE_DEG at the foot; the foreground is the plane from the observer's feet to the
 *    nearest crest). Sun behind a ridge: its visible face is dark; Sun behind the viewer: bright.
 *  - Earthshine. Irradiance of the full Earth relative to the Sun at normal incidence: A·θ²·k, with Earth's Bond
 *    albedo A = 0.306 (NASA Earth Fact Sheet), θ the Earth's angular radius, k the lit fraction of its disc.
 *  - Exposure. A surface facing the Sun squarely is drawn at DISPLAY_WHITE; the rest follows a display gamma of 2
 *    (a square root: close to sRGB's 2.2 and several times cheaper per pixel).
 *    A small FLOOR keeps shadow from being the same black as the sky (presentation choice).
 *  - Texture. Regolith grain in world coordinates (east, north of the observer on the ground plane), band-limited:
 *    an octave of features smaller than a couple of pixels is dropped, one far larger than the screen is dropped, so
 *    the grain is large and rough near the feet and fine and faint far away, with correct perspective.
 *  - Not drawn: shadows cast on the visible ground by the surrounding relief, rocks, craters smaller than the grid.
 */
import { type Camera, earthPhase, wrap360 } from './project'

const DEG = Math.PI / 180

/** The observer's height above the ground, m (fixed for every MECH result: panels sit on structures). */
export const GROUND_HEIGHT_M = 2
/** Assumed tilt along the view of a visible ridge face at its crest, degrees (plan A2). */
export const FACE_SLOPE_DEG = 20
/** Tilt of the ground at the foot of a face, degrees (presentation choice). */
export const BASE_SLOPE_DEG = 6
/** Bond albedo of the Earth, NASA Earth Fact Sheet. */
export const EARTH_BOND_ALBEDO = 0.306
/** Display luminance of a surface facing the Sun squarely (automatic exposure). */
export const DISPLAY_WHITE = 0.9
/** Display luminance kept for shadow, so the ground reads against the black sky (presentation choice). */
export const SHADOW_FLOOR = 0.03
/** Depth assumed for a skyline without a distance (smooth Moon, no terrain data), m. */
export const FALLBACK_DEPTH_M = 20_000
const SUN_RGB = [1, 0.975, 0.93] as const
const EARTH_RGB = [0.72, 0.87, 1] as const
/** Shadow keeps a faint cool tint (the Earth's colour) so it reads as dark ground, not as the black sky. */
const FLOOR_RGB = EARTH_RGB.map((e) => SHADOW_FLOOR * (0.8 + 0.2 * e))

export interface LightBody {
  az: number
  el: number
  fraction: number
  radiusDeg: number
}

/** The layers of the landscape near to far, the skyline last: crest elevation (deg) and distance (m) per azimuth. */
export interface LandscapePlanes {
  azStepDeg: number
  el: Float32Array[]
  dist: Float32Array[]
}

interface ApiPlanes {
  planes: { distance_km: (number | null)[]; elevation_deg: (number | null)[] }[]
  skylineDistanceKm: (number | null)[] | null
  azStepDeg: number
}

/** A crest seen over fewer azimuth samples than this is dropped (a spike of the grid, not a ridge). Presentation choice. */
export const MIN_RUN_SAMPLES = 3
/** Azimuth samples over which a crest that ends merges into the layer behind it (a shoulder, not a cliff). Presentation choice. */
export const TAPER_SAMPLES = 6

/**
 * API layers to typed arrays ready to draw. The skyline's distance replaces the last layer's. Each nearer layer is
 * completed far to near: where it has no crest it takes the layer behind it (so it adds nothing there), and where a
 * crest ends it merges into the layer behind over TAPER_SAMPLES instead of stopping at a vertical edge. A layer is
 * never above or beyond the one behind it. Azimuths with no terrain data at all stay NaN.
 */
export function planesFromApi(d: ApiPlanes | null): LandscapePlanes | null {
  if (!d || d.planes.length === 0) return null
  const arr = (v: (number | null)[]) => Float32Array.from(v, (x) => (x == null ? NaN : x))
  const el = d.planes.map((p) => arr(p.elevation_deg))
  const dist = d.planes.map((p) => arr(p.distance_km).map((x) => x * 1000))
  const n = el.length
  if (d.skylineDistanceKm) dist[n - 1] = arr(d.skylineDistanceKm).map((x) => x * 1000)
  const m = el[n - 1].length
  for (let q = n - 2; q >= 0; q--) {
    const e = el[q]
    const dd = dist[q]
    const backEl = el[q + 1]
    const backD = dist[q + 1]
    const has = new Uint8Array(m)
    for (let i = 0; i < m; i++) has[i] = Number.isFinite(e[i]) && dd[i] > 0 ? 1 : 0
    dropShortRuns(has, MIN_RUN_SAMPLES)
    // nearest sample with a crest, and how far it is, around the ring
    const near = new Int32Array(m).fill(-1)
    const gap = new Float32Array(m).fill(Infinity)
    for (const dir of [1, -1]) {
      let last = -1
      let lastK = 0
      for (let k = 0; k < 2 * m; k++) {
        const i = dir === 1 ? k % m : (((m - 1 - k) % m) + m) % m
        if (has[i]) {
          last = i
          lastK = k
          gap[i] = 0
          near[i] = i
        } else if (last >= 0 && k - lastK < gap[i]) {
          gap[i] = k - lastK
          near[i] = last
        }
      }
    }
    const outEl = new Float32Array(m)
    const outD = new Float32Array(m)
    for (let i = 0; i < m; i++) {
      const be = backEl[i]
      const bd = backD[i]
      if (!Number.isFinite(be) || !(bd > 0)) {
        outEl[i] = has[i] ? e[i] : NaN
        outD[i] = has[i] ? dd[i] : NaN
        continue
      }
      const j = near[i]
      if (j < 0 || gap[i] > TAPER_SAMPLES) {
        outEl[i] = be
        outD[i] = bd
        continue
      }
      const t = 1 - gap[i] / (TAPER_SAMPLES + 1)
      const w = t * t * (3 - 2 * t)
      outEl[i] = be + (Math.min(e[j], be) - be) * w
      outD[i] = bd + (Math.min(dd[j], bd) - bd) * w
    }
    el[q] = outEl
    dist[q] = outD
  }
  return { azStepDeg: d.azStepDeg, el, dist }
}

/** Clears the runs of 1s shorter than `min` in a ring of flags (a run may wrap around the end). */
export function dropShortRuns(has: Uint8Array, min: number): void {
  const m = has.length
  let start = 0
  while (start < m && has[start]) start++
  if (start === m) return // all set
  // walk the ring from a cleared sample, so no run is split by the array's end
  let run = 0
  for (let k = 1; k <= m; k++) {
    const i = (start + k) % m
    if (has[i]) run++
    else {
      if (run > 0 && run < min) for (let r = 1; r <= run; r++) has[(i - r + m) % m] = 0
      run = 0
    }
  }
}

/** Value at an azimuth of a ring of samples (linear between them, wrapping at 360); NaN when its neighbours are NaN. */
export function sampleRing(a: ArrayLike<number>, stepDeg: number, az: number): number {
  const n = a.length
  const x = (((az / stepDeg) % n) + n) % n
  const i = Math.floor(x)
  const f = x - i
  const p = a[i]
  const q = a[(i + 1) % n]
  if (Number.isFinite(p) && Number.isFinite(q)) return p + (q - p) * f
  if (Number.isFinite(p) && f < 0.5) return p
  if (Number.isFinite(q) && f >= 0.5) return q
  return NaN
}

// ------------------------------------------------------------------------------------------------- light

/** Per-azimuth light terms: Sun and Earth directions in the frame of one view direction, and their weights. */
export interface Light {
  sx: number
  sy: number
  sz: number
  sun: number
  ex: number
  ey: number
  ez: number
  earth: number
}

/**
 * Light at the azimuth `az` (degrees): direction vectors in the frame x = right, y = away from the viewer, z = up,
 * so a face looking back at the viewer has a normal with y < 0. `sun` is the visible share of the solar disc;
 * `earth` is the Earthshine irradiance relative to the Sun at normal incidence (A θ² k, times the visible share).
 */
export function lightAt(az: number, sun: LightBody, earth: LightBody, earthLit: number): Light {
  const ds = (sun.az - az) * DEG
  const de = (earth.az - az) * DEG
  const cs = Math.cos(sun.el * DEG)
  const ce = Math.cos(earth.el * DEG)
  const theta = earth.radiusDeg * DEG
  return {
    sx: cs * Math.sin(ds),
    sy: cs * Math.cos(ds),
    sz: Math.sin(sun.el * DEG),
    sun: sun.fraction,
    ex: ce * Math.sin(de),
    ey: ce * Math.cos(de),
    ez: Math.sin(earth.el * DEG),
    earth: earth.fraction * EARTH_BOND_ALBEDO * theta * theta * earthLit,
  }
}

/**
 * Light reaching a surface whose normal tilts back towards the viewer by atan(tanA) and sideways by atan(tanB)
 * (tanB > 0: the surface rises to the right): the Sun's and the Earth's terms, relative to the Sun at normal
 * incidence. Cosines clamp at 0 (a face turned away is dark).
 */
export function faceLight(l: Light, tanA: number, tanB: number, out: Float64Array | number[] = [0, 0]): Float64Array | number[] {
  const den = 1 / Math.sqrt(1 + tanA * tanA + tanB * tanB)
  const s = (-tanB * l.sx - tanA * l.sy + l.sz) * den
  const e = (-tanB * l.ex - tanA * l.ey + l.ez) * den
  out[0] = s > 0 ? s * l.sun : 0
  out[1] = e > 0 ? e * l.earth : 0
  return out
}

/** Display colour (0..1 per channel) from the two light terms and a texture factor. */
export function toDisplay(sunTerm: number, earthTerm: number, texture: number, out: Float64Array | number[]): void {
  // unrolled over the three channels (this runs once per pixel)
  const s = sunTerm * texture
  const e = earthTerm * texture
  const r = DISPLAY_WHITE * Math.sqrt(s * SUN_RGB[0] + e * EARTH_RGB[0])
  const g = DISPLAY_WHITE * Math.sqrt(s * SUN_RGB[1] + e * EARTH_RGB[1])
  const b = DISPLAY_WHITE * Math.sqrt(s * SUN_RGB[2] + e * EARTH_RGB[2])
  out[0] = r > FLOOR_RGB[0] ? r : FLOOR_RGB[0]
  out[1] = g > FLOOR_RGB[1] ? g : FLOOR_RGB[1]
  out[2] = b > FLOOR_RGB[2] ? b : FLOOR_RGB[2]
}

// ------------------------------------------------------------------------------------------------- texture

const TILE = 256
const LATTICE = 16
/** Smooth periodic noise, features 16 texels wide, values in [-1, 1]. Deterministic. */
const TILE_DATA: Float32Array = (() => {
  let seed = 0x9e3779b9
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const lat = Float32Array.from({ length: LATTICE * LATTICE }, () => rnd() * 2 - 1)
  const t = new Float32Array(TILE * TILE)
  const s = TILE / LATTICE
  const fade = (f: number) => f * f * f * (f * (f * 6 - 15) + 10)
  for (let y = 0; y < TILE; y++) {
    const gy = y / s
    const iy = Math.floor(gy)
    const fy = fade(gy - iy)
    for (let x = 0; x < TILE; x++) {
      const gx = x / s
      const ix = Math.floor(gx)
      const fx = fade(gx - ix)
      const a = lat[(iy % LATTICE) * LATTICE + (ix % LATTICE)]
      const b = lat[(iy % LATTICE) * LATTICE + ((ix + 1) % LATTICE)]
      const c = lat[((iy + 1) % LATTICE) * LATTICE + (ix % LATTICE)]
      const d = lat[((iy + 1) % LATTICE) * LATTICE + ((ix + 1) % LATTICE)]
      t[y * TILE + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
    }
  }
  return t
})()

/** Added to texel coordinates so the integer parts are positive (and below 2^31) before truncating. */
const TEXEL_OFFSET = 1 << 24

function tile(u: number, v: number): number {
  u += TEXEL_OFFSET
  v += TEXEL_OFFSET
  const iu = u | 0
  const iv = v | 0
  const fu = u - iu
  const fv = v - iv
  const x0 = iu & (TILE - 1)
  const y0 = iv & (TILE - 1)
  const x1 = (x0 + 1) & (TILE - 1)
  const y1 = (y0 + 1) & (TILE - 1)
  const a = TILE_DATA[(y0 << 8) | x0]
  const b = TILE_DATA[(y0 << 8) | x1]
  const c = TILE_DATA[(y1 << 8) | x0]
  const d = TILE_DATA[(y1 << 8) | x1]
  return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv
}

/** Feature sizes of the grain octaves, m (each four times the last). */
const OCTAVE_M = [0.25, 1, 4, 16, 64, 256]
const OCTAVE_LOG2 = OCTAVE_M.map((m) => Math.log2(m))
const OCT_COS = [1, 0.8, 0.28, -0.6, 0.97, -0.42]
const OCT_SIN = [0, 0.6, 0.96, 0.8, 0.26, 0.91]
/** How strongly the grain modulates the light (presentation choice). */
const GRAIN = 0.3
const smooth = (x: number, a: number, b: number) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a)
  return t * t * (3 - 2 * t)
}
// log2 of a positive number from its float32 bits (piecewise-linear between powers of two, error under 0.09): the
// grain only needs the octave of a size, and Math.log2 once per pixel is a large share of the frame
const F32 = new Float32Array(1)
const U32 = new Uint32Array(F32.buffer)
const fastLog2 = (x: number): number => {
  F32[0] = x
  return U32[0] * 1.1920928955078125e-7 - 127
}
const LG_MIN0 = Math.log2(2.5)
const LG_MIN1 = Math.log2(6)
const LG_MAX0 = Math.log2(70)
const LG_MAX1 = Math.log2(260)

// weight of each octave against log2 of the size of one pixel on the ground, tabulated (resolution 1/8 of an octave)
const LG_LO = -16
const LG_HI = 12
const LG_STEPS = 8
const WEIGHT_LUT = OCTAVE_LOG2.map((l2) => {
  const a = new Float32Array((LG_HI - LG_LO) * LG_STEPS + 1)
  for (let i = 0; i < a.length; i++) {
    const lg = l2 - (LG_LO + i / LG_STEPS)
    a[i] = smooth(lg, LG_MIN0, LG_MIN1) * (1 - smooth(lg, LG_MAX0, LG_MAX1))
  }
  return a
})

/**
 * Grain at a ground point, as a factor around 1. `east`, `north` in metres from the observer; `lgPx` = log2 of the
 * size of one buffer pixel on the ground at that depth, so an octave of size F spans log2(F) - lgPx pixels (log2).
 */
export function grain(east: number, north: number, lgPx: number): number {
  const idx = Math.max(0, Math.min((LG_HI - LG_LO) * LG_STEPS, Math.round((lgPx - LG_LO) * LG_STEPS)))
  let sum = 0
  for (let o = 0; o < OCTAVE_M.length; o++) {
    const w = WEIGHT_LUT[o][idx]
    if (w <= 0) continue
    const k = LATTICE / OCTAVE_M[o]
    const u = (east * OCT_COS[o] - north * OCT_SIN[o]) * k + o * 97.3
    const v = (east * OCT_SIN[o] + north * OCT_COS[o]) * k + o * 41.7
    sum += w * tile(u, v)
  }
  const f = 1 + GRAIN * sum
  return f < 0.3 ? 0.3 : f > 1.9 ? 1.9 : f
}

// ------------------------------------------------------------------------------------------------- the painter

export interface LandscapeScene {
  camera: Camera
  /** Skyline elevation at an azimuth (the site's mask): always the last layer. */
  skyline: (az: number) => number
  planes: LandscapePlanes | null
  /** Applied to every layer's elevation (the descent pulls the relief down to the smooth Moon's horizon). */
  shape?: (el: number) => number
  sun: LightBody
  earth: LightBody
  /** Observer's height above the ground, m. */
  heightM?: number
  /**
   * Over the 3D ground view (Layer B): how much of the painted landscape stays. 1 (or undefined): all of it; 0: only
   * the ground at the observer's feet, opaque up to NEAR_FULL_M and gone by NEAR_END_M, where the tiles' cells are
   * far larger than a pixel; between, a cross-fade (the tiles arriving).
   */
  fullness?: number
}

/** The painted foreground covers the 3D tiles up to here, then fades out, metres from the observer (plan, risks). */
export const NEAR_FULL_M = 120
export const NEAR_END_M = 300

const TAN_FACE = Math.tan(FACE_SLOPE_DEG * DEG)
const TAN_BASE = Math.tan(BASE_SLOPE_DEG * DEG)
const MAX_FOREGROUND_TILT = Math.tan(35 * DEG)

/**
 * Paints the terrain layers into `buf` (RGBA, w × h, straight alpha, transparent above the skyline). `scale` is
 * buffer pixels per CSS pixel (the camera is in CSS pixels). Layers are painted far to near; the layer a pixel shows
 * is the nearest whose crest is above it. Edges are antialiased by coverage.
 */
export function renderLandscape(buf: Uint8ClampedArray, w: number, h: number, scale: number, scene: LandscapeScene): void {
  const { camera: c, planes } = scene
  const shape = scene.shape ?? ((e: number) => e)
  const hCam = scene.heightM ?? GROUND_HEIGHT_M
  const fullness = Math.min(1, Math.max(0, scene.fullness ?? 1))
  const n = planes ? planes.el.length : 1
  const earthLit = earthPhase(scene.sun, scene.earth).lit
  const stackEl = new Float64Array(n)
  const stackD = new Float64Array(n)

  /** Layer elevations and distances at an azimuth, far to near with fill-forward from the skyline. */
  const stack = (az: number) => {
    stackEl[n - 1] = scene.skyline(az)
    stackD[n - 1] = planes ? sampleRing(planes.dist[n - 1], planes.azStepDeg, az) : NaN
    if (!(stackD[n - 1] > 0)) stackD[n - 1] = FALLBACK_DEPTH_M
    for (let q = n - 2; q >= 0 && planes; q--) {
      const r = sampleRing(planes.el[q], planes.azStepDeg, az)
      const d = sampleRing(planes.dist[q], planes.azStepDeg, az)
      if (Number.isFinite(r) && d > 0) {
        stackEl[q] = Math.min(shape(r), stackEl[q + 1])
        stackD[q] = Math.min(d, stackD[q + 1])
      } else {
        stackEl[q] = stackEl[q + 1]
        stackD[q] = stackD[q + 1]
      }
    }
  }

  // per column
  const top: Float32Array[] = Array.from({ length: n }, () => new Float32Array(w))
  const zc: Float32Array[] = Array.from({ length: n }, () => new Float32Array(w))
  const tanB: Float32Array[] = Array.from({ length: n }, () => new Float32Array(w))
  const tanE0 = new Float32Array(w)
  const rawE0 = new Float32Array(w)
  const sinAz = new Float32Array(w)
  const cosAz = new Float32Array(w)
  const lights: Light[] = new Array(w)
  const hi = new Float64Array(n)
  const lo = new Float64Array(n)
  let yMin = h
  for (let i = 0; i < w; i++) {
    const az = wrap360(c.yaw + ((i + 0.5) / scale - c.cx) * c.degPerPx)
    stack(az)
    for (let q = 0; q < n; q++) {
      top[q][i] = (c.cy - (stackEl[q] - c.pitch) / c.degPerPx) * scale
      zc[q][i] = stackD[q]
    }
    rawE0[i] = Math.max(0, Math.min(35, stackEl[0]))
    // lateral slope of each crest line: its elevation change per degree of azimuth over 3 degrees
    stack(az + 1.5)
    for (let q = 0; q < n; q++) hi[q] = stackEl[q]
    stack(az - 1.5)
    for (let q = 0; q < n; q++) lo[q] = stackEl[q]
    for (let q = 0; q < n; q++) tanB[q][i] = Math.max(-1, Math.min(1, (hi[q] - lo[q]) / 3))
    sinAz[i] = Math.sin(az * DEG)
    cosAz[i] = Math.cos(az * DEG)
    lights[i] = lightAt(az, scene.sun, scene.earth, earthLit)
    yMin = Math.min(yMin, Math.floor(top[n - 1][i]))
  }
  yMin = Math.max(0, yMin)
  buf.fill(0, 0, yMin * w * 4)
  // The foreground is the plane from the observer's feet to the nearest crest: its tilt is the crest's elevation
  // averaged over about 4 degrees of azimuth, so one narrow spike does not tilt the whole ground below it.
  const half = Math.max(1, Math.min(w >> 2, Math.round(4 / ((c.degPerPx / scale) || 1))))
  const prefix = new Float64Array(w + 1)
  for (let i = 0; i < w; i++) prefix[i + 1] = prefix[i] + rawE0[i]
  for (let i = 0; i < w; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(w, i + half + 1)
    tanE0[i] = Math.tan(((prefix[b] - prefix[a]) / (b - a)) * DEG)
  }

  // Colour at the two ends of each layer's band (its crest and its foot, or for the foreground the crest's lateral
  // slope and none), per column, in display space before the grain; a pixel interpolates between them.
  const colTop: Float32Array[] = Array.from({ length: n }, () => new Float32Array(w * 3))
  const colBot: Float32Array[] = Array.from({ length: n }, () => new Float32Array(w * 3))
  const lt = [0, 0]
  const rgb = [0, 0, 0]
  for (let i = 0; i < w; i++) {
    const tanA0 = tanE0[i] > 0 ? Math.min(tanE0[i], MAX_FOREGROUND_TILT) : 0
    for (let j = 0; j < n; j++) {
      faceLight(lights[i], j === 0 ? tanA0 : TAN_FACE, tanB[j][i], lt)
      toDisplay(lt[0], lt[1], 1, rgb)
      colTop[j][i * 3] = rgb[0]
      colTop[j][i * 3 + 1] = rgb[1]
      colTop[j][i * 3 + 2] = rgb[2]
      faceLight(lights[i], j === 0 ? tanA0 : TAN_BASE, 0, lt)
      toDisplay(lt[0], lt[1], 1, rgb)
      colBot[j][i * 3] = rgb[0]
      colBot[j][i * 3 + 1] = rgb[1]
      colBot[j][i * 3 + 2] = rgb[2]
    }
  }

  const radPerPx = (c.degPerPx / scale) * DEG
  const lgRad = Math.log2(radPerPx)
  const gcache = new Float32Array((w >> 1) + 2).fill(1)   // sqrt(grain), on every other pixel each way
  let rowTan = 0
  let r = 0
  let g = 0
  let b = 0

  /** Colour of layer `j` at buffer pixel (x, y) into r, g, b (0..1). */
  const colorAt = (j: number, x: number, y: number) => {
    const yc = y + 0.5
    const tj = top[j][x]
    let t: number
    if (j === 0) {
      // the crest line's own lateral slope matters near the crest and fades towards the feet
      const dy = (yc - tj) / scale / 60
      t = (dy * dy) / (1 + dy * dy)
    } else {
      const span = top[j - 1][x] - tj
      t = span > 1 ? (yc - tj) / span : 1
      if (t > 1) t = 1
      else if (t < 0) t = 0
    }
    // the grain is band-limited to features of 2.5 pixels or more, so it is evaluated on every other pixel each way
    if (((x | y) & 1) === 0) {
      let z: number
      if (j === 0) {
        const denom = tanE0[x] - rowTan
        z = denom > 1e-6 ? hCam / denom : zc[0][x]
        if (z > zc[0][x]) z = zc[0][x]
      } else {
        const zFar = zc[j][x]
        const zNear = Math.min(zc[j - 1][x], zFar)
        z = zFar + (zNear - zFar) * t
      }
      const zz = z > 0.3 ? z : 0.3
      gcache[x >> 1] = Math.sqrt(grain(zz * sinAz[x], zz * cosAz[x], fastLog2(zz) + lgRad))
    }
    const gs = gcache[x >> 1]
    const a = colTop[j]
    const bb = colBot[j]
    const o3 = x * 3
    r = (a[o3] + (bb[o3] - a[o3]) * t) * gs
    g = (a[o3 + 1] + (bb[o3 + 1] - a[o3 + 1]) * t) * gs
    b = (a[o3 + 2] + (bb[o3 + 2] - a[o3 + 2]) * t) * gs
    if (r < FLOOR_RGB[0]) r = FLOOR_RGB[0]
    if (g < FLOOR_RGB[1]) g = FLOOR_RGB[1]
    if (b < FLOOR_RGB[2]) b = FLOOR_RGB[2]
  }

  for (let y = yMin; y < h; y++) {
    rowTan = Math.tan((c.pitch - ((y + 0.5) / scale - c.cy) * c.degPerPx) * DEG)
    for (let x = 0; x < w; x++) {
      let j = -1
      let cov = 0
      for (let q = 0; q < n; q++) {
        cov = y + 1 - top[q][x]
        if (cov > 0) {
          j = q
          break
        }
      }
      const o = (y * w + x) * 4
      if (j < 0) {
        buf[o + 3] = 0
        continue
      }
      colorAt(j, x, y)
      let alpha = 255
      if (fullness < 1) {
        let near = 0
        if (j === 0) {
          const denom = tanE0[x] - rowTan
          const z = denom > 1e-6 ? Math.min(hCam / denom, zc[0][x]) : zc[0][x]
          const t = z <= NEAR_FULL_M ? 0 : z >= NEAR_END_M ? 1 : (z - NEAR_FULL_M) / (NEAR_END_M - NEAR_FULL_M)
          near = 1 - t * t * (3 - 2 * t)
        }
        alpha = 255 * (near + (1 - near) * fullness)
      }
      if (cov < 1) {
        if (j < n - 1) {
          const r1 = r
          const g1 = g
          const b1 = b
          colorAt(j + 1, x, y)
          r = r1 * cov + r * (1 - cov)
          g = g1 * cov + g * (1 - cov)
          b = b1 * cov + b * (1 - cov)
        } else alpha = Math.round(cov * alpha)
      }
      buf[o] = r * 255
      buf[o + 1] = g * 255
      buf[o + 2] = b * 255
      buf[o + 3] = alpha
    }
  }
}

/** Buffer pixels per CSS pixel: full size up to about 260 000 buffer pixels, then smaller (the browser smooths it back up). */
export function bufferScale(w: number, h: number, targetPixels = 260_000): number {
  return Math.max(0.3, Math.min(1, Math.sqrt(targetPixels / Math.max(1, w * h))))
}

/** Pixel budget of the buffer, adapted to this machine: a frame over the budget in time shrinks it, a fast one grows it. */
let pixelBudget = 260_000
const FRAME_MS_MAX = 20
const FRAME_MS_MIN = 9
export const nextBudget = (budget: number, frameMs: number): number =>
  frameMs > FRAME_MS_MAX ? Math.max(90_000, budget * 0.8) : frameMs < FRAME_MS_MIN ? Math.min(520_000, budget * 1.1) : budget

let scratch: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; data: ImageData } | null = null

/** Renders the landscape and draws it over what is already on `ctx` (CSS-pixel coordinates). */
export function paintLandscape(ctx: CanvasRenderingContext2D, W: number, H: number, scene: LandscapeScene): void {
  const scale = bufferScale(W, H, pixelBudget)
  const w = Math.max(1, Math.round(W * scale))
  const h = Math.max(1, Math.round(H * scale))
  if (!scratch || scratch.canvas.width !== w || scratch.canvas.height !== h) {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const sctx = canvas.getContext('2d')
    if (!sctx) return
    scratch = { canvas, ctx: sctx, data: sctx.createImageData(w, h) }
  }
  const t0 = performance.now()
  renderLandscape(scratch.data.data, w, h, w / W, scene)
  pixelBudget = nextBudget(pixelBudget, performance.now() - t0)
  scratch.ctx.putImageData(scratch.data, 0, 0)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(scratch.canvas, 0, 0, W, H)
  ctx.restore()
}
