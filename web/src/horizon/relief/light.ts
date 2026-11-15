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
import { RING_N, RING_RATIO, type PlaneFrame } from './rings'

export interface RingGrid {
  cellM: number
  heights: Float32Array
}

/**
 * A patch: finer heights over one tile of a ring, for far ground the eye can see (patches.ts). A ring is cut into
 * PATCH_TILES x PATCH_TILES tiles of PATCH_TILE cells; the patch of tile (tc, tr) (column from the west, row from the
 * north) holds that tile at a cell RING_RATIO times finer, on the lattice the next finer ring would have there, with
 * PATCH_PAD more samples on every side so that neighbouring patches share samples and no seam shows between them.
 */
export interface PatchGrid extends RingGrid {
  /** Cell of the ring it refines, metres (the patch's own cell is that over RING_RATIO). */
  parentCellM: number
  tc: number
  tr: number
}

/** Ring cells across a patch tile, tiles across a ring, apron samples, and samples across a patch. */
export const PATCH_TILE = 64
export const PATCH_TILES = RING_N / PATCH_TILE
export const PATCH_PAD = 2
export const PATCH_N = PATCH_TILE * RING_RATIO + 2 * PATCH_PAD

/**
 * Linear map from (e, n) to a grid's fractional sample indices: u = au e + bu n + cu, v = av e + bv n + cv.
 * (cu, cv) is where the observer falls in the grid: its centre for a ring, outside it for a patch.
 */
export interface RingIndex {
  au: number
  bu: number
  av: number
  bv: number
  cu: number
  cv: number
}

const C = (RING_N - 1) / 2
/** Ring indices between which the next finer ring has samples: the tiles around it take over just outside. */
const INNER_LO = C - C / RING_RATIO
const INNER_HI = C + C / RING_RATIO
const MID_LO = PATCH_TILES / 2 - 1
const MID_HI = PATCH_TILES / 2

export function ringIndex(f: PlaneFrame, cellM: number, cu = C, cv = C): RingIndex {
  // x - x0 = k (e E0 + n N0), u = (x - x0) / cell + C; y0 - y = -k (e E1 + n N1), v = (y0 - y) / cell + C
  const s = f.k0 / cellM
  return { au: s * f.E[0], bu: s * f.N[0], av: -s * f.E[1], bv: -s * f.N[1], cu, cv }
}

/**
 * Where the observer falls in the patch of tile t (column or row), in patch samples. The tile starts half a ring
 * cell before ring sample PATCH_TILE t, and patch sample PATCH_PAD sits half a patch cell inside it, so a ring index
 * u is patch index RING_RATIO (u - PATCH_TILE t + 1/2) - 1/2 + PATCH_PAD.
 */
export const patchOrigin = (t: number) => RING_RATIO * (C - PATCH_TILE * t + 0.5) - 0.5 + PATCH_PAD

/**
 * Tile of a ring holding the ring indices (u, v): row PATCH_TILES + column, or -1 on the four middle tiles, which
 * the next finer ring covers. The sliver between that ring's last samples and the middle tiles' edge (an eighth of a
 * cell) belongs to the tiles around, whose apron reaches it.
 */
export function tileOf(u: number, v: number): number {
  let tc = (u + 0.5) >> 6
  let tr = (v + 0.5) >> 6
  if ((tc === MID_LO || tc === MID_HI) && (tr === MID_LO || tr === MID_HI)) {
    if (u < INNER_LO) tc = MID_LO - 1
    else if (u > INNER_HI) tc = MID_HI + 1
    if (v < INNER_LO) tr = MID_LO - 1
    else if (v > INNER_HI) tr = MID_HI + 1
    if ((tc === MID_LO || tc === MID_HI) && (tr === MID_LO || tr === MID_HI)) return -1
  }
  return tr * PATCH_TILES + tc
}

/** Share of a disc of angular radius r above a straight horizon at elevation a, for a centre at elevation el. */
export function discFractionAbove(el: number, a: number, r: number): number {
  const x = (el - a) / r
  if (x >= 1) return 1
  if (x <= -1) return 0
  return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI
}

/**
 * Ground stack: every ring with its index map, finest first, then the patches that refine tiles of those rings, and
 * the level u of the curved ground at any (e, n). Returns NaN outside the outermost ring.
 *
 * `grids` is the rings followed by the patches; `idx`, `size` and `cell` are per grid. `tiles[k]` (rings with
 * patches only) gives, per tile of ring k, the grid index of its patch or -1.
 */
export class GroundStack {
  readonly idx: RingIndex[]
  /** Highest terrain level in the stack (an upper bound of u anywhere), metres. */
  readonly maxU: number

  readonly rings: RingGrid[]
  readonly patches: PatchGrid[]
  readonly grids: RingGrid[]
  /** Samples across each grid, and its cell in metres. */
  readonly size: number[]
  readonly cell: number[]
  readonly tiles: (Int16Array | null)[]
  readonly frame: PlaneFrame

  constructor(rings: RingGrid[], frame: PlaneFrame, patches: PatchGrid[] = []) {
    this.rings = rings
    this.frame = frame
    // a patch whose ring is not in the stack has nothing to refine
    this.patches = patches.filter((p) => rings.some((r) => r.cellM === p.parentCellM))
    this.grids = [...rings, ...this.patches]
    this.size = this.grids.map((_, g) => (g < rings.length ? RING_N : PATCH_N))
    this.cell = this.grids.map((g) => g.cellM)
    this.idx = rings.map((r) => ringIndex(frame, r.cellM))
    this.tiles = rings.map(() => null)
    this.patches.forEach((p, i) => {
      const k = rings.findIndex((r) => r.cellM === p.parentCellM)
      this.idx.push(ringIndex(frame, p.cellM, patchOrigin(p.tc), patchOrigin(p.tr)))
      const t = (this.tiles[k] ??= new Int16Array(PATCH_TILES * PATCH_TILES).fill(-1))
      t[p.tr * PATCH_TILES + p.tc] = rings.length + i
    })
    let m = -Infinity
    for (const r of this.grids) for (let i = 0; i < r.heights.length; i++) if (r.heights[i] > m) m = r.heights[i]
    this.maxU = m
  }

  /** Grid index of the patch over ring k's indices (u, v), or -1. */
  patchAt(k: number, u: number, v: number): number {
    const T = this.tiles[k]
    if (T === null) return -1
    const t = tileOf(u, v)
    return t < 0 ? -1 : T[t]
  }

  /**
   * Finest grid holding (e, n): the patch where one covers the point, else the ring, or -1. Writes the grid's
   * fractional indices into out[0..1] and the ring's index into out[2] (`out` needs three entries).
   */
  locateFine(e: number, n: number, out: Float64Array, from = 0): number {
    const k = this.locate(e, n, out, from)
    if (k < 0) return -1
    const p = this.patchAt(k, out[0], out[1])
    out[2] = k
    if (p < 0) return k
    const q = this.idx[p]
    out[0] = q.au * e + q.bu * n + q.cu
    out[1] = q.av * e + q.bv * n + q.cv
    return p
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

  /** Bilinear height above the sphere in grid g (a ring or a patch) at fractional indices (u, v). */
  heightAt(g: number, u: number, v: number): number {
    return bilinear(this.grids[g].heights, u, v, this.size[g])
  }

  /** Level of the curved ground at (e, n) in the observer's frame, or NaN outside the stack. */
  level(e: number, n: number, tmp: Float64Array): number {
    const g = this.locateFine(e, n, tmp)
    if (g < 0) return NaN
    return this.heightAt(g, tmp[0], tmp[1]) - (e * e + n * n) / (2 * R_M)
  }
}

/** Bilinear sample of an n x n grid at fractional indices (u, v). */
export function bilinear(a: ArrayLike<number>, u: number, v: number, n = RING_N): number {
  const i = Math.min(n - 2, Math.floor(u))
  const j = Math.min(n - 2, Math.floor(v))
  const fu = u - i
  const fv = v - j
  const o = j * n + i
  return (a[o] * (1 - fu) + a[o + 1] * fu) * (1 - fv) + (a[o + n] * (1 - fu) + a[o + n + 1] * fu) * fv
}

/** East and north of a grid sample's position in the observer's frame (the inverse of ringIndex). */
export function sampleEnu(f: PlaneFrame, cellM: number, i: number, j: number, cu = C, cv = C): [number, number] {
  const px = (i - cu) * cellM
  const py = -(j - cv) * cellM
  return [(px * f.E[0] + py * f.E[1]) / f.k0, (px * f.N[0] + py * f.N[1]) / f.k0]
}

/**
 * Unit normals of a ring's ground in the observer's frame (3 floats per sample: east, north, up), from central
 * differences of the heights and the curvature drop's own slope (-e / R, -n / R).
 */
export function ringNormals(ring: RingGrid, f: PlaneFrame, n = RING_N, cu = C, cv = C): Float32Array {
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
      const [e, no] = sampleEnu(f, ring.cellM, i, j, cu, cv)
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

/** Unit normals of every grid of a stack (rings, then patches), as ringNormals. */
export function stackNormals(stack: GroundStack): Float32Array[] {
  return stack.grids.map((g, i) => ringNormals(g, stack.frame, stack.size[i], stack.idx[i].cu, stack.idx[i].cv))
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
 * Samples of a ring that lie inside the next finer ring, or well inside a tile that has a patch, are not computed
 * (0): the finer grid answers there. One array per grid of the stack, rings then patches.
 * `rowOffset` and `rowStride` share the rings between workers: only rows j with j % rowStride === rowOffset are
 * computed (the others stay 0), so several workers each take every rowStride-th row and the results are merged.
 * Patches are computed whole, on every PATCH_LIGHT_STRIDE-th sample each way with the others filled in between (the
 * angle is continuous, and a patch is already RING_RATIO times finer than the ring it refines): each worker is
 * given its own share of the patches (useRelief.ts).
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
  // longest step in each grid: a few of its cells, so a ridge between steps is not missed by much
  const cap = stack.grids.map((g) => (capCells * g.cellM) / f.k0)
  const idx = stack.idx
  const hs = stack.grids.map((g) => g.heights)
  const size = stack.size
  const tiles = stack.tiles
  const nR = stack.rings.length
  const NM1 = RING_N - 1
  const inv2R = 1 / (2 * R_M)
  const below = sun.el < -r - 5

  /** The angle for sample (i, j) of grid g (see the function comment). */
  const horizonOver = (g: number, i: number, j: number): number => {
    const grid = stack.grids[g]
    const n = size[g]
    const N = normals[g]
    const o = j * n + i
    const cosI = N[3 * o] * S[0] + N[3 * o + 1] * S[1] + N[3 * o + 2] * S[2]
    if (cosI <= -0.02 || below) return HORIZON_CLAMP_DEG
    const [e, no] = sampleEnu(f, grid.cellM, i, j, idx[g].cu, idx[g].cv)
    // the Sun's elevation over this sample's own level (its vertical leans by e / R, n / R)
    const iu = 1 / Math.sqrt(1 + (e * e + no * no) / (R_M * R_M))
    const elP = Math.asin(Math.min(1, Math.max(-1, (S[0] * e / R_M + S[1] * no / R_M + S[2]) * iu))) / D
    // lowest edge of the disc: once the ray to it passes above every height, nothing can hide any of the disc
    const tanLow = Math.tan(Math.max(-89, Math.min(89, elP - r)) * D)
    const hP = grid.heights[o] + 0.05
    const room = stack.maxU - hP
    // once the terrain hides the disc's upper edge the sample is in full shadow: no need to look farther
    const tanTop = Math.tan(Math.max(-89, Math.min(89, elP + r)) * D)
    let maxTan = -Infinity
    const step0 = (0.7 * grid.cellM) / f.k0
    let s = step0
    let ds = step0
    for (let it = 0; it < 400; it++) {
      // the ray to the disc's lower edge rises s tan, the ground falls away s^2 / 2R: nothing beyond can block
      const fall = (s * s) * inv2R
      if (s * tanLow + fall > room) break
      const qe = e + s * hx
      const qn = no + s * hy
      // finest grid holding the step (inlined GroundStack.locateFine + bilinear: this loop is the hot path)
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
      let g2 = k2
      const T = tiles[k2]
      if (T !== null) {
        const t = tileOf(u, v)
        const p = t < 0 ? -1 : T[t]
        if (p >= 0) {
          const q = idx[p]
          g2 = p
          u = q.au * qe + q.bu * qn + q.cu
          v = q.av * qe + q.bv * qn + q.cv
        }
      }
      const n2 = size[g2]
      const H = hs[g2]
      const i0 = u < n2 - 1 ? u | 0 : n2 - 2
      const j0 = v < n2 - 1 ? v | 0 : n2 - 2
      const fu = u - i0
      const fv = v - j0
      const q0 = j0 * n2 + i0
      const hT = (H[q0] * (1 - fu) + H[q0 + 1] * fu) * (1 - fv) + (H[q0 + n2] * (1 - fu) + H[q0 + n2 + 1] * fu) * fv
      const t = (hT - hP - fall) / s
      if (t > maxTan) {
        maxTan = t
        if (t >= tanTop) break
      }
      ds = Math.min(ds * growth, cap[g2])
      s += ds
    }
    const a = maxTan === -Infinity ? -90 : Math.atan(maxTan) / D
    return Math.max(-HORIZON_CLAMP_DEG, Math.min(HORIZON_CLAMP_DEG, a - elP))
  }

  return stack.grids.map((grid, g) => {
    const n = size[g]
    const out = new Float32Array(n * n)
    if (g >= nR) {
      // a patch: every PATCH_LIGHT_STRIDE-th sample, then the ones between (the last row and column repeat)
      const st = PATCH_LIGHT_STRIDE
      for (let j = 0; j < n; j += st) for (let i = 0; i < n; i += st) out[j * n + i] = horizonOver(g, i, j)
      const last = Math.floor((n - 1) / st) * st
      for (let j = 0; j < n; j += st)
        for (let i = 0; i < n; i++) {
          if (i % st === 0) continue
          const i0 = i - (i % st)
          const i1 = Math.min(last, i0 + st)
          const w = i > last ? 0 : (i - i0) / st
          out[j * n + i] = out[j * n + i0] * (1 - w) + out[j * n + i1] * w
        }
      for (let j = 0; j < n; j++) {
        if (j % st === 0) continue
        const j0 = j - (j % st)
        const j1 = Math.min(last, j0 + st)
        const w = j > last ? 0 : (j - j0) / st
        for (let i = 0; i < n; i++) out[j * n + i] = out[j0 * n + i] * (1 - w) + out[j1 * n + i] * w
      }
      return out
    }
    // the inner ring covers indices C ± (C / RING_RATIO) of the next one: skip those
    const inner = g > 0 ? stack.rings[g - 1].cellM / grid.cellM : 0
    const lo = C - (C + 0.5) * inner + 1
    const hi = C + (C + 0.5) * inner - 1
    const T = tiles[g]
    for (let j = rowOffset; j < n; j += rowStride) {
      const skipRow = g > 0 && j > lo && j < hi
      // samples a cell or more inside a tile with a patch are never read: the patch answers there
      const jIn = (j & (PATCH_TILE - 1)) > 0 && (j & (PATCH_TILE - 1)) < PATCH_TILE - 1
      const tRow = (j >> 6) * PATCH_TILES
      for (let i = 0; i < n; i++) {
        if (skipRow && i > lo && i < hi) continue
        if (T !== null && jIn && (i & (PATCH_TILE - 1)) > 0 && (i & (PATCH_TILE - 1)) < PATCH_TILE - 1 && T[tRow + (i >> 6)] >= 0) continue
        out[j * n + i] = horizonOver(g, i, j)
      }
    }
    return out
  })
}

/** Patches are lit on every PATCH_LIGHT_STRIDE-th sample each way (ringLightHorizon). */
export const PATCH_LIGHT_STRIDE = 2

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
