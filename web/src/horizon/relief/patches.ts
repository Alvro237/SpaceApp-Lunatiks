/**
 * Finer relief on the far ground the observer can see: the hills of the skyline.
 *
 * The rings (rings.ts) get four times coarser each time they reach four times farther, so ground at a distance d is
 * drawn from cells of d / 256 to d / 64: a mountain 60 km away from 240 m to 960 m cells, where LOLA has 30 to
 * 118 m. That is enough for ground hidden behind the next ridge, and too coarse for the slopes that face the eye.
 * So the same ray casting as the horizon finds which far ground is in view: along VIS_AZ azimuths the ray walks out
 * over the rings and keeps the highest elevation angle met so far; a sample at or above it is seen. Each visible
 * sample adds to the weight of the ring tile under it (light.ts PatchGrid) the rows it raises the view by, plus a
 * little for level ground still in view. The heaviest MAX_PATCHES tiles are read again from Moon Trek at a cell
 * RING_RATIO times finer, from the finest LOLA DEM that holds them, in the place's own stereographic plane (the
 * rings' projection, so a patch lies on the lattice the next finer ring would have there). A tile is left out where
 * no DEM is finer than the ring there (PATCH_MIN_GAIN): resampling the same data adds nothing.
 *
 * The patches join the ground stack (light.ts GroundStack): the renderer and the shadows read the patch where one
 * covers a point and the ring elsewhere. The photo over them is the place's own, as on the rings (detailPhoto.ts,
 * kaguya.ts).
 */
import { PATCH_N, PATCH_PAD, PATCH_TILE, PATCH_TILES, type GroundStack, type PatchGrid, tileOf } from './light'
import { RING_N, RING_RATIO, type ReliefSource, type RingSpec, decodeHeights, heightsUrl, sourceFor } from './rings'

/** Most patches read for one place (about 0.3 MB and 1-2 s each, six at a time). */
export const MAX_PATCHES = 40
/** Azimuths cast to find the visible far ground, and the farthest ground considered, metres. */
export const VIS_AZ = 720
export const VIS_MAX_M = 250_000
/** A tile is refined only if its weight (degrees of view raised, summed over the azimuths cast) reaches this. */
export const MIN_WEIGHT = 0.2
/** Weight of a visible sample that raises nothing (level ground still in view). */
const LEVEL_WEIGHT = 0.0003
/** A patch must be at least this many times finer than its ring in real data (DEM cell against ring cell). */
export const PATCH_MIN_GAIN = 1.6

const R_M = 1_737_400

export interface PatchSpec {
  /** Cell of the ring refined, metres, and the tile: column from the west, row from the north. */
  parentCellM: number
  tc: number
  tr: number
  /** The patch's own cell, metres. */
  cellM: number
  source: ReliefSource
  url: string
  weight: number
  /** Nearest ground of the tile in view, metres from the observer (the order the patches are read in). */
  distM: number
}

export const patchKey = (p: { parentCellM: number; tc: number; tr: number }) => `${p.parentCellM}:${p.tc},${p.tr}`

/**
 * The box of a patch's samples (xMin, yMin, xMax, yMax; metres east and north of the observer): tile (tc, tr) of a
 * ring of `parentCellM` cells with PATCH_PAD patch cells more on every side.
 */
export function patchBox(parentCellM: number, tc: number, tr: number): [number, number, number, number] {
  const half = (RING_N / 2) * parentCellM
  const tile = PATCH_TILE * parentCellM
  const pad = (PATCH_PAD * parentCellM) / RING_RATIO
  const x0 = -half + tc * tile
  const y1 = half - tr * tile
  return [x0 - pad, y1 - tile - pad, x0 + tile + pad, y1 + pad]
}

/** The finest DEM for a patch and the real gain over its ring (ring's data cell over the patch's), or null if under PATCH_MIN_GAIN. */
export function patchSource(lat: number, lon: number, ring: RingSpec, tc: number, tr: number): ReliefSource | null {
  const cellM = ring.cellM / RING_RATIO
  const [x0, y0, x1, y1] = patchBox(ring.cellM, tc, tr)
  const reach = Math.hypot(Math.max(Math.abs(x0), Math.abs(x1)), Math.max(Math.abs(y0), Math.abs(y1)))
  const source = sourceFor(lat, lon, cellM, reach)
  const ringData = Math.max(ring.cellM, ring.source.demM)
  const patchData = Math.max(cellM, source.demM)
  return ringData / patchData >= PATCH_MIN_GAIN ? source : null
}

/** The far tiles worth refining, heaviest first (see the file comment). `specs`: the rings' specs (rings.ts ringSpecs). */
export function visibleFarPatches(
  stack: GroundStack,
  eyeM: number,
  specs: RingSpec[],
  lat: number,
  lon: number,
  maxPatches = MAX_PATCHES,
): PatchSpec[] {
  const weights = new Map<number, number>()
  const near = new Map<number, number>()
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
        const tile = k > 0 ? tileOf(tmp[0], tmp[1]) : -1
        if (tile >= 0) {
          const gain = best === -Infinity ? 0 : ((Math.atan(slope) - Math.atan(best)) * 180) / Math.PI
          const key = k * PATCH_TILES * PATCH_TILES + tile
          weights.set(key, (weights.get(key) ?? 0) + gain + LEVEL_WEIGHT)
          near.set(key, Math.min(near.get(key) ?? t, t))
        }
        best = slope
      }
      // steps of 2 % of the distance, no longer than the ring's cell
      t += Math.max(1, Math.min(stack.rings[k].cellM, t * 0.02))
    }
  }
  const out: PatchSpec[] = []
  for (const [key, weight] of [...weights].sort((x, y) => y[1] - x[1])) {
    if (out.length >= maxPatches || weight < MIN_WEIGHT) break
    const k = Math.floor(key / (PATCH_TILES * PATCH_TILES))
    const tile = key % (PATCH_TILES * PATCH_TILES)
    const tc = tile % PATCH_TILES
    const tr = Math.floor(tile / PATCH_TILES)
    const ring = specs.find((s) => s.cellM === stack.rings[k].cellM)
    if (!ring) continue
    const source = patchSource(lat, lon, ring, tc, tr)
    if (!source) continue
    const cellM = ring.cellM / RING_RATIO
    out.push({ parentCellM: ring.cellM, tc, tr, cellM, source, url: heightsUrl(source.file, lat, lon, patchBox(ring.cellM, tc, tr), cellM, PATCH_N), weight, distM: near.get(key) ?? 0 })
  }
  return out
}

const cache = new Map<string, Promise<PatchGrid | null>>()

/** Fetch and decode a patch once per URL (kept for the session); two tries, then null (the ring stays there). */
export function loadPatch(spec: PatchSpec, fetchFn: typeof fetch = (u, i) => fetch(u, i)): Promise<PatchGrid | null> {
  const hit = cache.get(spec.url)
  if (hit) return hit
  const p = (async (): Promise<PatchGrid | null> => {
    for (let a = 0; a < 2; a++) {
      try {
        const res = await fetchFn(spec.url)
        if (!res.ok) continue
        const { heights } = await decodeHeights(await res.arrayBuffer(), PATCH_N)
        return { cellM: spec.cellM, heights, parentCellM: spec.parentCellM, tc: spec.tc, tr: spec.tr }
      } catch {
        // tried again, then given up
      }
    }
    return null
  })()
  cache.set(spec.url, p)
  void p.then((g) => g === null && cache.delete(spec.url))
  return p
}
