/**
 * Detail tiles of the globe: a latitude/longitude grid of square tiles (in degrees) that are read live from NASA
 * Moon Trek's global layers while the user zooms, on top of the 4 pixels-per-degree LOLA heights the globe ships
 * with (data/globe).
 *
 * Grid: level z has tiles of SIZE(z) = 90 / 2^z degrees, 4·2^z columns from longitude −180 east and 2·2^z rows
 * from latitude 90 south. Tile (z, x, y) covers longitude [−180 + x·S, −180 + (x+1)·S) and latitude
 * (90 − (y+1)·S, 90 − y·S]. Each tile is 256 × 256 cells, cell-centred (pixel-is-area): cell (i, j) is centred at
 * longitude lon0 + (i + 0.5)·c and latitude lat1 − (j + 0.5)·c, c = S / 256. Boxes never cross ±180° or ±90°, which
 * the Moon Trek ImageServer does not answer for (a request crossing 180° timed out, measured 2026-11-14).
 *
 * Heights come from the ImageServer's exportImage (float32 GeoTIFF, cut on request), from one of three LOLA DEMs by
 * where the tile is (demSource; measured 2026-11-14):
 * - between 45° S and 45° N, the global 256 px/deg v06 DEM (about 1.3 s for fine tiles, 2-5 s for 11-22° tiles).
 *   The global 128 px/deg v04 DEM is faster but its gaps between LOLA tracks show as north-south bands near the
 *   equator, so it is not used;
 * - south of 45° S and north of 45° N, the 100 m polar DEMs in geographic form (`..._100mp_v04_EQ`): about 1.3 s at
 *   every level, and dense there, where the global DEM answers large polar tiles in 5-60 s or HTTP 500. They return
 *   the stored value, half-metres (DN × 0.5 = metres: 5.6-22.5° tile means then within 15 m of LDEM_16).
 * All are metres above the 1737.4 km sphere. Every DEM answer is asked for as 16-bit integers in half-metres, which
 * is a third to a half of the bytes of float32 (the downloads, not Moon Trek's time, were what limited loading): the
 * polar DEMs store half-metres already; the global DEM is doubled on the server first (an Arithmetic rendering rule;
 * at most 0.25 m from its float32 answer, measured; heights of −9.1 to +10.8 km fit in 16 bits). Moon Trek
 * fills the last row of every exportImage answer with zeros (as in the polar levels, terrain/live/config.ts), so
 * each DEM request asks for one extra row below the tile, dropped by the client, except for the tiles that touch
 * the south pole, where the box would leave the globe.
 *
 * The photo comes from Moon Trek's WMTS cache of the same mosaic: pre-cut 256 px JPEG tiles (about 0.85 s each,
 * measured 2026-11-14) on the same grid, WMTS matrix z + 1, row y, column x (top-left corner 180° W 90° N,
 * 2^(n+1) × 2^n tiles at matrix n). Unlike exportImage they have no rows or columns of zeros (checked at ±180° and at
 * the pole).
 */
import { MOON_R_KM } from '../orbit'

export const TILE_CELLS = 256
/**
 * Finest level: 0.703° tiles, 0.00275° cells (364 cells per degree, 83 m), about the sources' own resolution
 * (WAC mosaic 100 m, polar DEMs 100 m, global DEM 118 m), for the closest zoom (50 km above the surface).
 */
export const MAX_LEVEL = 7
/** Coarsest level asked for heights: 22.5° tiles, 2.7 km cells, finer than the 7.6 km of the shipped globe. */
export const MIN_HEIGHT_LEVEL = 2
/** Level of the photo base, always asked for in photo mode: 45° tiles, 5.3 km cells, 32 tiles. */
export const PHOTO_BASE_LEVEL = 1
/** At most this many tiles of the current level are asked for at once. */
export const MAX_VIEW_TILES = 48
/** The coarse tiles asked for first are this many levels above the view's level. */
export const COARSE_STEP = 2

export const TREK_SERVICES = 'https://trek.nasa.gov/moon/trekarcgis/rest/services/'
/** LOLA global DEM, 256 px/deg (118 m), metres above the 1737.4 km sphere. */
export const DEM_SERVICE = 'LRO_LOLA_DEM_Global_256ppd_v06'
/** LOLA polar DEMs, 100 m, poleward of 45°, in geographic form; values are half-metres. */
export const DEM_SOUTH = 'LRO_LOLA_DEM_SPole45_100mp_v04_EQ'
export const DEM_NORTH = 'LRO_LOLA_DEM_NPole45_100mp_v04_EQ'
/** Latitude poleward of which a tile (wholly) is read from a polar DEM, degrees. */
export const POLAR_DEM_LAT = 45
/** LROC WAC global mosaic, 303 pixels per degree (100 m), 8-bit reflectance as photographed: WMTS tiles. */
export const PHOTO_WMTS = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/'

export type DetailKind = 'dem' | 'photo'

export interface DetailTile {
  z: number
  x: number
  y: number
}

export interface TileBox {
  /** West edge, degrees (−180..180). */
  lon0: number
  /** South edge, degrees. */
  lat0: number
  /** Side, degrees. */
  size: number
}

export const tileSize = (z: number): number => 90 / 2 ** z
export const columns = (z: number): number => 4 * 2 ** z
export const rows = (z: number): number => 2 * 2 ** z
export const keyOf = (kind: DetailKind, t: DetailTile): string => `${kind}/${t.z}/${t.x}/${t.y}`

/** Cell size of level z in metres along a meridian. */
export const cellM = (z: number): number => ((tileSize(z) / TILE_CELLS) * Math.PI) / 180 * MOON_R_KM * 1000

export function tileBox(t: DetailTile): TileBox {
  const s = tileSize(t.z)
  return { lon0: -180 + t.x * s, lat0: 90 - (t.y + 1) * s, size: s }
}

/**
 * DEM tiles from this level on are asked for four at a time: their parent's box at 512 × 512 cells, split into the
 * four children by the client. One 512 px answer takes about 1.8-2 s against 1.3 s for 256 px (2-4 s for the
 * 11-22° boxes of level 3), so the four tiles arrive about three times sooner over the browser's six connections
 * to Moon Trek (measured 2026-11-14).
 */
export const QUAD_MIN_LEVEL = 3

/** Four sibling tiles of level z: the children of tile (z − 1, x, y). */
export interface Quad {
  z: number
  x: number
  y: number
}

export const quadOf = (t: DetailTile): Quad => ({ z: t.z, x: t.x >> 1, y: t.y >> 1 })
export const quadKey = (q: Quad): string => `dem4/${q.z}/${q.x}/${q.y}`
/** The quad's tiles in the order splitQuad returns them: north-west, north-east, south-west, south-east. */
export const quadTiles = (q: Quad): DetailTile[] => [
  { z: q.z, x: 2 * q.x, y: 2 * q.y },
  { z: q.z, x: 2 * q.x + 1, y: 2 * q.y },
  { z: q.z, x: 2 * q.x, y: 2 * q.y + 1 },
  { z: q.z, x: 2 * q.x + 1, y: 2 * q.y + 1 },
]
export const quadBox = (q: Quad): TileBox => tileBox({ z: q.z - 1, x: q.x, y: q.y })
/** Extra rows below a quad's answer: 1, or 0 for the quads on the south pole. */
export const quadExtraRows = (q: Quad): number => (q.y === rows(q.z - 1) - 1 ? 0 : 1)

/** Extra rows below a tile in the answer: 1 for DEM tiles (0 on the south pole), 0 for photo tiles. */
export const extraRows = (kind: DetailKind, t: DetailTile): number => (kind === 'photo' || t.y === rows(t.z) - 1 ? 0 : 1)

/** The DEM a tile is read from, and the factor from its 16-bit answer to metres (all half-metres). */
export function demSource(t: DetailTile): { service: string; scale: number } {
  const b = tileBox(t)
  if (b.lat0 + b.size <= -POLAR_DEM_LAT) return { service: DEM_SOUTH, scale: 0.5 }
  if (b.lat0 >= POLAR_DEM_LAT) return { service: DEM_NORTH, scale: 0.5 }
  return { service: DEM_SERVICE, scale: 0.5 }
}

/** Server-side ×2 of the global DEM (float32 metres), so its 16-bit answer is in half-metres like the polar DEMs. */
const DOUBLE_RULE = encodeURIComponent(
  JSON.stringify({ rasterFunction: 'Arithmetic', rasterFunctionArguments: { Raster: '$$', Raster2: 2, Operation: 3 }, outputPixelType: 'F32' }),
)

/**
 * URL of a tile. DEM: exportImage, 256 cells wide and 256 + extraRows tall, bilinear on the server. Photo: the WMTS
 * tile of the same box.
 */
export function trekTileUrl(kind: DetailKind, t: DetailTile): string {
  if (kind === 'photo') return `${PHOTO_WMTS}${t.z + 1}/${t.y}/${t.x}.jpg`
  return demUrl(demSource(t).service, tileBox(t), TILE_CELLS, extraRows(kind, t))
}

/** exportImage URL of a quad: the parent's box at 512 × (512 + extra) cells, from the parent's DEM. */
export function quadUrl(q: Quad): string {
  return demUrl(demSource({ z: q.z - 1, x: q.x, y: q.y }).service, quadBox(q), 2 * TILE_CELLS, quadExtraRows(q))
}

function demUrl(service: string, b: TileBox, cells: number, extra: number): string {
  const c = b.size / cells
  const bbox = [b.lon0, b.lat0 - extra * c, b.lon0 + b.size, b.lat0 + b.size].join(',')
  const rule = service === DEM_SERVICE ? `&renderingRule=${DOUBLE_RULE}` : ''
  return (
    `${TREK_SERVICES}${service}/ImageServer/exportImage?bbox=${bbox}&size=${cells},${cells + extra}` +
    `&format=tiff&pixelType=S16&compression=LZ77&interpolation=RSP_BilinearInterpolation${rule}&f=image`
  )
}

/** The tile of level z that holds a point. */
export function tileAt(z: number, lat: number, lon: number): DetailTile {
  const s = tileSize(z)
  const x = Math.floor((((((lon + 180) % 360) + 360) % 360)) / s) % columns(z)
  const y = Math.min(rows(z) - 1, Math.max(0, Math.floor((90 - lat) / s)))
  return { z, x, y }
}

/**
 * Central angle (degrees) between the view's centre and the ground seen at `angleDeg` off the camera axis, for a
 * camera at `distKm` from the Moon's centre looking at it; the horizon's angle when that ray misses the Moon.
 */
export function groundAngle(distKm: number, angleDeg: number, r = MOON_R_KM): number {
  const a = (angleDeg * Math.PI) / 180
  const disc = r * r - distKm * distKm * Math.sin(a) ** 2
  if (disc < 0 || a >= Math.PI / 2) return (Math.acos(Math.min(1, r / distKm)) * 180) / Math.PI
  const t = distKm * Math.cos(a) - Math.sqrt(disc)
  return (Math.asin(Math.min(1, (t * Math.sin(a)) / r)) * 180) / Math.PI
}

export interface View {
  lat: number
  lon: number
  /** Camera distance from the Moon's centre, km. */
  distKm: number
  fovDeg: number
  /** Size of the view in device pixels (CSS pixels × devicePixelRatio, so a high-density screen gets finer tiles). */
  widthPx: number
  heightPx: number
}

/** Ground metres per device pixel at the centre of the view. */
export function metresPerPixel(v: View): number {
  return (2 * (v.distKm - MOON_R_KM) * 1000 * Math.tan(((v.fovDeg / 2) * Math.PI) / 180)) / v.heightPx
}

/** Level whose cells are closest to one screen pixel at the view's centre (log scale), clamped to 0..MAX_LEVEL. */
export function levelFor(v: View): number {
  return Math.max(0, Math.min(MAX_LEVEL, Math.round(Math.log2(cellM(0) / metresPerPixel(v)))))
}

/** Tiles of level z that meet the box lat ± latHalf, lon ± lonHalf (degrees), nearest to the centre first. */
export function tilesAround(z: number, lat: number, lon: number, latHalf: number, lonHalf: number): DetailTile[] {
  const s = tileSize(z)
  const y0 = Math.max(0, Math.floor((90 - Math.min(90, lat + latHalf)) / s))
  const y1 = Math.min(rows(z) - 1, Math.floor((90 - Math.max(-90, lat - latHalf)) / s))
  const nx = columns(z)
  const span = Math.min(nx, Math.floor((lon + lonHalf + 180) / s) - Math.floor((lon - lonHalf + 180) / s) + 1)
  const xStart = Math.floor((lon - lonHalf + 180) / s)
  const out: { t: DetailTile; d: number }[] = []
  for (let y = y0; y <= y1; y++) {
    for (let k = 0; k < span; k++) {
      const x = (((xStart + k) % nx) + nx) % nx
      const b = tileBox({ z, x, y })
      const cLat = b.lat0 + s / 2
      const dLon = ((((b.lon0 + s / 2 - lon) % 360) + 540) % 360) - 180
      out.push({ t: { z, x, y }, d: Math.hypot(cLat - lat, dLon * Math.cos((lat * Math.PI) / 180)) })
    }
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.t)
}

/**
 * The detail tiles a view wants: the level whose cells match the screen pixels, over the part of the Moon in the
 * view (the camera always looks at the Moon's centre with north up, so the view is a box in latitude and
 * longitude around the centre, plus half a tile of margin for the panels' offset). If that takes more than
 * MAX_VIEW_TILES tiles, the next coarser level is tried; at `minLevel` the MAX_VIEW_TILES nearest to the centre are
 * taken. Levels below `minLevel` are not wanted at all: the shipped globe is already as fine there.
 *
 * Returns the level used (−1 when none), `coarse`: the few tiles COARSE_STEP levels up (not below minLevel) over
 * the same box, to ask for first so the whole view sharpens quickly, then `tiles`: the view's level, nearest first.
 */
export function wantedTiles(v: View, minLevel: number): { level: number; coarse: DetailTile[]; tiles: DetailTile[] } {
  const halfV = v.fovDeg / 2
  const halfH = (Math.atan(Math.tan((halfV * Math.PI) / 180) * (v.widthPx / v.heightPx)) * 180) / Math.PI
  const latHalf = groundAngle(v.distKm, halfV)
  const across = groundAngle(v.distKm, halfH)
  const cosLat = Math.cos((Math.min(89, Math.abs(v.lat)) * Math.PI) / 180)
  for (let z = levelFor(v); z >= minLevel; z--) {
    const s = tileSize(z)
    const lonHalf = Math.min(180, (across + s / 2) / cosLat)
    const tiles = tilesAround(z, v.lat, v.lon, latHalf + s / 2, lonHalf)
    if (tiles.length > MAX_VIEW_TILES && z > minLevel) continue
    if (tiles.length > MAX_VIEW_TILES) {
      // the whole Moon or a wide polar view: even the coarsest level needs more tiles than allowed, so take the
      // ones nearest to the centre (the rest of the view keeps the shipped grid)
      return { level: z, coarse: [], tiles: tiles.slice(0, MAX_VIEW_TILES) }
    }
    const zc = Math.max(minLevel, z - COARSE_STEP)
    const coarse = zc < z ? tilesAround(zc, v.lat, v.lon, latHalf, Math.min(180, across / cosLat)) : []
    return { level: z, coarse, tiles }
  }
  return { level: -1, coarse: [], tiles: [] }
}

/** Tiles of the finest level asked for around the place in view in the close-up view (a 4 × 4 block, 2.8° wide). */
export const SHARP_TILES = 16

/**
 * The close-up view's finest tiles: the SHARP_TILES tiles of MAX_LEVEL nearest to the centre of the view, so the
 * place in view shows the sources' own resolution (83 m cells) even while the rest of the view, wider than
 * MAX_VIEW_TILES of them, keeps the level matched to the screen pixels. Empty when the view's level is already
 * MAX_LEVEL (wantedTiles asks for them then).
 */
export function sharpTiles(v: View, viewLevel: number): DetailTile[] {
  if (viewLevel >= MAX_LEVEL) return []
  const half = (Math.sqrt(SHARP_TILES) / 2) * tileSize(MAX_LEVEL)
  const cosLat = Math.cos((Math.min(89, Math.abs(v.lat)) * Math.PI) / 180)
  return tilesAround(MAX_LEVEL, v.lat, v.lon, half, Math.min(180, half / cosLat)).slice(0, SHARP_TILES)
}

/** Every tile of a level (the photo base). */
export function allTiles(z: number): DetailTile[] {
  const out: DetailTile[] = []
  for (let y = 0; y < rows(z); y++) for (let x = 0; x < columns(z); x++) out.push({ z, x, y })
  return out
}
