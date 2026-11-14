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
 * Moon Trek fills the last row of every exportImage answer with zeros (as in the polar levels, terrain/live/config.ts),
 * so each request asks for one extra row below the tile, dropped by the client, except for the tiles that touch
 * the south pole, where the box would leave the globe.
 */
import { MOON_R_KM } from '../orbit'

export const TILE_CELLS = 256
/** Finest level: 1.40625° tiles, 0.0055° cells (182 cells per degree, 168 m at the equator). */
export const MAX_LEVEL = 6
/** Coarsest level asked for heights: 22.5° tiles, 2.7 km cells, finer than the 7.6 km of the shipped globe. */
export const MIN_HEIGHT_LEVEL = 2
/** Level of the photo base, always asked for in photo mode: 45° tiles, 5.3 km cells, 32 tiles. */
export const PHOTO_BASE_LEVEL = 1
/** At most this many tiles of the current level are asked for at once. */
export const MAX_VIEW_TILES = 48

export const TREK_SERVICES = 'https://trek.nasa.gov/moon/trekarcgis/rest/services/'
/** LOLA global DEM, 256 pixels per degree (118 m), float32 metres above the 1737.4 km sphere. */
export const DEM_SERVICE = 'LRO_LOLA_DEM_Global_256ppd_v06'
/** LROC WAC global mosaic, 303 pixels per degree (100 m), 8-bit reflectance as photographed. */
export const PHOTO_SERVICE = 'LRO_WAC_Mosaic_Global_303ppd_v02'

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

/** Extra rows asked for below a tile: 1, or 0 for the tiles on the south pole. */
export const extraRows = (t: DetailTile): number => (t.y === rows(t.z) - 1 ? 0 : 1)

/** Moon Trek exportImage URL for a tile: 256 cells wide, 256 + extraRows tall, bilinear on the server. */
export function trekTileUrl(kind: DetailKind, t: DetailTile): string {
  const b = tileBox(t)
  const c = b.size / TILE_CELLS
  const extra = extraRows(t)
  const bbox = [b.lon0, b.lat0 - extra * c, b.lon0 + b.size, b.lat0 + b.size].join(',')
  const format = kind === 'dem' ? 'tiff&pixelType=F32&compression=LZ77' : 'png'
  const service = kind === 'dem' ? DEM_SERVICE : PHOTO_SERVICE
  return (
    `${TREK_SERVICES}${service}/ImageServer/exportImage?bbox=${bbox}&size=${TILE_CELLS},${TILE_CELLS + extra}` +
    `&format=${format}&interpolation=RSP_BilinearInterpolation&f=image`
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
  widthPx: number
  heightPx: number
}

/** Ground metres per CSS pixel at the centre of the view. */
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
 * MAX_VIEW_TILES tiles, the next coarser level is tried. Levels below `minLevel` are not wanted at all: the
 * shipped globe is already as fine there. Returns the level used (−1 when none) and the tiles, nearest first.
 */
export function wantedTiles(v: View, minLevel: number): { level: number; tiles: DetailTile[] } {
  const halfV = v.fovDeg / 2
  const halfH = (Math.atan(Math.tan((halfV * Math.PI) / 180) * (v.widthPx / v.heightPx)) * 180) / Math.PI
  const latHalf = groundAngle(v.distKm, halfV)
  const across = groundAngle(v.distKm, halfH)
  const cosLat = Math.cos((Math.min(89, Math.abs(v.lat)) * Math.PI) / 180)
  for (let z = levelFor(v); z >= minLevel; z--) {
    const s = tileSize(z)
    const lonHalf = Math.min(180, (across + s / 2) / cosLat)
    const tiles = tilesAround(z, v.lat, v.lon, latHalf + s / 2, lonHalf)
    if (tiles.length <= MAX_VIEW_TILES) return { level: z, tiles }
  }
  return { level: -1, tiles: [] }
}

/** Every tile of a level (the photo base). */
export function allTiles(z: number): DetailTile[] {
  const out: DetailTile[] = []
  for (let y = 0; y < rows(z); y++) for (let x = 0; x < columns(z); x++) out.push({ z, x, y })
  return out
}
