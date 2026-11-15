/**
 * The real ground around a place for the horizon view: nested LOLA height grids ("rings") centred on the observer,
 * each four times coarser and four times wider than the one inside it, so the detail follows the eye. Near the
 * south or north pole the four rings are 5, 20, 80 and 320 m cells over 2.56, 10.2, 41 and 164 km squares
 * (512 x 512 samples each); farther out they start at 30 m (to 75°) or 100 m (to 45°); elsewhere on the Moon at
 * 60 m, half the 118 m cell of the global LOLA DEM. No ring is added once the previous one reaches MAX_REACH_M
 * (the skyline masks are traced to 250 km).
 *
 * Source: NASA Moon Trek's ArcGIS ImageServer (JPL): the LOLA polar DEMs v04 (5 m to 87.5°, 30 m to 75°, 100 m to
 * 45°, south and north; the same files as the map's live levels, terrain/live/config.ts) and the LOLA global DEM
 * 256 px/deg v06 (the globe's, globe/detail/grid.ts). One exportImage request per ring, asked for in a
 * stereographic projection centred on the place itself (bboxSR and imageSR given as WKT on the IAU 2000 Moon
 * sphere, 1737.4 km): the server reprojects the DEM (bilinearly), so every ring, anywhere on the Moon, is a square
 * of true metres around the observer. One extra row is asked for and dropped (Moon Trek answers the last row with
 * zeros). Measured 2026-11-15: 0.5-1.2 MB and 1.5-2 s per ring (89.5 S with the 5 m DEM; Apollo 11 with the global
 * DEM: -1927 m at the site, the level of the mare).
 *
 * Geometry: in the local stereographic plane the scale is 1 at the observer and 1 + (d / 2R)^2 at distance d
 * (1.002 at the 164 km edge), north is +y and east is +x, so the plane is the observer's east-north frame. The
 * ground's curvature is kept exactly to second order: a point at horizontal distance d and height h lies
 * h - d^2 / (2 R) above the observer's level plane (light.ts, render.ts).
 */
import { fromArrayBuffer } from 'geotiff'
import { TREK_EXTRA_ROWS, TREK_IMAGE_SERVER } from '../../terrain/live/config'
import { R_M, polarXY, scaleFactor } from '../../terrain/tileset'
import FINE_CATALOGUE from './fineDems.json'

/** Samples across a ring. */
export const RING_N = 512
/** Each ring's cell is this many times the one inside it. */
export const RING_RATIO = 4
export const RING_COUNT = 6
/** No ring is added once the previous one reaches this far from the observer, metres. */
export const MAX_REACH_M = 250_000

export interface ReliefSource {
  /** Moon Trek ImageServer service name. */
  file: string
  /** Cell of the first ring read from it, metres. */
  pixelM: number
  /** The DEM's own cell, metres (what the view reports). */
  demM: number
  /** Polar DEMs: the pole and the half-width of their square in the polar stereographic plane, metres. */
  pole: 'S' | 'N' | null
  halfExtentM: number
  /** Global DEMs: the range of ring cells each one serves, metres. */
  minCellM?: number
  maxCellM?: number
}

const polar = (pole: 'S' | 'N', res: string, pixelM: number, halfExtentM: number): ReliefSource => ({
  file: `LRO_LOLA_DEM_${pole}Pole${res}_v04`,
  pixelM,
  demM: pixelM,
  pole,
  halfExtentM,
})

/** The polar DEMs (terrain/live/config.ts; the same extents in both hemispheres) and the global one, finest first. */
export const RELIEF_SOURCES: ReliefSource[] = [
  polar('S', '875_5mp', 5, 75_840),
  polar('N', '875_5mp', 5, 75_840),
  polar('S', '75_30mp', 30, 457_440),
  polar('N', '75_30mp', 30, 457_440),
  polar('S', '45_100mp', 100, 1_440_000),
  polar('N', '45_100mp', 100, 1_440_000),
  // the global DEM's cell is 118 m; its first ring is laid at half of that, bilinear between the DEM's samples.
  // Rings of 960 m cells and coarser read the 128 px/deg v04 DEM (237 m): Moon Trek cuts a 983 km ring from it in
  // about 2 s, against 14 s or an HTTP 400 from the v06 DEM (measured 2026-11-15); its gaps between LOLA tracks are
  // far below such cells
  { file: 'LRO_LOLA_DEM_Global_256ppd_v06', pixelM: 60, demM: 118, pole: null, halfExtentM: Infinity, maxCellM: 959 },
  { file: 'LRO_LOLA_DEM_Global_128ppd_v04', pixelM: 960, demM: 237, pole: null, halfExtentM: Infinity, minCellM: 960 },
]

/**
 * A high-resolution DTM on Moon Trek (fineDems.json, built by scripts/build_fine_dems.mjs): LROC NAC stereo DTMs
 * (1.5-2.8 m), Apollo 15 Panoramic Camera DTMs (3-5 m) and the Apollo 17 NAC DTM (5 m). Each covers a strip of a few
 * tens of kilometres; its extent here is the bounding box in degrees, the data inside it has gaps.
 */
export interface FineDem {
  file: string
  lat0: number
  lat1: number
  lon0: number
  lon1: number
  cellM: number
}

export const FINE_DEMS: FineDem[] = (FINE_CATALOGUE as { dems: FineDem[] }).dems
/** A fine DTM serves the rings up to this many times its own cell. */
export const FINE_RING_FACTOR = 16

/** The finest DTM whose box holds the place, or null. */
export function fineDemAt(lat: number, lon: number): FineDem | null {
  let best: FineDem | null = null
  for (const d of FINE_DEMS) {
    const inLon = d.lon0 <= d.lon1 ? lon >= d.lon0 && lon <= d.lon1 : lon >= d.lon0 || lon <= d.lon1
    if (lat >= d.lat0 && lat <= d.lat1 && inLon && (!best || d.cellM < best.cellM)) best = d
  }
  return best
}

export interface RingSpec {
  /** Cell size, metres (local stereographic plane: true metres at the observer). */
  cellM: number
  source: ReliefSource
  url: string
  /** The LROC WAC mosaic over the same cells (photoUrl): this place's own ground brightness. */
  photoUrl?: string
  /** A high-resolution DTM read for this ring too, merged over the LOLA heights where it has data. */
  fine?: { dem: FineDem; url: string }
}

export interface Ring extends RingSpec {
  /** RING_N x RING_N heights above the 1737.4 km sphere, metres; row 0 is the north edge. */
  heights: Float32Array
  min: number
  max: number
  /** Share of the ring's samples taken from the fine DTM, and its mean offset from LOLA removed there, metres. */
  fineShare?: number
  fineOffsetM?: number
  /**
   * RING_N x RING_N albedo of the ground from this place's LROC WAC mosaic (photoAlbedo), 1 for the ring's mean
   * brightness; absent where the photo could not be read (the ground is then plain regolith).
   */
  albedo?: Float32Array
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

/** The local stereographic plane of a place: centred on it, scale 1 there, east +x, north +y. */
export function planeFrame(lat: number, lon: number): PlaneFrame {
  return { lat, lon, x0: 0, y0: 0, k0: 1, E: [1, 0], N: [0, 1] }
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

/** Half-width of a ring, metres (the outer edge of its outermost samples' cells). */
export const ringHalf = (cellM: number) => (RING_N / 2) * cellM

/** Does a square of half-width `half` (ground metres, any orientation) around the place lie inside the source? */
function covers(s: ReliefSource, lat: number, lon: number, half: number): boolean {
  const cell = half / (RING_N / 2)
  if (cell < (s.minCellM ?? 0) || cell > (s.maxCellM ?? Infinity)) return false
  if (s.pole === null) return true
  if ((s.pole === 'S') !== lat < 0) return false
  // the polar DEMs are squares in their polar stereographic plane; north mirrors south
  const [x, y] = polarXY(-Math.abs(lat), lon)
  return Math.max(Math.abs(x), Math.abs(y)) + half * Math.SQRT2 * scaleFactor(-Math.abs(lat)) <= s.halfExtentM
}

/**
 * The rings for a place, or null for invalid coordinates. The first ring's cell is that of the finest source
 * covering it; each ring reads the finest source covering its whole square (the global DEM covers everything).
 */
export function ringSpecs(lat: number, lon: number): RingSpec[] | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null
  const base = RELIEF_SOURCES.find((s) => covers(s, lat, lon, ringHalf(s.pixelM)))!
  // where a high-resolution DTM covers the place, the rings start at its cell
  const fine = fineDemAt(lat, lon)
  const firstCell = fine && fine.cellM < base.pixelM ? Math.round(fine.cellM * 100) / 100 : base.pixelM
  const specs: RingSpec[] = []
  for (let j = 0; j < RING_COUNT; j++) {
    const cellM = firstCell * RING_RATIO ** j
    if (j > 0 && ringHalf(cellM / RING_RATIO) >= MAX_REACH_M) break
    const source = RELIEF_SOURCES.find((s) => covers(s, lat, lon, ringHalf(cellM)))!
    const spec: RingSpec = { cellM, source, url: ringUrl(source.file, lat, lon, cellM), photoUrl: photoUrl(lat, lon, cellM) }
    if (fine && cellM <= FINE_RING_FACTOR * fine.cellM) spec.fine = { dem: fine, url: ringUrl(fine.file, lat, lon, cellM) }
    specs.push(spec)
  }
  return specs
}

/** WKT of the stereographic projection centred on a place, on the IAU 2000 Moon sphere, as ArcGIS reads it. */
export function localStereoWkt(lat: number, lon: number): string {
  const r = (v: number) => Math.round(v * 1e6) / 1e6
  return (
    'PROJCS["Moon_Local_Stereographic",GEOGCS["GCS_Moon_2000",DATUM["D_Moon_2000",SPHEROID["Moon_2000_IAU_IAG",1737400.0,0.0]],' +
    'PRIMEM["Reference_Meridian",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Stereographic"],' +
    `PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",${r(lon)}],` +
    `PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",${r(lat)}],UNIT["Meter",1.0]]`
  )
}

/**
 * exportImage URL of a ring: the box is the ring's cells (sample centres on the grid) in the place's own
 * stereographic plane, widened downwards by TREK_EXTRA_ROWS cells.
 */
export function ringUrl(service: string, lat: number, lon: number, cellM: number): string {
  const h = ringHalf(cellM)
  const sr = encodeURIComponent(JSON.stringify({ wkt: localStereoWkt(lat, lon) }))
  const bbox = [-h, -h - TREK_EXTRA_ROWS * cellM, h, h].join(',')
  return (
    `${TREK_IMAGE_SERVER}${service}/ImageServer/exportImage?bbox=${bbox}&bboxSR=${sr}&imageSR=${sr}` +
    `&size=${RING_N},${RING_N + TREK_EXTRA_ROWS}` +
    '&format=tiff&pixelType=F32&compression=LZ77&interpolation=RSP_BilinearInterpolation&f=image'
  )
}

/**
 * The LROC WAC mosaics on Moon Trek (Speyerer et al. 2011; 100 m, 8-bit reflectance as photographed): the polar
 * ones (south and north polar stereographic, a square of ±1 095.6 km to about 60°) and the global one (303 px/deg).
 * The polar mosaics are used where the ring's square lies inside them: the global one is equirectangular, so near
 * the poles its pixels are stretched along the parallels.
 */
const WAC_POLAR_HALF_M = 1_095_600
const WAC_GLOBAL = 'LRO_WAC_Mosaic_Global_303ppd_v02'

export function photoService(lat: number, lon: number, cellM: number): string {
  const pole: 'S' | 'N' = lat < 0 ? 'S' : 'N'
  const polarSrc: ReliefSource = { file: '', pixelM: 100, demM: 100, pole, halfExtentM: WAC_POLAR_HALF_M }
  return Math.abs(lat) >= 60 && covers(polarSrc, lat, lon, ringHalf(cellM)) ? `LRO_WAC_Mosaic_${pole}Pole60_100m_v02` : WAC_GLOBAL
}

/**
 * exportImage URL of a ring's photo: the same cells as its heights (no extra row: the JPEG answers have no zero
 * row), grey JPEG reprojected by the server into the place's own stereographic plane. Measured 2026-11-15 at
 * IM-1 (80.13 S): 0.96 s for 100 m cells, 1.27 s for 400 m cells.
 */
export function photoUrl(lat: number, lon: number, cellM: number): string {
  const h = ringHalf(cellM)
  const sr = encodeURIComponent(JSON.stringify({ wkt: localStereoWkt(lat, lon) }))
  return (
    `${TREK_IMAGE_SERVER}${photoService(lat, lon, cellM)}/ImageServer/exportImage?bbox=${-h},${-h},${h},${h}&bboxSR=${sr}&imageSR=${sr}` +
    `&size=${RING_N},${RING_N}&format=jpg&compressionQuality=90&interpolation=RSP_BilinearInterpolation&f=image`
  )
}

/**
 * The photo as albedo, normalised ring by ring: each sample's brightness over the ring's mean brightness (the
 * mosaic's photographed shadows, bytes under SHADOW_BYTE, left out of the mean), its departures from 1 stretched by
 * PHOTO_CONTRAST. Normalising per ring keeps neighbouring rings at the same mean level, so no seam shows where
 * one ring hands over to the next or where a ring has no photo (albedo 1); the stretch makes the mosaic's detail
 * read on low-contrast ground (maria and plains photographed under a high Sun: a standard deviation of 0.15 of the
 * mean at 26.6 N 150.9 E). The view says so on screen.
 */
export const PHOTO_CONTRAST = 1.8
export const SHADOW_BYTE = 12
/**
 * Albedo range kept. The mosaic holds the shadows it was photographed with (near the poles most of the ground:
 * median 0.016 of the byte range within 60 km of the pole); the floor leaves that ground shaped by the light of the
 * chosen instant instead of black, and the cap keeps sunlit crater walls from blowing out.
 */
export const ALBEDO_MIN = 0.3
export const ALBEDO_MAX = 2.2

/** Grey bytes (one per sample, row 0 north) to albedo: 1 + PHOTO_CONTRAST (byte / mean - 1), clamped; null if all shadow. */
export function photoAlbedo(grey: ArrayLike<number>): Float32Array | null {
  let sum = 0
  let n = 0
  for (let i = 0; i < grey.length; i++)
    if (grey[i] >= SHADOW_BYTE) {
      sum += grey[i]
      n++
    }
  if (n < grey.length * 0.05) return null
  const mean = sum / n
  const out = new Float32Array(grey.length)
  for (let i = 0; i < grey.length; i++) out[i] = Math.min(ALBEDO_MAX, Math.max(ALBEDO_MIN, 1 + PHOTO_CONTRAST * (grey[i] / mean - 1)))
  return out
}

/** Decode a ring's photo (JPEG) to albedo; null where the browser cannot decode images (tests) or the size is wrong. */
export async function decodePhoto(blob: Blob): Promise<Float32Array | null> {
  if (typeof createImageBitmap === 'undefined' || typeof document === 'undefined') return null
  const img = await createImageBitmap(blob)
  if (img.width !== RING_N || img.height !== RING_N) return null
  const canvas = document.createElement('canvas')
  canvas.width = RING_N
  canvas.height = RING_N
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) return null
  g.drawImage(img, 0, 0)
  const rgba = g.getImageData(0, 0, RING_N, RING_N).data
  const grey = new Uint8Array(RING_N * RING_N)
  for (let i = 0; i < grey.length; i++) grey[i] = rgba[4 * i]
  return photoAlbedo(grey)
}

/**
 * Decode one fine-DTM answer: heights with NaN where the DTM has no data (outside its strip Moon Trek answers
 * -3.4e38, the float32 minimum, measured 2026-11-15).
 */
export async function decodeFine(buf: ArrayBuffer): Promise<Float32Array> {
  const tiff = await fromArrayBuffer(buf)
  const image = await tiff.getImage(0)
  const n = RING_N
  if (image.getWidth() !== n || image.getHeight() !== n + TREK_EXTRA_ROWS) throw new Error('fine DTM answer has the wrong size')
  const raster = (await image.readRasters({ samples: [0], interleave: true })) as unknown as ArrayLike<number>
  const noData = image.getGDALNoData()
  const out = new Float32Array(n * n)
  for (let i = 0; i < n * n; i++) {
    const v = raster[i]
    out[i] = Number.isNaN(v) || v === noData || v < -1e30 || v > 1e30 || v === 0 ? NaN : v
  }
  return out
}

/** Width of the blend from the LOLA heights into the fine DTM at the edges of its data, samples. */
export const FINE_FEATHER = 12
/** A fine DTM covering less than this share of a ring is not used for it. */
export const FINE_MIN_SHARE = 0.01

/**
 * Merge a fine DTM into LOLA heights, in place. The fine heights are first normalised to LOLA by removing their mean
 * difference over the samples where both exist (NAC and Panoramic Camera DTMs are controlled to LOLA, but offsets of
 * metres to tens of metres remain), then blended in with a weight that grows from 0 at the edge of the fine data to
 * 1 at FINE_FEATHER samples inside it (chamfer distance), so no step shows at the seam. Returns the share of samples
 * taken from the fine DTM (weight > 0) and the offset removed, metres.
 */
export function mergeFine(lola: Float32Array, fine: Float32Array): { share: number; offsetM: number } {
  const n = RING_N
  let sum = 0
  let count = 0
  for (let i = 0; i < n * n; i++)
    if (!Number.isNaN(fine[i])) {
      sum += fine[i] - lola[i]
      count++
    }
  if (count < FINE_MIN_SHARE * n * n) return { share: 0, offsetM: 0 }
  const offsetM = sum / count
  // chamfer distance (in samples) from each valid sample to the nearest gap; the ring's border is not a gap
  const dist = new Float32Array(n * n)
  for (let i = 0; i < n * n; i++) dist[i] = Number.isNaN(fine[i]) ? 0 : 1e6
  const D2 = Math.SQRT2
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const o = j * n + i
      if (dist[o] === 0) continue
      let d = dist[o]
      if (i > 0) d = Math.min(d, dist[o - 1] + 1)
      if (j > 0) {
        d = Math.min(d, dist[o - n] + 1)
        if (i > 0) d = Math.min(d, dist[o - n - 1] + D2)
        if (i < n - 1) d = Math.min(d, dist[o - n + 1] + D2)
      }
      dist[o] = d
    }
  for (let j = n - 1; j >= 0; j--)
    for (let i = n - 1; i >= 0; i--) {
      const o = j * n + i
      if (dist[o] === 0) continue
      let d = dist[o]
      if (i < n - 1) d = Math.min(d, dist[o + 1] + 1)
      if (j < n - 1) {
        d = Math.min(d, dist[o + n] + 1)
        if (i < n - 1) d = Math.min(d, dist[o + n + 1] + D2)
        if (i > 0) d = Math.min(d, dist[o + n - 1] + D2)
      }
      dist[o] = d
    }
  let used = 0
  for (let i = 0; i < n * n; i++) {
    if (dist[i] === 0) continue
    const w = Math.min(1, dist[i] / FINE_FEATHER)
    lola[i] += w * (fine[i] - offsetM - lola[i])
    used++
  }
  return { share: used / (n * n), offsetM }
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
  const fetchBuf = async (url: string): Promise<ArrayBuffer> => {
    const res = await fetchFn(url)
    if (!res.ok) throw new Error(`Moon Trek answered HTTP ${res.status}`)
    return res.arrayBuffer()
  }
  // the fine DTM is asked for alongside; if it fails or has no data here, the ring is LOLA alone
  const fine = spec.fine ? fetchBuf(spec.fine.url).then(decodeFine, () => null) : Promise.resolve(null)
  // and the place's photo: without it the ground is plain regolith
  const photo: Promise<Float32Array | null> = spec.photoUrl
    ? fetchFn(spec.photoUrl)
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => (b ? decodePhoto(b) : null))
        .catch(() => null)
    : Promise.resolve(null)
  const p = (async () => {
    let last: unknown = null
    for (let a = 0; a < 3; a++) {
      try {
        const lola = await decodeRing(await fetchBuf(spec.url), spec)
        const albedo = await photo
        const ring: Ring = albedo ? { ...lola, albedo } : lola
        const f = await fine.catch(() => null)
        if (!f) return ring
        const { share, offsetM } = mergeFine(ring.heights, f)
        if (share === 0) return ring
        let min = Infinity
        let max = -Infinity
        for (const v of ring.heights) {
          if (v < min) min = v
          if (v > max) max = v
        }
        return { ...ring, min, max, fineShare: share, fineOffsetM: offsetM }
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

/** Height of the curved ground below the observer's level plane at horizontal distance d: d^2 / (2 R). */
export const curvatureDrop = (d: number) => (d * d) / (2 * R_M)
