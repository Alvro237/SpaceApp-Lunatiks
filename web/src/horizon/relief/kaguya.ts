/**
 * The finest real photo of the ground in view: the Kaguya (SELENE, JAXA) Terrain Camera "Ortho" mosaic on NASA
 * Moon Trek, 4096 px/deg (7.4 m) merged from the morning and evening TC mosaics with simulated vertical
 * illumination (Haruyama et al. 2008, Earth Planets Space 60, 243-255), so it holds little photographed shading and
 * reads as the ground's albedo under the light of the chosen instant. Moon Trek serves it as WMTS PNG tiles on an
 * equirectangular grid: level z has 2^(z+1) x 2^z tiles of 256 px; the finest level it answers is KZ = 10
 * (0.176° tiles, about 21 m a pixel; measured 2026-11-15 at 26.6 N 150.9 E: 36 kB, 0.7 s a tile). Near the poles it
 * is blank (89.7 S: a 206-byte tile), so it is used up to MAX_LAT and the WAC mosaic (detailPhoto.ts) beyond.
 * The mosaic is not controlled to LOLA (its catalogue entry says so): features can sit some way off the relief.
 *
 * Which tiles: the same ray casting as the horizon. Along VIS_AZ azimuths the ray walks out from the feet and keeps
 * the highest elevation angle met so far; ground at or above it is in view, and each such sample adds to the weight
 * of the Kaguya tile under it the rows it raises the view by (a hill rising above the observer, the ground at the
 * feet), plus a little for level ground still in view. The heaviest MAX_TILES are read.
 */
import type { GroundStack } from './light'
import { ALBEDO_MAX, ALBEDO_MIN, SHADOW_BYTE, decodePhoto } from './rings'

export const KAGUYA_WMTS = 'https://trek.nasa.gov/tiles/Moon/EQ/Kaguya_TCortho_Mosaic_Global_4096ppd/1.0.0/default/default028mm/'
export const KZ = 10
export const KTILE_PX = 256
/** Degrees a tile spans, and metres a pixel spans along a meridian. */
export const KTILE_DEG = 180 / 2 ** KZ
const R_M = 1_737_400
export const KPIXEL_M = (R_M * KTILE_DEG * Math.PI) / 180 / KTILE_PX
/** Highest latitude of an observer served from Kaguya (the mosaic is blank near the poles). */
export const MAX_LAT = 80
/** Most tiles read for one place (about 40 kB each, six at a time). */
export const MAX_TILES = 220
const VIS_AZ = 720
const VIS_MAX_M = 250_000
const D = Math.PI / 180

export interface KTile {
  col: number
  row: number
  weight: number
}

export const kKey = (col: number, row: number) => `${col},${row}`

/**
 * Latitude and longitude (degrees) of a point (east, north metres) of the place's own stereographic plane (scale 1
 * at the place, sphere of R_M; the projection the rings are cut in, rings.ts localStereoWkt). Written into `out`.
 */
export function planeToLatLon(lat0: number, lon0: number, x: number, y: number, out: Float64Array): void {
  const rho = Math.hypot(x, y)
  if (rho < 1e-9) {
    out[0] = lat0
    out[1] = lon0
    return
  }
  const c = 2 * Math.atan(rho / (2 * R_M))
  const sc = Math.sin(c)
  const cc = Math.cos(c)
  const s0 = Math.sin(lat0 * D)
  const c0 = Math.cos(lat0 * D)
  out[0] = Math.asin(Math.max(-1, Math.min(1, cc * s0 + (y * sc * c0) / rho))) / D
  let lon = lon0 + Math.atan2(x * sc, rho * c0 * cc - y * s0 * sc) / D
  lon = ((((lon + 180) % 360) + 360) % 360) - 180
  out[1] = lon
}

/** Fractional pixel position of (lat, lon) in the level-KZ grid: column and row counted from 180 W, 90 N. */
const gx = (lon: number) => ((lon + 180) / KTILE_DEG) * KTILE_PX
const gy = (lat: number) => ((90 - lat) / KTILE_DEG) * KTILE_PX

/** The Kaguya tiles holding the ground the eye can see, heaviest first (see the file comment). */
export function visibleKaguyaTiles(stack: GroundStack, eyeM: number, lat0: number, lon0: number, maxTiles = MAX_TILES): KTile[] {
  const weights = new Map<string, KTile>()
  const tmp = new Float64Array(2)
  const ll = new Float64Array(2)
  for (let a = 0; a < VIS_AZ; a++) {
    const az = (a * 2 * Math.PI) / VIS_AZ
    const sa = Math.sin(az)
    const ca = Math.cos(az)
    let best = -Infinity
    let t = 2
    let k = 0
    while (t < VIS_MAX_M) {
      const e = t * sa
      const n = t * ca
      k = stack.locate(e, n, tmp, k)
      if (k < 0) break
      const slope = (stack.heightAt(k, tmp[0], tmp[1]) - (t * t) / (2 * R_M) - eyeM) / t
      if (slope >= best) {
        const gain = best === -Infinity ? 0 : (Math.atan(slope) - Math.atan(best)) / D
        planeToLatLon(lat0, lon0, e, n, ll)
        const col = Math.floor(gx(ll[1]) / KTILE_PX)
        const row = Math.floor(gy(ll[0]) / KTILE_PX)
        const key = kKey(col, row)
        const w = weights.get(key) ?? { col, row, weight: 0 }
        w.weight += gain + 0.002
        weights.set(key, w)
        best = slope
      }
      t += Math.max(1, Math.min(stack.rings[k].cellM, t * 0.02))
    }
  }
  return [...weights.values()].sort((x, y) => y.weight - x.weight).slice(0, maxTiles)
}

export const kaguyaTileUrl = (col: number, row: number) => `${KAGUYA_WMTS}${KZ}/${row}/${col}.png`

const cache = new Map<string, Promise<Uint8Array | null>>()

/** Fetch and decode one tile once; null where it cannot be read or is blank (no data there). */
export function loadKaguyaTile(url: string, fetchFn: typeof fetch = (u, i) => fetch(u, i)): Promise<Uint8Array | null> {
  const hit = cache.get(url)
  if (hit) return hit
  const p = fetchFn(url)
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => (b && b.size > 1000 ? decodePhoto(b, KTILE_PX) : null))
    .catch(() => null)
  cache.set(url, p)
  return p
}

/** Mean of the non-shadow bytes over all the loaded tiles (the scale of this mosaic around the place), or null. */
export function kaguyaMean(tiles: Map<string, Uint8Array>): number | null {
  let sum = 0
  let n = 0
  for (const g of tiles.values())
    for (let i = 0; i < g.length; i++)
      if (g[i] >= SHADOW_BYTE) {
        sum += g[i]
        n++
      }
  return n > 0 ? sum / n : null
}

/**
 * Albedo at a plane point (east, north metres) from the loaded tiles: bilinear byte / mean, clamped as the rings'
 * photo; NaN where no tile is loaded or the tile has no data there.
 */
export function kaguyaSampler(tiles: Map<string, Uint8Array>, mean: number, lat0: number, lon0: number): (e: number, n: number) => number {
  const inv = 1 / mean
  const ll = new Float64Array(2)
  return (e, n) => {
    planeToLatLon(lat0, lon0, e, n, ll)
    const fx = gx(ll[1]) - 0.5
    const fy = gy(ll[0]) - 0.5
    const col = Math.floor((fx + 0.5) / KTILE_PX)
    const row = Math.floor((fy + 0.5) / KTILE_PX)
    const g = tiles.get(kKey(col, row))
    if (!g) return NaN
    const px = Math.min(KTILE_PX - 1.001, Math.max(0, fx - col * KTILE_PX))
    const py = Math.min(KTILE_PX - 1.001, Math.max(0, fy - row * KTILE_PX))
    const i = Math.floor(px)
    const j = Math.floor(py)
    const u = px - i
    const v = py - j
    const o = j * KTILE_PX + i
    const b = (g[o] * (1 - u) + g[o + 1] * u) * (1 - v) + (g[o + KTILE_PX] * (1 - u) + g[o + KTILE_PX + 1] * u) * v
    if (b < SHADOW_BYTE) return NaN
    return Math.min(ALBEDO_MAX, Math.max(ALBEDO_MIN, b * inv))
  }
}
