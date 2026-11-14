/**
 * Sun and Earth over a site's horizon, in the browser.
 *
 * A line-by-line port of the API's validated engine (api/app/logic: ephemeris.py, geometry.py, horizon.py,
 * visibility.py, engine.py) so that playback can move the Sun every frame without calling the server. The
 * API stays the source of truth for the numbers on screen when it answers; this port is what animates them
 * and what fills the panels when an endpoint is not deployed yet. web/src/time/engine.test.ts checks it
 * against the same JPL Horizons fixture as the API (api/tests/fixtures/horizons_reference.json, 0.01°).
 *
 * Conventions (CLAUDE.md): frame MOON_ME, sphere 1737.4 km, azimuth clockwise from north, degrees,
 * Unix milliseconds. The Sun and the Earth are discs; the site position is always subtracted.
 */

export const MOON_R_KM = 1737.4
export const SUN_R_KM = 695_700.0
export const EARTH_R_KM = 6378.137
export const AU_KM = 149_597_870.7
export const SOLAR_CONSTANT_W_M2 = 1361.0
export const MS_PER_HOUR = 3_600_000
export const MS_PER_DAY = 86_400_000
const DEG = Math.PI / 180

// ------------------------------------------------------------------------------------------------ ephemeris

export interface EphemerisSegmentMeta {
  id: string
  file: string
  startUnixMs: number
  stepSeconds: number
  count: number
}

export interface Segment {
  id: string
  startMs: number
  stepS: number
  /** count × 6 float32: Sun xyz, Earth xyz, km from the Moon centre, MOON_ME. */
  data: Float32Array
}

export class OutOfCoverage extends Error {
  constructor(tMs: number) {
    super(`time ${new Date(tMs).toISOString()} is outside the ephemeris tables`)
    this.name = 'OutOfCoverage'
  }
}

export class EphemerisTable {
  readonly segments: Segment[]

  constructor(segments: Segment[]) {
    for (const s of segments) {
      if (s.data.length % 6 !== 0 || s.data.length < 24) throw new Error(`ephemeris segment ${s.id}: bad length`)
    }
    this.segments = segments
  }

  static count(s: Segment): number {
    return s.data.length / 6
  }

  static endMs(s: Segment): number {
    return s.startMs + (EphemerisTable.count(s) - 1) * s.stepS * 1000
  }

  coverage(): [number, number][] {
    return this.segments.map((s) => [s.startMs, EphemerisTable.endMs(s)])
  }

  covers(tMs: number): boolean {
    return this.segments.some((s) => s.startMs <= tMs && tMs <= EphemerisTable.endMs(s))
  }

  /** Sun and Earth vectors at one time, km: [sx, sy, sz, ex, ey, ez]. 4-point cubic Lagrange, as the API. */
  positions(tMs: number, out: Float64Array = new Float64Array(6)): Float64Array {
    for (const seg of this.segments) {
      const n = EphemerisTable.count(seg)
      if (tMs < seg.startMs || tMs > EphemerisTable.endMs(seg)) continue
      const u = (tMs - seg.startMs) / (seg.stepS * 1000)
      const s0 = Math.min(Math.max(Math.floor(u) - 1, 0), n - 4)
      const f = u - (s0 + 1)
      const w0 = (-f * (f - 1) * (f - 2)) / 6
      const w1 = ((f + 1) * (f - 1) * (f - 2)) / 2
      const w2 = (-(f + 1) * f * (f - 2)) / 2
      const w3 = ((f + 1) * f * (f - 1)) / 6
      const d = seg.data
      const b = s0 * 6
      for (let k = 0; k < 6; k++) {
        out[k] = w0 * d[b + k] + w1 * d[b + 6 + k] + w2 * d[b + 12 + k] + w3 * d[b + 18 + k]
      }
      return out
    }
    throw new OutOfCoverage(tMs)
  }
}

// ------------------------------------------------------------------------------------------------ geometry

export interface SiteFrame {
  pos: [number, number, number]
  east: [number, number, number]
  north: [number, number, number]
  up: [number, number, number]
}

/** Local frame on the 1737.4 km sphere; height in km above it. */
export function siteFrame(latDeg: number, lonDeg: number, heightKm = 0): SiteFrame {
  const lat = latDeg * DEG
  const lon = lonDeg * DEG
  const cl = Math.cos(lat)
  const sl = Math.sin(lat)
  const co = Math.cos(lon)
  const so = Math.sin(lon)
  const up: [number, number, number] = [cl * co, cl * so, sl]
  const r = MOON_R_KM + heightKm
  return { pos: [r * up[0], r * up[1], r * up[2]], east: [-so, co, 0], north: [-sl * co, -sl * so, cl], up }
}

export interface Direction {
  az: number
  el: number
  distKm: number
  unit: [number, number, number]
}

/** Direction from the site to a body given its Moon-centre vector (subtracts the site position). */
export function bodyDirection(x: number, y: number, z: number, f: SiteFrame): Direction {
  const dx = x - f.pos[0]
  const dy = y - f.pos[1]
  const dz = z - f.pos[2]
  const dist = Math.hypot(dx, dy, dz)
  const u: [number, number, number] = [dx / dist, dy / dist, dz / dist]
  const e = u[0] * f.east[0] + u[1] * f.east[1] + u[2] * f.east[2]
  const n = u[0] * f.north[0] + u[1] * f.north[1] + u[2] * f.north[2]
  const v = u[0] * f.up[0] + u[1] * f.up[1] + u[2] * f.up[2]
  const el = Math.asin(Math.min(1, Math.max(-1, v))) / DEG
  let az = Math.atan2(e, n) / DEG
  az = ((az % 360) + 360) % 360
  return { az, el, distKm: dist, unit: u }
}

export const angularRadiusDeg = (radiusKm: number, distKm: number) => Math.asin(radiusKm / distKm) / DEG
export const solarIrradiance = (sunDistKm: number) => SOLAR_CONSTANT_W_M2 * (AU_KM / sunDistKm) ** 2

function separationDeg(a: number[], b: number[]): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const cx = a[1] * b[2] - a[2] * b[1]
  const cy = a[2] * b[0] - a[0] * b[2]
  const cz = a[0] * b[1] - a[1] * b[0]
  return Math.atan2(Math.hypot(cx, cy, cz), dot) / DEG
}

// ------------------------------------------------------------------------------------------------ horizon

export type HorizonKind = 'terrain' | 'smooth_sphere'

export class Horizon {
  readonly values: Float64Array
  readonly kind: HorizonKind
  readonly azStep: number
  readonly min: number
  readonly max: number

  constructor(values: ArrayLike<number>, kind: HorizonKind) {
    this.values = Float64Array.from(values)
    this.kind = kind
    this.azStep = 360 / this.values.length
    let lo = Infinity
    let hi = -Infinity
    for (const v of this.values) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    this.min = lo
    this.max = hi
  }

  get isFlat(): boolean {
    return this.max - this.min < 1e-9
  }

  /** Linear interpolation in azimuth, wrapping at 360°. */
  at(azDeg: number): number {
    const n = this.values.length
    const x = (((azDeg / this.azStep) % n) + n) % n
    const i = Math.floor(x)
    const f = x - i
    const a = this.values[i % n]
    const b = this.values[(i + 1) % n]
    return a + (b - a) * f
  }
}

/** Geometric dip of the horizon over the smooth sphere, degrees (≤ 0). */
export function sphericalHorizonDeg(mastM: number, groundM = 0): number {
  const ro = MOON_R_KM * 1000 + groundM + mastM
  return -Math.acos(Math.min(1, (MOON_R_KM * 1000) / ro)) / DEG
}

export const flatHorizon = (deg: number, n = 720) => new Horizon(new Array(n).fill(deg), 'smooth_sphere')

// ------------------------------------------------------------------------------------------------ visibility

/** Disc above a straight horizon; d = centre elevation − horizon elevation, r = disc radius. */
export function flatFraction(d: number, r: number): number {
  const x = Math.min(1, Math.max(-1, -d / r))
  return (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI
}

/** Fraction (0..1) of a disc of radius r centred at (az, el) above the horizon; 7 vertical slices. */
export function discVisibleFraction(el: number, az: number, r: number, h: Horizon, slices = 7): number {
  if (h.isFlat) return flatFraction(el - h.max, r)
  if (el - r >= h.max) return 1
  if (el + r <= h.min) return 0
  const cosEl = Math.max(0.05, Math.cos(el * DEG))
  const width = (2 * r) / slices
  let visible = 0
  for (let k = 0; k < slices; k++) {
    const x = -r + (k + 0.5) * width
    const half = Math.sqrt(Math.max(0, r * r - x * x))
    const hz = h.at(az + x / cosEl)
    visible += width * Math.max(0, el + half - Math.max(el - half, hz))
  }
  return Math.min(1, visible / (Math.PI * r * r))
}

// ------------------------------------------------------------------------------------------------ engine

export type PanelModel = 'tracking' | 'vertical' | 'horizontal'

export interface AnalysisParams {
  panel: PanelModel
  /** Share of the Earth's disc that must be above the horizon for direct communication. */
  commsMinFraction: number
}

/** Same defaults as the API's AnalysisParams. */
export const DEFAULT_PARAMS: AnalysisParams = { panel: 'vertical', commsMinFraction: 0.5 }

export interface SiteModel {
  lat: number
  lon: number
  groundM: number
  mastM: number
  horizon: Horizon
  frame: SiteFrame
}

export function makeModel(lat: number, lon: number, groundM: number, horizon: Horizon, mastM: number): SiteModel {
  return { lat, lon, groundM, mastM, horizon, frame: siteFrame(lat, lon, groundM / 1000) }
}

export function panelFactor(panel: PanelModel, sunElDeg: number): number {
  if (panel === 'tracking') return 1
  if (panel === 'vertical') return Math.cos(sunElDeg * DEG)
  return Math.max(0, Math.sin(sunElDeg * DEG))
}

export interface BodySample {
  az: number
  el: number
  fraction: number
  radiusDeg: number
  distKm: number
}

export interface Sample {
  tMs: number
  sun: BodySample
  earth: BodySample
  /** 0 none, 1 partial, 2 total: the Earth covering the Sun. */
  eclipse: 0 | 1 | 2
  irradiance: number
  power: number
}

const scratch = new Float64Array(6)

export function evaluateAt(eph: EphemerisTable, m: SiteModel, tMs: number, p: AnalysisParams = DEFAULT_PARAMS): Sample {
  const v = eph.positions(tMs, scratch)
  const sun = bodyDirection(v[0], v[1], v[2], m.frame)
  const earth = bodyDirection(v[3], v[4], v[5], m.frame)
  const sr = angularRadiusDeg(SUN_R_KM, sun.distKm)
  const er = angularRadiusDeg(EARTH_R_KM, earth.distKm)
  const sunFrac = discVisibleFraction(sun.el, sun.az, sr, m.horizon)
  const earthFrac = discVisibleFraction(earth.el, earth.az, er, m.horizon)
  const sep = separationDeg(sun.unit, earth.unit)
  const eclipse = sep < er - sr ? 2 : sep < er + sr ? 1 : 0
  const irradiance = solarIrradiance(sun.distKm)
  return {
    tMs,
    sun: { az: sun.az, el: sun.el, fraction: sunFrac, radiusDeg: sr, distKm: sun.distKm },
    earth: { az: earth.az, el: earth.el, fraction: earthFrac, radiusDeg: er, distKm: earth.distKm },
    eclipse,
    irradiance,
    power: irradiance * sunFrac * panelFactor(p.panel, sun.el),
  }
}

/** Evenly spaced times covering durationH, both ends included (api: engine.time_grid). */
export function timeGrid(startMs: number, durationH: number, stepMin: number): number[] {
  const step = stepMin * 60_000
  const n = Math.floor((durationH * MS_PER_HOUR) / step) + 1
  return Array.from({ length: n }, (_, i) => startMs + i * step)
}

export const isSunlit = (s: Sample) => s.sun.fraction > 0
export const hasComms = (s: Sample, p: AnalysisParams) => s.earth.fraction >= p.commsMinFraction

/** Time ranges [start, end] where flags are true, at the grid resolution (api: visibility_ranges). */
export function visibilityRanges(t: number[], flags: boolean[]): [number, number][] {
  const out: [number, number][] = []
  let start = -1
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] && start < 0) start = i
    if (!flags[i] && start >= 0) {
      out.push([t[start], t[i - 1]])
      start = -1
    }
  }
  if (start >= 0) out.push([t[start], t[flags.length - 1]])
  return out
}

/** Longest run of flags === target, in samples (api: longest_run). */
export function longestRun(flags: boolean[], target: boolean): number {
  let best = 0
  let cur = 0
  for (const f of flags) {
    cur = f === target ? cur + 1 : 0
    if (cur > best) best = cur
  }
  return best
}

export interface Metrics {
  windowHours: number
  sunlightPct: number
  commsPct: number
  bothPct: number
  longestDarkH: number
  longestBlackoutH: number
  meanPowerWm2: number
  continuousLight: boolean
  continuousComms: boolean
  minSunElDeg: number
  maxSunElDeg: number
}

/** Same definitions as api: engine.compute_metrics. */
export function computeMetrics(samples: Sample[], p: AnalysisParams = DEFAULT_PARAMS): Metrics {
  const n = samples.length
  const stepH = n > 1 ? (samples[1].tMs - samples[0].tMs) / MS_PER_HOUR : 0
  const sunlit = samples.map(isSunlit)
  const comms = samples.map((s) => hasComms(s, p))
  const mean = (a: boolean[]) => a.filter(Boolean).length / Math.max(1, a.length)
  return {
    windowHours: (n - 1) * stepH,
    sunlightPct: 100 * mean(sunlit),
    commsPct: 100 * mean(comms),
    bothPct: 100 * mean(sunlit.map((s, i) => s && comms[i])),
    longestDarkH: longestRun(sunlit, false) * stepH,
    longestBlackoutH: longestRun(comms, false) * stepH,
    meanPowerWm2: samples.reduce((a, s) => a + s.power, 0) / Math.max(1, n),
    continuousLight: sunlit.every(Boolean),
    continuousComms: comms.every(Boolean),
    minSunElDeg: Math.min(...samples.map((s) => s.sun.el)),
    maxSunElDeg: Math.max(...samples.map((s) => s.sun.el)),
  }
}

export interface Transition {
  kind: 'set' | 'rise'
  atMs: number
  inMs: number
}

/**
 * Next change of visibility of the Sun (any part of the disc) or the Earth (≥ commsMinFraction of the disc):
 * 10-minute scan, then bisection to one second (api: engine.next_transition). Null when nothing changes within
 * searchDays or the tables end first.
 */
export function nextTransition(
  eph: EphemerisTable,
  m: SiteModel,
  fromMs: number,
  body: 'sun' | 'earth',
  p: AnalysisParams = DEFAULT_PARAMS,
  searchDays = 45,
  coarseMs = 600_000,
): Transition | null {
  const seg = eph.coverage().find(([a, b]) => a <= fromMs && fromMs <= b)
  if (!seg) return null
  const end = Math.min(fromMs + searchDays * MS_PER_DAY, seg[1])
  const visible = (t: number) => {
    const s = evaluateAt(eph, m, t, p)
    return body === 'sun' ? isSunlit(s) : hasComms(s, p)
  }
  const v0 = visible(fromMs)
  let prev = fromMs
  for (let t = fromMs + coarseMs; t <= end + 1; t += coarseMs) {
    if (visible(t) !== v0) {
      let lo = prev
      let hi = t
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2
        if (visible(mid) === v0) lo = mid
        else hi = mid
      }
      return { kind: v0 ? 'set' : 'rise', atMs: hi, inMs: hi - fromMs }
    }
    prev = t
  }
  return null
}
