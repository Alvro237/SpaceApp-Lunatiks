/**
 * The real ground around a place for the horizon view: nested LOLA height grids ("rings") centred on the observer,
 * each four times coarser and four times wider than the one inside it, so the detail follows the eye. With the
 * 5 m DEM the four rings are 5, 20, 80 and 320 m cells over 2.56, 10.2, 41 and 164 km squares (512 x 512 samples
 * each); with the 30 m DEM they start at 30 m (15 km), with the 100 m DEM at 100 m (51 km).
 *
 * Source: NASA Moon Trek's ArcGIS ImageServer (JPL), the LOLA south-polar DEMs v04 the map's live levels read
 * (terrain/live/config.ts: 5 m to 87.5 S, 30 m to 75 S, 100 m to 45 S). One exportImage request per ring returns a
 * float32 GeoTIFF whose pixel centres are the ring's samples, in the LOLA south polar stereographic projection,
 * resampled bilinearly on the server; one extra row is asked for and dropped, as for the map tiles (Moon Trek
 * answers the last row with zeros otherwise). Measured 2026-11-15 at 89.5 S: 0.5-1.2 MB and 1.5-2 s per ring.
 *
 * Geometry: the rings are laid in the stereographic plane, and the view works in the observer's local east-north-up
 * frame (metres). Over a ring the projection is a similarity to within its scale-factor change (k = 1.0019 at
 * 85 S; it changes by less than 1e-3 across the 164 km ring), so (x, y) = (x0, y0) + k0 (e E + n N), with E and N the
 * east and north unit vectors of the plane at the observer. The ground's curvature is kept exactly to second order:
 * a point at horizontal distance d and height h lies h - d^2 / (2 R) above the observer's level plane.
 */
import { fromArrayBuffer } from 'geotiff'
import { TREK_100M, TREK_30M, TREK_5M, TREK_IMAGE_SERVER, TREK_EXTRA_ROWS, type LiveSource } from '../../terrain/live/config'
import { R_M, polarXY, scaleFactor } from '../../terrain/tileset'

/** Samples across a ring. */
export const RING_N = 512
/** Each ring's cell is this many times the one inside it. */
export const RING_RATIO = 4
export const RING_COUNT = 4
/** Sources tried for a ring, finest first. */
export const RELIEF_SOURCES: LiveSource[] = [TREK_5M, TREK_30M, TREK_100M]

export interface RingSpec {
  /** Cell size in the stereographic plane, metres (ground cell = cellM / k0). */
  cellM: number
  source: LiveSource
  url: string
}

export interface Ring extends RingSpec {
  /** RING_N x RING_N heights above the 1737.4 km sphere, metres; row 0 is the top (largest y) of the plane. */
  heights: Float32Array
  min: number
  max: number
}

/** Observer frame in the plane: position, scale factor and the east and north unit vectors there. */
export interface PlaneFrame {
  lat: number
  lon: number
  x0: number
  y0: number
  k0: number
  E: [number, number]
  N: [number, number]
}

const DEG = Math.PI / 180

export function planeFrame(lat: number, lon: number): PlaneFrame {
  const [x0, y0] = polarXY(lat, lon)
  const s = Math.sin(lon * DEG)
  const c = Math.cos(lon * DEG)
  // polarXY: (x, y) = r (sin lon, cos lon), r grows northwards; d/dlon is r (cos lon, -sin lon), eastwards
  return { lat, lon, x0, y0, k0: scaleFactor(lat), N: [s, c], E: [c, -s] }
}

/** Plane coordinates of a local (east, north) offset in metres. */
export function enuToPlane(f: PlaneFrame, e: number, n: number): [number, number] {
  return [f.x0 + f.k0 * (e * f.E[0] + n * f.N[0]), f.y0 + f.k0 * (e * f.E[1] + n * f.N[1])]
}

/** Local (east, north) offset in metres of a plane point. */
export function planeToEnu(f: PlaneFrame, x: number, y: number): [number, number] {
  const dx = x - f.x0
  const dy = y - f.y0
  return [(dx * f.E[0] + dy * f.E[1]) / f.k0, (dx * f.N[0] + dy * f.N[1]) / f.k0]
}

/** Half-width of a ring in the plane, metres (the outer edge of its outermost samples' cells). */
export const ringHalf = (cellM: number) => (RING_N / 2) * cellM

/** Does the square of half-width `half` centred on (x, y) lie inside the source? */
const inside = (s: LiveSource, x: number, y: number, half: number) => Math.max(Math.abs(x), Math.abs(y)) + half <= s.halfExtentM

/**
 * The rings for a place, or null where no south-polar DEM covers it (north of 45 S). The first ring's cell is the
 * finest source's pixel that covers it; each ring reads the finest source that covers its whole square.
 */
export function ringSpecs(lat: number, lon: number): RingSpec[] | null {
  if (!(lat < 0)) return null
  const [x0, y0] = polarXY(lat, lon)
  const base = RELIEF_SOURCES.find((s) => inside(s, x0, y0, ringHalf(s.pixelM)))
  if (!base) return null
  const specs: RingSpec[] = []
  for (let j = 0; j < RING_COUNT; j++) {
    const cellM = base.pixelM * RING_RATIO ** j
    const source = RELIEF_SOURCES.find((s) => inside(s, x0, y0, ringHalf(cellM)))
    if (!source) break
    specs.push({ cellM, source, url: ringUrl(source, x0, y0, cellM) })
  }
  return specs
}

/**
 * exportImage URL of a ring: the box is the ring's cells (sample centres on the grid), widened downwards by
 * TREK_EXTRA_ROWS cells. Coordinates are rounded to the millimetre so the same place always asks the same URL.
 */
export function ringUrl(source: LiveSource, x0: number, y0: number, cellM: number): string {
  const h = ringHalf(cellM)
  const r = (v: number) => Math.round(v * 1000) / 1000
  const bbox = [r(x0 - h), r(y0 - h - TREK_EXTRA_ROWS * cellM), r(x0 + h), r(y0 + h)].join(',')
  return (
    `${TREK_IMAGE_SERVER}${source.file}/ImageServer/exportImage?bbox=${bbox}&size=${RING_N},${RING_N + TREK_EXTRA_ROWS}` +
    '&format=tiff&pixelType=F32&compression=LZ77&interpolation=RSP_BilinearInterpolation&f=image'
  )
}

/** Decode and check one ring answer: size, no-data, no row of exact zeros (the Moon Trek fault). */
export async function decodeRing(buf: ArrayBuffer, spec: RingSpec): Promise<Ring> {
  const tiff = await fromArrayBuffer(buf)
  const image = await tiff.getImage(0)
  const n = RING_N
  if (image.getWidth() !== n || image.getHeight() !== n + TREK_EXTRA_ROWS) {
    throw new Error(`ring is ${image.getWidth()} x ${image.getHeight()}, expected ${n} x ${n + TREK_EXTRA_ROWS}`)
  }
  const raster = (await image.readRasters({ samples: [0], interleave: true })) as unknown as ArrayLike<number>
  const noData = image.getGDALNoData()
  const heights = new Float32Array(n * n)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < n * n; i++) {
    const v = raster[i]
    if (Number.isNaN(v) || v === noData || v < -1e30 || v > 1e30) throw new Error('ring has samples without data')
    heights[i] = v
    if (v < min) min = v
    if (v > max) max = v
  }
  for (let r = 0; r < n; r++) {
    let zero = true
    for (let c = 0; c < n && zero; c++) zero = heights[r * n + c] === 0
    if (zero) throw new Error(`ring row ${r} is all zeros`)
  }
  return { ...spec, heights, min, max }
}

const cache = new Map<string, Promise<Ring>>()

/** Fetch and decode a ring once per URL (kept for the session); up to three tries. */
export function loadRing(spec: RingSpec, fetchFn: typeof fetch = (u, i) => fetch(u, i)): Promise<Ring> {
  const hit = cache.get(spec.url)
  if (hit) return hit
  const p = (async () => {
    let last: unknown = null
    for (let a = 0; a < 3; a++) {
      try {
        const res = await fetchFn(spec.url)
        if (!res.ok) throw new Error(`Moon Trek answered HTTP ${res.status}`)
        return await decodeRing(await res.arrayBuffer(), spec)
      } catch (e) {
        last = e
      }
    }
    throw last instanceof Error ? last : new Error(String(last))
  })()
  cache.set(spec.url, p)
  p.catch(() => cache.delete(spec.url))
  return p
}

/** Bilinear height of a ring at a plane point, or NaN outside its samples. */
export function ringHeight(ring: Pick<Ring, 'heights' | 'cellM'>, f: PlaneFrame, x: number, y: number): number {
  const n = RING_N
  const u = (x - f.x0) / ring.cellM + (n - 1) / 2
  const v = (f.y0 - y) / ring.cellM + (n - 1) / 2
  if (!(u >= 0 && v >= 0 && u <= n - 1 && v <= n - 1)) return NaN
  const i = Math.min(n - 2, Math.floor(u))
  const j = Math.min(n - 2, Math.floor(v))
  const fu = u - i
  const fv = v - j
  const H = ring.heights
  const o = j * n + i
  return (H[o] * (1 - fu) + H[o + 1] * fu) * (1 - fv) + (H[o + n] * (1 - fu) + H[o + n + 1] * fu) * fv
}

/** Height of the curved ground below the observer's level plane at horizontal distance d: d^2 / (2 R). */
export const curvatureDrop = (d: number) => (d * d) / (2 * R_M)
