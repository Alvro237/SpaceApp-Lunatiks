/**
 * Level of detail by screen-space error (plan, "Calidad según el zoom").
 *
 *   error in pixels = tile cell size × viewport height ÷ (2 × distance × tan(fov ÷ 2))
 *
 * A tile splits into its four children when its error exceeds `splitPx` (2) and goes back to its parent only
 * below `mergePx` (1.5), so tiles do not flicker at the boundary. Pure functions: unit-tested in lod.test.ts.
 */
import { type TileKey, type Tileset, children, keyOf, tileBounds } from './tileset'

export interface LodCamera {
  /** Camera position in scene kilometres. */
  pos: [number, number, number]
  viewportHeightPx: number
  fovYRad: number
  exaggeration: number
}

export interface LodOptions {
  splitPx: number
  mergePx: number
  /** Tiles that were split in the previous frame (for hysteresis). */
  previouslySplit?: ReadonlySet<string>
  /** Optional visibility test on the tile's scene-space box; false = outside the view, skipped. */
  visible?: (min: [number, number, number], max: [number, number, number]) => boolean
  maxZ?: number
}

export const DEFAULT_LOD: LodOptions = { splitPx: 2, mergePx: 1.5 }

/** Scene-space axis-aligned box of a tile, using its stored height range. */
export function tileBox(ts: Tileset, t: TileKey, exaggeration: number): [[number, number, number], [number, number, number]] {
  const [xMin, yMin, xMax, yMax] = tileBounds(ts, t)
  const range = ts.height.tiles[keyOf(t)] ?? [ts.overview.min, ts.overview.max]
  return [
    [xMin / 1000, (range[0] / 1000) * exaggeration, -yMax / 1000],
    [xMax / 1000, (range[1] / 1000) * exaggeration, -yMin / 1000],
  ]
}

export function distanceToBox(p: [number, number, number], min: number[], max: number[]): number {
  let d2 = 0
  for (let i = 0; i < 3; i++) {
    const v = p[i] < min[i] ? min[i] - p[i] : p[i] > max[i] ? p[i] - max[i] : 0
    d2 += v * v
  }
  return Math.sqrt(d2)
}

export function screenErrorPx(cellKm: number, distKm: number, cam: LodCamera): number {
  return (cellKm * cam.viewportHeightPx) / (2 * Math.max(distKm, 1e-3) * Math.tan(cam.fovYRad / 2))
}

export interface Selection {
  /** Leaf tiles to draw at the wanted detail. */
  tiles: TileKey[]
  /** Tiles split this frame: pass back as previouslySplit next frame. */
  split: Set<string>
}

/** Walk the quadtree from the root and return the leaves at the wanted detail. */
export function selectTiles(ts: Tileset, cam: LodCamera, opts: LodOptions = DEFAULT_LOD): Selection {
  const tiles: TileKey[] = []
  const split = new Set<string>()
  const maxZ = Math.min(opts.maxZ ?? Infinity, ts.levels.length - 1)

  const visit = (t: TileKey) => {
    const [min, max] = tileBox(ts, t, cam.exaggeration)
    if (opts.visible && !opts.visible(min, max)) return
    const k = keyOf(t)
    const cellKm = ts.levels[t.z].cellM / 1000
    const err = screenErrorPx(cellKm, distanceToBox(cam.pos, min, max), cam)
    const threshold = opts.previouslySplit?.has(k) ? opts.mergePx : opts.splitPx
    const kids = children(t)
    if (t.z < maxZ && err > threshold && kids.every((c) => keyOf(c) in ts.height.tiles)) {
      split.add(k)
      kids.forEach(visit)
    } else {
      tiles.push(t)
    }
  }
  visit({ z: 0, x: 0, y: 0 })
  return { tiles, split }
}

/**
 * What can be drawn now: a wanted tile when it is loaded; otherwise its parent stays on screen until all four
 * children are loaded (never a mix of a parent and its children, which would overlap).
 */
export function renderable(wanted: TileKey[], isLoaded: (k: string) => boolean): TileKey[] {
  const wantedKeys = new Set(wanted.map(keyOf))
  const deepest = Math.max(0, ...wanted.map((t) => t.z))
  const hasWantedBelow = (t: TileKey): boolean => {
    if (t.z >= deepest) return false
    return children(t).some((c) => wantedKeys.has(keyOf(c)) || hasWantedBelow(c))
  }
  const resolve = (t: TileKey): TileKey[] | null => {
    const k = keyOf(t)
    if (wantedKeys.has(k)) return isLoaded(k) ? [t] : null
    if (!hasWantedBelow(t)) return []
    const parts = children(t).map(resolve)
    if (parts.every((p) => p !== null)) return parts.flat() as TileKey[]
    return isLoaded(k) ? [t] : null
  }
  return resolve({ z: 0, x: 0, y: 0 }) ?? []
}

/** Order in which missing tiles are requested: nearest to the point the camera looks at first. */
export function byDistanceTo(ts: Tileset, target: [number, number], tiles: TileKey[]): TileKey[] {
  const centre = (t: TileKey) => {
    const [a, b, c, d] = tileBounds(ts, t)
    return Math.hypot((a + c) / 2000 - target[0], -(b + d) / 2000 - target[1])
  }
  return [...tiles].sort((p, q) => p.z - q.z || centre(p) - centre(q))
}
