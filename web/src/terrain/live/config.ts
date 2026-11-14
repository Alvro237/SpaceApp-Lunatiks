/**
 * Live terrain levels: z8-z10 (30, 15 and 7.5 m cells) read on demand from NASA's LOLA south-pole DEMs, which
 * PGDA publishes as Cloud Optimized GeoTIFFs (512 x 512 float32 blocks with overviews). The browser fetches only
 * the blocks under the tiles it draws, through a proxy that adds the CORS header PGDA does not send
 * (src/proxy/pgdaProxy.ts), and keeps them in a persistent cache (blockStore.ts).
 *
 * The static tileset (tileset.json, z0-z7, down to 60 m cells from the 80 m DEM) stays the base: the live levels
 * are added only where a whole parent tile lies inside a source, so the quadtree's "all four children exist" rule
 * holds and the rest of the map is unchanged. If the proxy or PGDA fail, a tile's load fails and its parent
 * stays on screen.
 *
 * Sources (header values read from the files on 2026-11-14; PGDA product 90, Barker et al.):
 *   LDEM_80S_20MPP_ADJ.TIF  30 400 x 30 400 px of 20 m, x and y within +-304 000 m
 *   LDEM_83S_10MPP_ADJ.TIF  43 280 x 43 280 px of 10 m, x and y within +-216 400 m
 * Both are float32 metres above the 1737.4 km sphere in the LOLA south polar stereographic projection, like the
 * 80 m DEM of the static levels. Measured at the 12 catalogue sites inside them: the 10 m DEM differs from the
 * catalogue's groundHeightM by at most 0.05 m, the 20 m DEM by at most 0.61 m.
 */
import { type TileKey, type Tileset, children, keyOf, parseKey, tileBounds } from '../tileset'

export interface LiveSource {
  /** Path under https://pgda.gsfc.nasa.gov/data/ (and under the proxy base). */
  file: string
  pixelM: number
  /** Projected half-width of the source square, metres. */
  halfExtentM: number
}

export const PGDA_DATA_URL = 'https://pgda.gsfc.nasa.gov/data/'

export const DEM_20M: LiveSource = { file: 'LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF', pixelM: 20, halfExtentM: 304_000 }
export const DEM_10M: LiveSource = { file: 'LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF', pixelM: 10, halfExtentM: 216_400 }

/** One source per level, so neighbouring tiles of a level always sample the same grid (no seams between sources). */
export const LIVE_LEVELS: { z: number; source: LiveSource }[] = [
  { z: 8, source: DEM_20M },
  { z: 9, source: DEM_10M },
  { z: 10, source: DEM_10M },
]

/** Height range assumed for a live tile before it loads (its static ancestor's range, widened): used for culling. */
export const LIVE_RANGE_PAD_M = 250

export interface LiveConfig {
  /** Base URL that stands for https://pgda.gsfc.nasa.gov/data/ (the proxy), ending in '/'. */
  proxyBase: string
  levels: { z: number; source: LiveSource }[]
}

/**
 * The proxy base from the build: VITE_PGDA_PROXY (a URL ending in '/'), '/pgda/' in development (Vite proxy),
 * nothing in a production build without it (live levels off). 'off' turns them off anywhere.
 */
export function liveConfigFromEnv(env: { DEV?: boolean; VITE_PGDA_PROXY?: string }): LiveConfig | null {
  const v = env.VITE_PGDA_PROXY?.trim()
  if (v === 'off') return null
  const base = v || (env.DEV ? '/pgda/' : '')
  if (!base) return null
  return { proxyBase: base.endsWith('/') ? base : `${base}/`, levels: LIVE_LEVELS }
}

/** Whether a tile lies inside the source with a margin of two source pixels (bilinear needs one on each side). */
export function insideSource(ts: Pick<Tileset, 'extentM'>, t: TileKey, s: LiveSource): boolean {
  const [x0, y0, x1, y1] = tileBounds(ts, t)
  const h = s.halfExtentM - 2 * s.pixelM
  return x0 >= -h && x1 <= h && y0 >= -h && y1 <= h
}

export interface LiveTiles {
  tileset: Tileset
  /** "z/x/y" of every live tile → its source. */
  live: Map<string, LiveSource>
}

/**
 * A copy of the tileset with the live levels added: `levels[]` gains their cell sizes and `height.tiles` lists
 * the four children of every tile of the level above whose parent lies inside the level's source. Each child's
 * range is the static ancestor's, widened by LIVE_RANGE_PAD_M, until the tile loads. The input is not modified.
 */
export function withLiveLevels(ts: Tileset, cfg: LiveConfig | null): LiveTiles {
  const live = new Map<string, LiveSource>()
  if (!cfg || cfg.levels.length === 0) return { tileset: ts, live }
  const tiles: Record<string, [number, number]> = { ...ts.height.tiles }
  const levels = [...ts.levels]
  const staticMaxZ = ts.levels.length - 1
  let parents = Object.keys(ts.height.tiles)
    .filter((k) => k.startsWith(`${staticMaxZ}/`))
    .map(parseKey)
  const rangeOf = new Map<string, [number, number]>(parents.map((p) => [keyOf(p), ts.height.tiles[keyOf(p)]]))
  for (const { z, source } of [...cfg.levels].sort((a, b) => a.z - b.z)) {
    if (z !== levels.length) break // levels must continue the pyramid without gaps
    const cellM = levels[levels.length - 1].cellM / 2
    levels.push({ z, tiles: 2 ** z, cellM })
    const next: TileKey[] = []
    for (const p of parents) {
      if (!insideSource(ts, p, source)) continue
      const [lo, hi] = rangeOf.get(keyOf(p))!
      for (const c of children(p)) {
        const k = keyOf(c)
        const r: [number, number] = [lo - LIVE_RANGE_PAD_M, hi + LIVE_RANGE_PAD_M]
        tiles[k] = r
        rangeOf.set(k, [lo, hi])
        live.set(k, source)
        next.push(c)
      }
    }
    parents = next
  }
  return { tileset: { ...ts, levels, height: { ...ts.height, tiles } }, live }
}
