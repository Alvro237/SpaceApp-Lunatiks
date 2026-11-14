/**
 * Block Moon: turns the same LOLA heights the navigator uses into a world of cubes, for the educational mode.
 *
 * Two worlds, both pure functions over arrays (no three.js, no fetch), so they are testable:
 *   - Ground: the polar DEM overview (LOLA, PGDA product 90, 960 m cells) around the chosen place, as columns
 *     of cubes. A cube is one cell wide and `cellM / EXAGGERATION` tall, so the cubes look like cubes while the
 *     relief is drawn EXAGGERATION times taller than it is. The Moon's curvature is kept (drop = d² / 2R).
 *   - Moon: the global LOLA grid (4 pixels per degree) as a sphere of cubes, relief exaggerated so it shows.
 *
 * Sky angles are stretched by the same factor as the heights (tan el' = k tan el), so the shadows the cubes cast
 * fall where real shadows fall on the stretched terrain. They are a picture: the Sun and Earth answers in the
 * panels come from the engine's terrain horizon, not from these cubes.
 */

export const GROUND_EXAGGERATION = 4
const MOON_R_M = 1_737_400
const DEG = Math.PI / 180

/** Pseudo-random in [0, 1) from two integers (stable, so the world looks the same every time). */
export function hash2(i: number, j: number): number {
  const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453
  return h - Math.floor(h)
}

export interface HeightGrid {
  /** Samples per side. */
  n: number
  cellM: number
  /** Heights in metres, row 0 = north edge, column 0 = west edge, curvature drop already subtracted. */
  heightsM: Float32Array
}

/**
 * Samples a square of n × n cells centred on (lat, lon), axes east and north at that point, on the south polar
 * stereographic map (x = r sin lon, y = r cos lon). Returns null when any sample falls outside the map.
 */
export function sampleGround(
  heightAt: (x: number, y: number) => number | null,
  polarXY: (lat: number, lon: number) => [number, number],
  lat: number,
  lon: number,
  n: number,
  cellM: number,
): HeightGrid | null {
  const [sx, sy] = polarXY(lat, lon)
  // North on the map is away from the pole (r grows with latitude), east is a quarter turn clockwise from it.
  const nx = Math.sin(lon * DEG)
  const ny = Math.cos(lon * DEG)
  const ex = Math.cos(lon * DEG)
  const ey = -Math.sin(lon * DEG)
  const half = (n - 1) / 2
  const heightsM = new Float32Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const east = (i - half) * cellM
      const north = (half - j) * cellM
      const h = heightAt(sx + east * ex + north * nx, sy + east * ey + north * ny)
      if (h === null || !Number.isFinite(h)) return null
      heightsM[j * n + i] = h - (east * east + north * north) / (2 * MOON_R_M)
    }
  }
  return { n, cellM, heightsM }
}

export interface Blocks {
  count: number
  /** Cube centres, scene units (one cube = 1). */
  pos: Float32Array
  /** Linear-light RGB in [0, 1]. */
  rgb: Float32Array
  /** Start of each cube's build-in animation, seconds. */
  delay: Float32Array
}

function blocks(count: number): Blocks {
  return { count, pos: new Float32Array(count * 3), rgb: new Float32Array(count * 3), delay: new Float32Array(count) }
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
function grey(v: number): [number, number, number] {
  const l = srgbToLinear(Math.max(0, Math.min(1, v)))
  // regolith is a slightly warm grey
  return [l * 1.02, l, l * 0.96]
}

export interface GroundBlocks extends Blocks {
  /** Column heights in cubes, relative to the centre column (row-major, as the grid). */
  columns: Int16Array
  /** Height of the centre column's top cube. */
  centreTop: number
  /** Lowest cube (the floor of the island). */
  floor: number
}

/**
 * Columns of cubes from a height grid. Only cubes that can be seen are made: the top of each column and its
 * sides down to the lowest neighbour; the outer ring goes down to a common floor, so the world is an island.
 */
export function groundBlocks(grid: HeightGrid, exaggeration = GROUND_EXAGGERATION): GroundBlocks {
  const { n, cellM, heightsM } = grid
  const blockM = cellM / exaggeration
  const c = Math.floor(n / 2)
  const h0 = heightsM[c * n + c]
  const columns = new Int16Array(n * n)
  let lo = Infinity
  let hi = -Infinity
  for (let k = 0; k < n * n; k++) {
    columns[k] = Math.round((heightsM[k] - h0) / blockM)
    lo = Math.min(lo, columns[k])
    hi = Math.max(hi, columns[k])
  }
  const floor = lo - 2
  const at = (i: number, j: number) => columns[j * n + i]
  const bottomOf = (i: number, j: number) => {
    if (i === 0 || j === 0 || i === n - 1 || j === n - 1) return floor
    const m = Math.min(at(i - 1, j), at(i + 1, j), at(i, j - 1), at(i, j + 1))
    return Math.min(at(i, j), m + 1)
  }
  let count = 0
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) count += at(i, j) - bottomOf(i, j) + 1
  const out = blocks(count) as GroundBlocks
  out.columns = columns
  out.centreTop = columns[c * n + c]
  out.floor = floor
  const half = (n - 1) / 2
  const span = Math.max(1, hi - lo)
  let k = 0
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const top = at(i, j)
      const dist = Math.hypot(i - half, j - half) / (half * Math.SQRT2)
      for (let y = bottomOf(i, j); y <= top; y++) {
        out.pos.set([i - half, y, j - half], k * 3)
        const t = (top - lo) / span
        const noise = (hash2(i, j) - 0.5) * 0.06
        const depth = top - y
        const v = depth === 0 ? 0.42 + 0.36 * t + noise : y <= floor + 1 ? 0.16 : 0.3 + 0.12 * t - Math.min(depth, 6) * 0.02 + noise
        out.rgb.set(grey(v), k * 3)
        // the world builds outwards from the chosen place, each column from the bottom up
        out.delay[k] = dist * 1.1 + (y - floor) * 0.012
        k++
      }
    }
  }
  return out
}

/**
 * A sphere of cubes, `size` cubes across, from a global height grid (simple cylindrical, row 0 = 90 N, column 0 =
 * longitude 0, east-positive). Only the outer shell is made. Scene axes as the globe (orbit.ts): x toward
 * longitude 0, y north, z = −(toward 90 E).
 */
export function moonBlocks(heights: Float32Array, width: number, height: number, size: number, exaggeration: number): Blocks & { radius: number } {
  const radius = size / 2 - 1
  const lookup = (lat: number, lon: number) => {
    const col = Math.floor((((lon % 360) + 360) % 360) / 360 * width) % width
    const row = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)))
    return heights[row * width + col]
  }
  const N = size + 2
  const inside = new Uint8Array(N * N * N)
  const hAt = new Float32Array(N * N * N)
  const idx = (i: number, j: number, k: number) => (k * N + j) * N + i
  const c = (N - 1) / 2
  for (let k = 0; k < N; k++)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const x = i - c
        const y = j - c
        const z = k - c
        const r = Math.hypot(x, y, z)
        if (r > radius * 1.2 || r < radius * 0.8) {
          inside[idx(i, j, k)] = r < radius ? 1 : 0
          continue
        }
        const lat = Math.asin(y / r) / DEG
        const lon = Math.atan2(-z, x) / DEG
        const h = lookup(lat, lon)
        hAt[idx(i, j, k)] = h
        inside[idx(i, j, k)] = r <= radius * (1 + (exaggeration * h) / MOON_R_M) ? 1 : 0
      }
  const shell: number[] = []
  for (let k = 1; k < N - 1; k++)
    for (let j = 1; j < N - 1; j++)
      for (let i = 1; i < N - 1; i++) {
        if (!inside[idx(i, j, k)]) continue
        if (inside[idx(i - 1, j, k)] && inside[idx(i + 1, j, k)] && inside[idx(i, j - 1, k)] && inside[idx(i, j + 1, k)] && inside[idx(i, j, k - 1)] && inside[idx(i, j, k + 1)])
          continue
        shell.push(i, j, k)
      }
  const out = blocks(shell.length / 3)
  for (let s = 0; s < out.count; s++) {
    const i = shell[s * 3]
    const j = shell[s * 3 + 1]
    const k = shell[s * 3 + 2]
    const x = i - c
    const y = j - c
    const z = k - c
    out.pos.set([x, y, z], s * 3)
    // low ground (the maria and the big basins) darker, highlands lighter
    const h = hAt[idx(i, j, k)]
    const t = Math.max(0, Math.min(1, (h + 6000) / 12000))
    out.rgb.set(grey(0.3 + 0.45 * t + (hash2(i * 7 + k, j) - 0.5) * 0.08), s * 3)
    // the Moon turns to blocks from the south pole upwards
    const lat = Math.asin(y / Math.max(1e-6, Math.hypot(x, y, z))) / DEG
    out.delay[s] = ((lat + 90) / 180) * 1.6
  }
  return { ...out, radius }
}

/**
 * Direction to a body in the ground world: x east, y up, z south (scene z = −north). Azimuth clockwise from
 * north, elevation above the horizontal, both degrees; the elevation is stretched like the heights.
 */
export function skyVector(azDeg: number, elDeg: number, exaggeration = GROUND_EXAGGERATION): [number, number, number] {
  const el = Math.atan(exaggeration * Math.tan(Math.max(-89, Math.min(89, elDeg)) * DEG))
  const az = azDeg * DEG
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]
}

export interface DayBlock {
  startMs: number
  /** Share of the day with any part of the Sun above the real skyline, 0..1. */
  sun: number
  /** Share of the day with Earth contact, 0..1. */
  earth: number
}

/** One block per Earth day over the series: what share of each day had the Sun, and Earth contact. */
export function dayBlocks(t: number[], sunlit: boolean[], comms: boolean[], startMs: number, days: number): DayBlock[] {
  const DAY = 86_400_000
  const out: DayBlock[] = []
  for (let d = 0; d < days; d++) out.push({ startMs: startMs + d * DAY, sun: 0, earth: 0 })
  const n = new Array(days).fill(0)
  for (let k = 0; k < t.length; k++) {
    const d = Math.floor((t[k] - startMs) / DAY)
    if (d < 0 || d >= days) continue
    n[d]++
    if (sunlit[k]) out[d].sun++
    if (comms[k]) out[d].earth++
  }
  for (let d = 0; d < days; d++) {
    if (n[d] === 0) {
      out[d].sun = Number.NaN
      out[d].earth = Number.NaN
    } else {
      out[d].sun /= n[d]
      out[d].earth /= n[d]
    }
  }
  return out
}

/** "14 hours", "3 days", "20 minutes": a simple duration for the explorer panels. */
export function simpleDuration(ms: number): string {
  const h = ms / 3_600_000
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes`
  if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'}`
  return `${Math.round(h / 24)} days`
}
