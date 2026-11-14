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
 * The outer shell of a ball of cubes, `size` cubes across. `scaleAt(lat, lon)` stretches the radius there (1 = a
 * plain sphere); only cubes within `band` of the radius are tested, so a 200-cube ball builds in a fraction of a
 * second. Scene axes as the globe (orbit.ts): x toward longitude 0, y north, z = −(toward 90 E).
 */
export function sphereBlocks(
  size: number,
  scaleAt: (lat: number, lon: number) => number,
  colorAt: (lat: number, lon: number, i: number, j: number, k: number) => [number, number, number],
  delayAt: (lat: number, lon: number) => number,
  band = 0.12,
): Blocks & { radius: number } {
  const radius = size / 2 - 1
  const inner = radius * (1 - band)
  const outer = radius * (1 + band)
  // the grid must hold the highest relief plus one empty cell all round, or the peaks are cut off (holes)
  const N = 2 * Math.ceil(outer) + 4
  const c = (N - 1) / 2
  const inside = new Uint8Array(N * N * N)
  const idx = (i: number, j: number, k: number) => (k * N + j) * N + i
  for (let k = 0; k < N; k++) {
    const z = k - c
    for (let j = 0; j < N; j++) {
      const y = j - c
      for (let i = 0; i < N; i++) {
        const x = i - c
        const r = Math.sqrt(x * x + y * y + z * z)
        if (r < inner) inside[idx(i, j, k)] = 1
        else if (r <= outer) {
          const lat = Math.asin(y / r) / DEG
          const lon = Math.atan2(-z, x) / DEG
          inside[idx(i, j, k)] = r <= radius * scaleAt(lat, lon) ? 1 : 0
        }
      }
    }
  }
  const shell: number[] = []
  for (let k = 1; k < N - 1; k++)
    for (let j = 1; j < N - 1; j++)
      for (let i = 1; i < N - 1; i++) {
        const at = idx(i, j, k)
        if (!inside[at]) continue
        if (inside[at - 1] && inside[at + 1] && inside[at - N] && inside[at + N] && inside[at - N * N] && inside[at + N * N]) continue
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
    const r = Math.max(1e-6, Math.sqrt(x * x + y * y + z * z))
    const lat = Math.asin(y / r) / DEG
    const lon = Math.atan2(-z, x) / DEG
    out.pos.set([x, y, z], s * 3)
    out.rgb.set(colorAt(lat, lon, i, j, k), s * 3)
    out.delay[s] = delayAt(lat, lon)
  }
  return { ...out, radius }
}

/** Height (m) of a simple cylindrical grid (row 0 = 90 N, column 0 = longitude 0, east-positive), nearest sample. */
export function gridHeight(heights: Float32Array, width: number, height: number, lat: number, lon: number): number {
  const col = Math.floor(((((lon % 360) + 360) % 360) / 360) * width) % width
  const row = Math.min(height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * height)))
  return heights[row * width + col]
}

/**
 * The Moon as a ball of cubes from the global LOLA heights, relief stretched by `exaggeration`. Shade comes from
 * height (the low maria and basins darker, the highlands lighter): a reading aid, not the Moon's real albedo.
 */
export function moonBlocks(heights: Float32Array, width: number, height: number, size: number, exaggeration: number): Blocks & { radius: number } {
  const h = (lat: number, lon: number) => gridHeight(heights, width, height, lat, lon)
  return sphereBlocks(
    size,
    (lat, lon) => 1 + (exaggeration * h(lat, lon)) / MOON_R_M,
    (lat, lon, i, j, k) => {
      const t = Math.max(0, Math.min(1, (h(lat, lon) + 4500) / 9000))
      return grey(0.36 + 0.42 * t + (hash2(i * 7 + k, j) - 0.5) * 0.07)
    },
    // the Moon turns to blocks from the south pole upwards
    (lat) => ((lat + 90) / 180) * 1.6,
    // test only the shell the relief can reach: the largest |height| sets the band
    Math.min(0.9, (exaggeration * heights.reduce((m, v) => Math.max(m, Math.abs(v)), 0)) / MOON_R_M + 0.03),
  )
}

const hex = (s: string): [number, number, number] => {
  const v = Number.parseInt(s.slice(1), 16)
  return [srgbToLinear(((v >> 16) & 255) / 255), srgbToLinear(((v >> 8) & 255) / 255), srgbToLinear((v & 255) / 255)]
}

/** The Sun as a ball of cubes: hot yellow and orange cells, no relief. */
export function sunBlocks(size: number): Blocks & { radius: number } {
  const tones = ['#fff1b8', '#ffd27a', '#ffb547', '#ff9f2e'].map(hex)
  return sphereBlocks(
    size,
    () => 1,
    (_lat, _lon, i, j, k) => tones[Math.floor(hash2(i * 13 + k * 7, j) * tones.length)],
    () => 0,
  )
}

/**
 * Land on the Earth, drawn by hand in 10-degree bands (a picture, not a dataset): for each band, its north edge and
 * the longitude spans of land in it. "ice" for Greenland and the poles.
 */
const LAND: [number, [number, number][]][] = [
  [80, [[-125, -60], [55, 140]]],
  [70, [[-165, -60], [5, 180]]],
  [60, [[-135, -58], [-10, 2], [5, 160]]],
  [50, [[-125, -60], [-10, 145]]],
  [40, [[-122, -76], [-10, 122], [130, 141]]],
  [30, [[-112, -97], [-17, 92], [100, 120]]],
  [20, [[-105, -83], [-17, 52], [73, 80], [95, 108], [120, 125]]],
  [10, [[-80, -50], [-10, 45], [95, 120]]],
  [0, [[-80, -35], [10, 40], [100, 150]]],
  [-10, [[-77, -38], [12, 40], [44, 50], [123, 146]]],
  [-20, [[-70, -42], [15, 33], [114, 153]]],
  [-30, [[-72, -55], [18, 26], [116, 150], [172, 178]]],
  [-40, [[-74, -65], [166, 175]]],
  [-50, [[-75, -66]]],
]
const GREENLAND: [number, number] = [-55, -20]

export function earthSurface(lat: number, lon: number): 'ocean' | 'land' | 'desert' | 'ice' {
  if (lat > 80 || lat < -62) return 'ice'
  if (lat > 60 && lon >= GREENLAND[0] && lon <= GREENLAND[1]) return 'ice'
  const band = LAND.find(([north]) => lat <= north && lat > north - 10)
  if (!band || !band[1].some(([a, b]) => lon >= a && lon <= b)) return 'ocean'
  const sahara = lat > 12 && lat < 35 && lon > -17 && lon < 60
  const outback = lat < -18 && lat > -32 && lon > 118 && lon < 145
  return sahara || outback ? 'desert' : 'land'
}

/** The Earth as a ball of cubes: oceans, land, deserts, ice and a few clouds (hand-drawn, see LAND). */
export function earthBlocks(size: number): Blocks & { radius: number } {
  const tone = { ocean: hex('#1f5fae'), land: hex('#4f8a4a'), desert: hex('#c9a66b'), ice: hex('#eef3f7') }
  const cloud = hex('#f4f7fb')
  const deep = hex('#1a4f94')
  return sphereBlocks(
    size,
    () => 1,
    (lat, lon, i, j, k) => {
      const n = hash2(i * 3 + k * 11, j * 5)
      if (n > 0.88) return cloud
      const kind = earthSurface(lat, lon)
      return kind === 'ocean' && n < 0.4 ? deep : tone[kind]
    },
    () => 0,
  )
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
