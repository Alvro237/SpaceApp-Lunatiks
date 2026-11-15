/**
 * The real photo of the far ground the observer can see, at the LROC WAC mosaic's own 100 m.
 *
 * The rings (rings.ts) carry the mosaic over their own cells, so beyond the first rings it is coarser than the
 * mosaic (240 m to 3.8 km a sample) and a mountain wall tens of kilometres away is a blur. Here the same ray
 * casting as the horizon finds which far ground is visible from the eye: along VIS_AZ azimuths the ray walks out
 * over the stack and keeps the highest elevation angle met so far; a sample at or above it is seen (a rising wall,
 * or level ground still in view), one below it is hidden behind nearer ground. Each visible sample beyond the rings
 * already finer than the mosaic adds to the weight of the detail tile under it, more for the rows it raises the
 * skyline by. The heaviest MAX_TILES tiles are read from Moon Trek: TILE_PX x TILE_PX grey JPEGs at TILE_CELL_M,
 * cut on a grid of TILE_M squares in the place's own stereographic plane (tile 0, 0 centred on the observer), the
 * same projection and mosaic as the rings' photos.
 */
import type { GroundStack } from './light'
import { ALBEDO_MAX, ALBEDO_MIN, decodePhoto, photoBoxUrl, photoService, ringHalf } from './rings'

export const TILE_PX = 512
export const TILE_CELL_M = 100
export const TILE_M = TILE_PX * TILE_CELL_M
/** Most detail tiles read for one place (about 60-100 kB and 1 s each, six at a time). */
export const MAX_TILES = 48
/** Azimuths cast to find the visible far ground. */
export const VIS_AZ = 720
/** Farthest ground considered, metres (the horizon masks are traced to 250 km). */
export const VIS_MAX_M = 250_000

const R_M = 1_737_400

export interface DetailTile {
  ix: number
  iy: number
  weight: number
}

export const tileKey = (ix: number, iy: number) => `${ix},${iy}`
/** Index of the tile holding a plane coordinate (metres east or north of the observer). */
export const tileIndex = (v: number) => Math.floor(v / TILE_M + 0.5)

/** Distance from which the rings' photo is coarser than the mosaic: the half-width of the last ring of cells <= TILE_CELL_M. */
export function detailFromM(stack: GroundStack): number {
  let from = 0
  for (const r of stack.rings) if (r.cellM <= TILE_CELL_M) from = Math.max(from, ringHalf(r.cellM))
  return from
}

/** The far tiles the eye can see, heaviest first (see the file comment). */
export function visibleFarTiles(stack: GroundStack, eyeM: number, maxTiles = MAX_TILES): DetailTile[] {
  const fromM = detailFromM(stack)
  const weights = new Map<string, DetailTile>()
  const tmp = new Float64Array(2)
  for (let a = 0; a < VIS_AZ; a++) {
    const az = (a * 2 * Math.PI) / VIS_AZ
    const sa = Math.sin(az)
    const ca = Math.cos(az)
    let best = -Infinity
    let t = 5
    let k = 0
    while (t < VIS_MAX_M) {
      const e = t * sa
      const n = t * ca
      k = stack.locate(e, n, tmp, k)
      if (k < 0) break
      const slope = (stack.heightAt(k, tmp[0], tmp[1]) - (t * t) / (2 * R_M) - eyeM) / t
      if (slope >= best) {
        if (t >= fromM) {
          const gain = best === -Infinity ? 0 : Math.atan(slope) - Math.atan(best)
          const ix = tileIndex(e)
          const iy = tileIndex(n)
          const key = tileKey(ix, iy)
          const w = weights.get(key) ?? { ix, iy, weight: 0 }
          // rows raised count most; level ground still in view counts a little
          w.weight += (gain * 180) / Math.PI + 0.002
          weights.set(key, w)
        }
        best = slope
      }
      // steps of 2 % of the distance, no longer than the ring's cell
      t += Math.max(1, Math.min(stack.rings[k].cellM, t * 0.02))
    }
  }
  return [...weights.values()].sort((x, y) => y.weight - x.weight).slice(0, maxTiles)
}

/** exportImage URL of a detail tile: the polar mosaic where the whole square out to it lies inside, else the global one. */
export function detailTileUrl(lat: number, lon: number, ix: number, iy: number): string {
  const x0 = ix * TILE_M - TILE_M / 2
  const y0 = iy * TILE_M - TILE_M / 2
  const reach = Math.max(Math.abs(ix), Math.abs(iy)) * TILE_M + TILE_M / 2
  return photoBoxUrl(photoService(lat, lon, reach / 256), lat, lon, [x0, y0, x0 + TILE_M, y0 + TILE_M], TILE_PX)
}

const cache = new Map<string, Promise<Uint8Array | null>>()

/** Fetch and decode one detail tile once per URL; null where it cannot be read. */
export function loadDetailTile(url: string, fetchFn: typeof fetch = (u, i) => fetch(u, i)): Promise<Uint8Array | null> {
  const hit = cache.get(url)
  if (hit) return hit
  const p = fetchFn(url)
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => (b ? decodePhoto(b, TILE_PX) : null))
    .catch(() => null)
  cache.set(url, p)
  return p
}

/**
 * Albedo at a plane point from the loaded tiles (bilinear, byte / mean clamped as rings.ts photoAlbedo), or NaN
 * where no tile is loaded. Row 0 of a tile is its north edge.
 */
export function detailSampler(tiles: Map<string, Uint8Array>, mean: number): (e: number, n: number) => number {
  const inv = 1 / mean
  return (e, n) => {
    const ix = tileIndex(e)
    const iy = tileIndex(n)
    const g = tiles.get(tileKey(ix, iy))
    if (!g) return NaN
    const fx = Math.min(TILE_PX - 1.001, Math.max(0, (e - (ix * TILE_M - TILE_M / 2)) / TILE_CELL_M - 0.5))
    const fy = Math.min(TILE_PX - 1.001, Math.max(0, (iy * TILE_M + TILE_M / 2 - n) / TILE_CELL_M - 0.5))
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    const u = fx - i
    const v = fy - j
    const o = j * TILE_PX + i
    const b = (g[o] * (1 - u) + g[o + 1] * u) * (1 - v) + (g[o + TILE_PX] * (1 - u) + g[o + TILE_PX + 1] * u) * v
    return Math.min(ALBEDO_MAX, Math.max(ALBEDO_MIN, b * inv))
  }
}
