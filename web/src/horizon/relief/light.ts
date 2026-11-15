/**
 * Sunlight on the rings (rings.ts) at one instant: for every sample, the share of the solar disc above its own
 * terrain horizon towards the Sun (cast shadows, with the penumbra of the 0.53° disc) times the cosine of the
 * incidence angle on the local slope. Pure functions over arrays: the horizon view runs them in a worker
 * (light.worker.ts) and the tests run them directly.
 *
 * Frame: the observer's east-north-up frame, metres. A sample at horizontal offset (e, n) with height h above the
 * sphere sits at u = h - (e^2 + n^2) / (2 R) on the observer's level (rings.ts, curvatureDrop): the drop of the
 * curved ground is kept, so slopes far away tilt with the Moon's curvature (3° at 100 km) and a far ridge hides
 * less. The Sun is a fixed direction S (it is 150 million km away), the same for every sample.
 *
 * Shadows: from each sample a ray is marched towards the Sun's azimuth over the finest ring that holds each step,
 * with steps growing geometrically from 0.7 of the sample's cell (STEP_GROWTH), keeping the largest elevation
 * angle of the terrain over the sample's own level plane (the sphere falls s^2 / 2R below it at distance s), and
 * compared with the Sun's elevation over that same plane. The visible share of the disc is the circular-segment area
 * above that horizon line (the convention of the engine: "sunlit" is any part of the disc above the horizon). A ray
 * that leaves the outermost ring meets no more terrain.
 */
import { R_M } from '../../terrain/tileset'
import { RING_N, type PlaneFrame } from './rings'

export interface RingGrid {
  cellM: number
  heights: Float32Array
}

/** Linear map from (e, n) to a ring's fractional sample indices: u = au e + bu n + c, v = av e + bv n + c. */
export interface RingIndex {
  au: number
  bu: number
  av: number
  bv: number
}

const C = (RING_N - 1) / 2

export function ringIndex(f: PlaneFrame, cellM: number): RingIndex {
  // x - x0 = k (e E0 + n N0), u = (x - x0) / cell + C; y0 - y = -k (e E1 + n N1), v = (y0 - y) / cell + C
  const s = f.k0 / cellM
  return { au: s * f.E[0], bu: s * f.N[0], av: -s * f.E[1], bv: -s * f.N[1] }
}

/** Share of a disc of angular radius r above a straight horizon at elevation a, for a centre at elevation el. */
export function discFractionAbove(el: number, a: number, r: number): number {
  const x = (el - a) / r
  if (x >= 1) return 1
  if (x <= -1) return 0
  return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI
}

/**
 * Ground stack: every ring with its index map, finest first, and the level u of the curved ground at any (e, n).
 * Returns NaN outside the outermost ring.
 */
export class GroundStack {
  readonly idx: RingIndex[]
  /** Highest terrain level in the stack (an upper bound of u anywhere), metres. */
  readonly maxU: number

  readonly rings: RingGrid[]
  readonly frame: PlaneFrame

  constructor(rings: RingGrid[], frame: PlaneFrame) {
    this.rings = rings
    this.frame = frame
    this.idx = rings.map((r) => ringIndex(frame, r.cellM))
    let m = -Infinity
    for (const r of rings) for (let i = 0; i < r.heights.length; i++) if (r.heights[i] > m) m = r.heights[i]
    this.maxU = m
  }

  /** Finest ring holding (e, n) with its fractional indices, or -1. Written into `out` to avoid allocations. */
  locate(e: number, n: number, out: Float64Array, from = 0): number {
    for (let k = from; k < this.rings.length; k++) {
      const q = this.idx[k]
      const u = q.au * e + q.bu * n + C
      const v = q.av * e + q.bv * n + C
      if (u >= 0 && v >= 0 && u <= RING_N - 1 && v <= RING_N - 1) {
        out[0] = u
        out[1] = v
        return k
      }
    }
    return -1
  }

  /** Bilinear height above the sphere in ring k at fractional indices (u, v). */
  heightAt(k: number, u: number, v: number): number {
    return bilinear(this.rings[k].heights, u, v)
  }

  /** Level of the curved ground at (e, n) in the observer's frame, or NaN outside the stack. */
  level(e: number, n: number, tmp: Float64Array): number {
    const k = this.locate(e, n, tmp)
    if (k < 0) return NaN
    return this.heightAt(k, tmp[0], tmp[1]) - (e * e + n * n) / (2 * R_M)
  }
}

export function bilinear(a: ArrayLike<number>, u: number, v: number): number {
  const n = RING_N
  const i = Math.min(n - 2, Math.floor(u))
  const j = Math.min(n - 2, Math.floor(v))
  const fu = u - i
  const fv = v - j
  const o = j * n + i
  return (a[o] * (1 - fu) + a[o + 1] * fu) * (1 - fv) + (a[o + n] * (1 - fu) + a[o + n + 1] * fu) * fv
}

/** East, north and up of a ring sample's position in the observer's frame (the inverse of ringIndex). */
export function sampleEnu(f: PlaneFrame, cellM: number, i: number, j: number): [number, number] {
  const px = (i - C) * cellM
  const py = -(j - C) * cellM
  return [(px * f.E[0] + py * f.E[1]) / f.k0, (px * f.N[0] + py * f.N[1]) / f.k0]
}

/**
 * Unit normals of a ring's ground in the observer's frame (3 floats per sample: east, north, up), from central
 * differences of the heights and the curvature drop's own slope (-e / R, -n / R).
 */
export function ringNormals(ring: RingGrid, f: PlaneFrame): Float32Array {
  const n = RING_N
  const H = ring.heights
  const out = new Float32Array(3 * n * n)
  const g = 2 * ring.cellM // plane metres between the two neighbours
  for (let j = 0; j < n; j++) {
    const jm = Math.max(0, j - 1)
    const jp = Math.min(n - 1, j + 1)
    for (let i = 0; i < n; i++) {
      const im = Math.max(0, i - 1)
      const ip = Math.min(n - 1, i + 1)
      const gx = (H[j * n + ip] - H[j * n + im]) / (g * ((ip - im) / 2)) // dh per plane metre along +x
      const gy = -(H[jp * n + i] - H[jm * n + i]) / (g * ((jp - jm) / 2)) // along +y (rows grow downwards)
      const [e, no] = sampleEnu(f, ring.cellM, i, j)
      const de = f.k0 * (f.E[0] * gx + f.E[1] * gy) - e / R_M
      const dn = f.k0 * (f.N[0] * gx + f.N[1] * gy) - no / R_M
      const inv = 1 / Math.sqrt(de * de + dn * dn + 1)
      const o = 3 * (j * n + i)
      out[o] = -de * inv
      out[o + 1] = -dn * inv
      out[o + 2] = inv
    }
  }
  return out
}

/** Sun as seen by the observer: azimuth and elevation in degrees, angular radius in degrees. */
export interface SunDir {
  az: number
  el: number
  radiusDeg: number
}

/** Geometric growth of the shadow-ray steps. */
export const STEP_GROWTH = 1.09
/** Longest shadow-ray step, in cells of the ring it crosses. */
export const STEP_CELLS = 3
/** The same for the quick first pass. */
export const QUICK_STEP_GROWTH = 1.25
export const QUICK_STEP_CELLS = 8

/** Range kept of the horizon's height over the light, degrees: beyond it the disc is wholly up or wholly hidden. */
export const HORIZON_CLAMP_DEG = 10

/**
 * For every sample of every ring: how far the terrain horizon towards the light rises above the light's centre,
 * degrees (positive: the centre is hidden), clamped to ±HORIZON_CLAMP_DEG; +HORIZON_CLAMP_DEG where the slope faces
 * away from the light. This angle is continuous across a shadow's edge, so the renderer interpolates it between
 * samples and turns it into the visible share of the disc per pixel (lightFromHorizon): the edge of a shadow then
 * falls between samples where the geometry puts it, instead of following the cells.
 * Samples of a ring that lie inside the next finer ring are not computed (0): the finer ring answers there.
 * `rowOffset` and `rowStride` share the work between workers: only rows j with j % rowStride === rowOffset are
 * computed (the others stay 0), so several workers each take every rowStride-th row and the results are merged.
 */
export function ringLightHorizon(
  stack: GroundStack,
  normals: Float32Array[],
  sun: SunDir,
  rowOffset = 0,
  rowStride = 1,
  quick = false,
): Float32Array[] {
  // the quick pass (shown first, while the full one runs) takes longer steps: about four times faster
  const growth = quick ? QUICK_STEP_GROWTH : STEP_GROWTH
  const capCells = quick ? QUICK_STEP_CELLS : STEP_CELLS
  const f = stack.frame
  const D = Math.PI / 180
  const ce = Math.cos(sun.el * D)
  const S = [Math.sin(sun.az * D) * ce, Math.cos(sun.az * D) * ce, Math.sin(sun.el * D)]
  const hx = Math.sin(sun.az * D)
  const hy = Math.cos(sun.az * D)
  const r = sun.radiusDeg
  const n = RING_N
  // longest step in each ring: a few of its cells, so a ridge between steps is not missed by much
  const cap = stack.rings.map((g) => (capCells * g.cellM) / f.k0)
  const idx = stack.idx
  const hs = stack.rings.map((g) => g.heights)
  const nR = stack.rings.length
  const NM1 = n - 1
  const inv2R = 1 / (2 * R_M)
  // the inner ring covers indices C ± (C / RING_RATIO) of the next one: skip those
  return stack.rings.map((ring, k) => {
    const out = new Float32Array(n * n)
    const N = normals[k]
    const inner = k > 0 ? stack.rings[k - 1].cellM / ring.cellM : 0
    const lo = C - (C + 0.5) * inner + 1
    const hi = C + (C + 0.5) * inner - 1
    const step0 = 0.7 * ring.cellM / f.k0
    for (let j = rowOffset; j < n; j += rowStride) {
      const skipRow = k > 0 && j > lo && j < hi
      for (let i = 0; i < n; i++) {
        if (skipRow && i > lo && i < hi) continue
        const o = j * n + i
        const cosI = N[3 * o] * S[0] + N[3 * o + 1] * S[1] + N[3 * o + 2] * S[2]
        if (cosI <= -0.02 || sun.el < -r - 5) {
          out[o] = HORIZON_CLAMP_DEG
          continue
        }
        const [e, no] = sampleEnu(f, ring.cellM, i, j)
        // the Sun's elevation over this sample's own level (its vertical leans by e / R, n / R)
        const iu = 1 / Math.sqrt(1 + (e * e + no * no) / (R_M * R_M))
        const elP = Math.asin(Math.min(1, Math.max(-1, (S[0] * e / R_M + S[1] * no / R_M + S[2]) * iu))) / D
        // lowest edge of the disc: once the ray to it passes above every height, nothing can hide any of the disc
        const tanLow = Math.tan(Math.max(-89, Math.min(89, elP - r)) * D)
        const hP = ring.heights[o] + 0.05
        const room = stack.maxU - hP
        // once the terrain hides the disc's upper edge the sample is in full shadow: no need to look farther
        const tanTop = Math.tan(Math.max(-89, Math.min(89, elP + r)) * D)
        let maxTan = -Infinity
        let s = step0
        let ds = step0
        for (let it = 0; it < 400; it++) {
          // the ray to the disc's lower edge rises s tan, the ground falls away s^2 / 2R: nothing beyond can block
          const fall = (s * s) * inv2R
          if (s * tanLow + fall > room) break
          const qe = e + s * hx
          const qn = no + s * hy
          // finest ring holding the step (inlined GroundStack.locate + bilinear: this loop is the hot path)
          let k2 = 0
          let u = 0
          let v = 0
          for (; k2 < nR; k2++) {
            const q = idx[k2]
            u = q.au * qe + q.bu * qn + C
            v = q.av * qe + q.bv * qn + C
            if (u >= 0 && v >= 0 && u <= NM1 && v <= NM1) break
          }
          if (k2 >= nR) break
          const H = hs[k2]
          const i0 = u < NM1 ? u | 0 : NM1 - 1
          const j0 = v < NM1 ? v | 0 : NM1 - 1
          const fu = u - i0
          const fv = v - j0
          const q0 = j0 * n + i0
          const hT = (H[q0] * (1 - fu) + H[q0 + 1] * fu) * (1 - fv) + (H[q0 + n] * (1 - fu) + H[q0 + n + 1] * fu) * fv
          const t = (hT - hP - fall) / s
          if (t > maxTan) {
            maxTan = t
            if (t >= tanTop) break
          }
          ds = Math.min(ds * growth, cap[k2])
          s += ds
        }
        const a = maxTan === -Infinity ? -90 : Math.atan(maxTan) / D
        out[o] = Math.max(-HORIZON_CLAMP_DEG, Math.min(HORIZON_CLAMP_DEG, a - elP))
      }
    }
    return out
  })
}

/** Visible share of a disc of angular radius r whose centre lies `rel` degrees below the horizon (ringLightHorizon). */
export const lightFromHorizon = (rel: number, r: number) => discFractionAbove(0, rel, r)

/** Earth's Bond albedo (Stephens et al. 2015, CERES: 0.29) and mean radius, km. */
export const EARTH_BOND_ALBEDO = 0.29
export const EARTH_RADIUS_KM = 6371

/**
 * Earthshine on the Moon as a fraction of the direct sunlight there: the Earth as a Lambert sphere of Bond albedo A
 * and radius r at distance d, seen at phase angle alpha (Sun-Earth-observer), gives
 *   E_earth / E_sun = A (2/3) (r / d)^2 [sin(alpha) + (pi - alpha) cos(alpha)] / pi
 * (Lambert-sphere phase law; Russell 1916, ApJ 43, 173). At full Earth (alpha = 0) and 384 400 km this is
 * 5.3e-5, about 1/19 000 of sunlight. The real Earth is not Lambertian (clouds, oceans): an estimate within tens of
 * percent, used only for the brightness of the night ground in the horizon view.
 */
export function earthshineRatio(phaseAngleDeg: number, distKm: number): number {
  const a = (Math.min(180, Math.max(0, phaseAngleDeg)) * Math.PI) / 180
  const q = EARTH_RADIUS_KM / distKm
  return EARTH_BOND_ALBEDO * (2 / 3) * q * q * ((Math.sin(a) + (Math.PI - a) * Math.cos(a)) / Math.PI)
}

/**
 * Phase angle of the Earth seen from the Moon (Sun-Earth-observer), degrees, from the directions of the Sun and the
 * Earth in the observer's sky: the Sun being at infinity, it is 180° minus their angular separation.
 */
export function earthPhaseAngle(sun: { az: number; el: number }, earth: { az: number; el: number }): number {
  const D = Math.PI / 180
  const u = (b: { az: number; el: number }) => [Math.cos(b.el * D) * Math.sin(b.az * D), Math.cos(b.el * D) * Math.cos(b.az * D), Math.sin(b.el * D)]
  const s = u(sun)
  const e = u(earth)
  const c = Math.max(-1, Math.min(1, s[0] * e[0] + s[1] * e[1] + s[2] * e[2]))
  return 180 - Math.acos(c) / D
}
