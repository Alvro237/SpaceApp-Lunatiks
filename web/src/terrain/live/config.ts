/**
 * Live terrain levels: tiles that are not files on our host but are read on demand from NASA servers while the
 * user zooms, wherever they give more detail than the static tileset (tileset.json: 960 m everywhere, down to
 * 60 m inside the 80 m DEM square).
 *
 * Two kinds of source:
 * - 'cog': LOLA DEMs that NASA PGDA publishes as Cloud Optimized GeoTIFFs (512 x 512 float32 blocks with
 *   overviews). The worker reads only the blocks under a tile with HTTP Range requests, through a proxy that adds
 *   the CORS header PGDA does not send (src/proxy/pgdaProxy.ts), and samples the vertices itself (sample.ts).
 * - 'trek': LOLA DEMs behind NASA Moon Trek's ArcGIS ImageServer (JPL), which sends CORS headers itself. Its
 *   exportImage cuts a float32 GeoTIFF of exactly the tile's 257 x 257 vertices (the box is widened by half a cell
 *   so pixel centres fall on the vertices), resampled bilinearly on the server.
 * Both kinds are cached in the browser (blockStore.ts).
 *
 * A level is added under a tile only where its four children are not already static and the parent lies inside a
 * source of that level, so the quadtree's "all four children exist" rule holds. Within a level the first listed
 * source that contains the parent is used; sources are listed finest first. If a source fails, the tile's parent
 * stays on screen.
 *
 * Sources (header values read on 2026-11-14). All are float32 metres above the 1737.4 km sphere in the LOLA south
 * polar stereographic projection. Measured against the catalogue's groundHeightM at the terrain sites they cover
 * (max |difference|): PGDA 10 m 0.05 m (12 sites), PGDA 20 m 0.61 m (12), Trek 5 m 0.86 m (4), Trek 30 m 4.70 m
 * (12), Trek 100 m 6.56 m (13; Cabeus, on a steep wall). Neighbouring Trek tiles share bit-identical edges
 * (257 of 257 values, measured).
 */
import { type TileKey, type Tileset, children, keyOf, parseKey, tileBounds } from '../tileset'

export interface LiveSource {
  kind: 'cog' | 'trek'
  /** cog: path under https://pgda.gsfc.nasa.gov/data/ (and under the proxy base); trek: the ImageServer service name. */
  file: string
  pixelM: number
  /** Projected half-width of the source square, metres. */
  halfExtentM: number
}

export const PGDA_DATA_URL = 'https://pgda.gsfc.nasa.gov/data/'
export const TREK_IMAGE_SERVER = 'https://trek.nasa.gov/moon/trekarcgis/rest/services/'

/** PGDA product 90 (Barker et al.): LDEM_80S_20MPP_ADJ, 30 400 px square, and LDEM_83S_10MPP_ADJ, 43 280 px. */
export const DEM_20M: LiveSource = { kind: 'cog', file: 'LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF', pixelM: 20, halfExtentM: 304_000 }
export const DEM_10M: LiveSource = { kind: 'cog', file: 'LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF', pixelM: 10, halfExtentM: 216_400 }
/** Moon Trek LOLA south-pole DEMs (v04): 100 m to 45 S, 30 m to 75 S, 5 m to 87.5 S. */
export const TREK_100M: LiveSource = { kind: 'trek', file: 'LRO_LOLA_DEM_SPole45_100mp_v04', pixelM: 100, halfExtentM: 1_440_000 }
export const TREK_30M: LiveSource = { kind: 'trek', file: 'LRO_LOLA_DEM_SPole75_30mp_v04', pixelM: 30, halfExtentM: 457_440 }
export const TREK_5M: LiveSource = { kind: 'trek', file: 'LRO_LOLA_DEM_SPole875_5mp_v04', pixelM: 5, halfExtentM: 75_840 }

/**
 * Per level, the sources to try (finest first). z4-z6 (480-120 m cells) fill the disc outside the 80 m DEM from the
 * 100 m DEM; z7 (60 m) there comes from the 30 m DEM; z8-z10 (30-7.5 m) from PGDA's 20 m and 10 m DEMs, with the
 * 30 m DEM for the ring between the 20 m square and 75 S; z11 (3.75 m) from the 5 m DEM.
 */
export const LIVE_LEVELS: { z: number; sources: LiveSource[] }[] = [
  { z: 4, sources: [TREK_100M] },
  { z: 5, sources: [TREK_100M] },
  { z: 6, sources: [TREK_100M] },
  { z: 7, sources: [TREK_30M] },
  { z: 8, sources: [DEM_20M, TREK_30M] },
  { z: 9, sources: [DEM_10M] },
  { z: 10, sources: [DEM_10M] },
  { z: 11, sources: [TREK_5M] },
]

/** Height range assumed for a live tile before it loads (its nearest known ancestor's, widened): used for culling. */
export const LIVE_RANGE_PAD_M = 250

export interface LiveConfig {
  /** Base URL that stands for https://pgda.gsfc.nasa.gov/data/ (the proxy), ending in '/'; null = no PGDA sources. */
  proxyBase: string | null
  levels: { z: number; sources: LiveSource[] }[]
}

/**
 * From the build: VITE_PGDA_PROXY (a URL ending in '/') or '/pgda/' in development (Vite proxy) enables the PGDA
 * sources; Moon Trek needs no proxy and is always on. 'off' turns every live level off.
 */
export function liveConfigFromEnv(env: { DEV?: boolean; VITE_PGDA_PROXY?: string }): LiveConfig | null {
  const v = env.VITE_PGDA_PROXY?.trim()
  if (v === 'off') return null
  const base = v || (env.DEV ? '/pgda/' : '')
  const proxyBase = base ? (base.endsWith('/') ? base : `${base}/`) : null
  const levels = LIVE_LEVELS.map((l) => ({ z: l.z, sources: l.sources.filter((s) => s.kind === 'trek' || proxyBase) }))
  return { proxyBase, levels }
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
 * A copy of the tileset with the live tiles added: `levels[]` reaches the deepest live level and `height.tiles`
 * lists the four children of every tile (static or live) whose children are not static and which lies inside a
 * source of the next level. A live tile's range is its nearest known ancestor's, widened by LIVE_RANGE_PAD_M,
 * until it loads. The input is not modified.
 */
export function withLiveLevels(ts: Tileset, cfg: LiveConfig | null): LiveTiles {
  const live = new Map<string, LiveSource>()
  const levels0 = cfg?.levels.filter((l) => l.sources.length > 0) ?? []
  if (levels0.length === 0) return { tileset: ts, live }
  const tiles: Record<string, [number, number]> = { ...ts.height.tiles }
  const levels = [...ts.levels]
  const byZ = new Map(levels0.map((l) => [l.z, l.sources]))
  const maxZ = Math.max(...byZ.keys())
  while (levels.length <= maxZ) {
    const z = levels.length
    levels.push({ z, tiles: 2 ** z, cellM: levels[z - 1].cellM / 2 })
  }
  // tiles per level, static first; ranges without padding for the children's estimates
  const atZ: TileKey[][] = Array.from({ length: maxZ + 1 }, () => [])
  for (const k of Object.keys(ts.height.tiles)) {
    const t = parseKey(k)
    if (t.z <= maxZ) atZ[t.z].push(t)
  }
  const rangeOf = new Map<string, [number, number]>(Object.entries(ts.height.tiles))
  const minZ = Math.min(...byZ.keys())
  for (let z = minZ; z <= maxZ; z++) {
    const sources = byZ.get(z) ?? []
    if (sources.length === 0) continue
    for (const p of atZ[z - 1]) {
      const kids = children(p)
      if (kids.some((c) => keyOf(c) in ts.height.tiles)) continue // static children: nothing to add
      const source = sources.find((s) => insideSource(ts, p, s))
      if (!source) continue
      const [lo, hi] = rangeOf.get(keyOf(p))!
      for (const c of kids) {
        const k = keyOf(c)
        tiles[k] = [lo - LIVE_RANGE_PAD_M, hi + LIVE_RANGE_PAD_M]
        rangeOf.set(k, [lo, hi])
        live.set(k, source)
        atZ[z].push(c)
      }
    }
  }
  return { tileset: { ...ts, levels, height: { ...ts.height, tiles } }, live }
}

/**
 * Moon Trek exportImage URL for a tile: a float32 GeoTIFF whose pixel centres are the tile's vertices (the box is
 * the tile widened by half a cell on each side), deflate-compressed.
 *
 * One extra row is asked for below the tile and dropped by the client: Moon Trek fills the last row of every
 * exportImage answer with zeros (measured on 2026-11-14 for the 100, 30 and 5 m DEMs at several levels), which
 * drew walls between rows of tiles. With the extra row, rows 0..256 equal the plain answer's rows 0..255 plus the
 * real last row, and vertically neighbouring tiles share bit-identical edges (measured).
 */
export const TREK_EXTRA_ROWS = 1

export function trekTileUrl(source: LiveSource, ts: Pick<Tileset, 'extentM' | 'tileCells' | 'tileSamples' | 'levels'>, t: TileKey): string {
  const [x0, y0, x1, y1] = tileBounds(ts, t)
  const h = ts.levels[t.z].cellM / 2
  const n = ts.tileSamples
  const bbox = [x0 - h, y0 - h - TREK_EXTRA_ROWS * 2 * h, x1 + h, y1 + h].join(',')
  return (
    `${TREK_IMAGE_SERVER}${source.file}/ImageServer/exportImage?bbox=${bbox}&size=${n},${n + TREK_EXTRA_ROWS}` +
    '&format=tiff&pixelType=F32&compression=LZ77&interpolation=RSP_BilinearInterpolation&f=image'
  )
}
