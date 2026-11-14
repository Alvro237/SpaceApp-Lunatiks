/**
 * Live layer levels: finer colour-layer tiles read on demand from NASA PGDA's 240 m (and 80 m slope) products when
 * the map is zoomed in, beyond the static layer tiles (960 m cells, levels 0-3, built from the grids in data/grids).
 *
 * The products are tiled GeoTIFFs in the map's own projection (LOLA south polar stereographic, R = 1737.4 km), read
 * block by block with HTTP Range requests through the PGDA proxy, like the live DEM levels (config.ts). Without the
 * proxy (a build with no VITE_PGDA_PROXY) the live layer levels are off and the static ones stay.
 *
 * A layer tile is 256 × 256 cells, cell-centred (docs/web-tileset.md, "Layer tiles"); each cell is bilinear between
 * the valid source pixels around its centre (no-data pixels are left out and the weights renormalised; a cell whose
 * valid weight is under one half has no data), or, when the cell spans two source pixels or more, the mean of the
 * valid pixels whose centres fall in it (a cell with valid pixels over less than half of it has no data), so a 480 m
 * cell of a 240 m product is the mean of its 2 x 2 pixels rather than one of them. Values are stored as the static tiles store them: one byte between
 * the layer's min and max from tileset.json (values beyond are clipped: the 240 m and 80 m slopes reach steeper
 * angles than the 960 m range), plus coverage.
 *
 * Sources (headers and GeoTIFF scale/offset tags read on 2026-11-14; value = stored × scale + offset):
 * - Mean sunlight and mean Earth visibility, 18.6-year averages: AVGVISIB_65S_240M_201608(_EARTH).TIF, int16,
 *   scale 4e-5, 6420 px square of 240 m (south of about 65° S), 256 px tiles, no overviews.
 * - Permanent shadow: LPSR_65S_240M_201608.TIF, int16, scale 2.5e-5, offset 0.5, same grid.
 * - Slope: LDSM_80S_80MPP_ADJ.TIF (80 m, within 304 km of the pole) and LDSM_60S_240MPP_ADJ.TIF (240 m), float32
 *   degrees, COGs with overviews (PGDA product 90).
 */
import type { TileKey, Tileset } from '../tileset'
import { insideSource } from './config'
import type { DemGrid, PixelWindow, TileGeometry } from './sample'

export interface LiveLayerSource {
  /** Path under https://pgda.gsfc.nasa.gov/data/ (and under the proxy base). */
  file: string
  pixelM: number
  /** Projected half-width of the source square, metres. */
  halfExtentM: number
  /** value = stored × scale + offset, in the layer's unit. */
  scale: number
  offset: number
  /** Finest map level read from this source (its cells no finer than about the source pixel). */
  maxZ: number
  /**
   * Coarsest map level read from this source (0 when absent). The 80 m slope starts at z6: at z4 and z5 a tile would
   * read 1538 x 1538 and 770 x 770 float32 pixels (9.5 and 2.4 MB) for 480 m and 240 m cells, which the 240 m slope
   * gives with 16 and 4 times fewer pixels.
   */
  minZ?: number
}

const ILLUMINATION = { pixelM: 240, halfExtentM: 770_400, scale: 4e-5, offset: 0, maxZ: 5 }

/** Per static layer id, the live sources, finest first. */
export const LIVE_LAYERS: Record<string, LiveLayerSource[]> = {
  sun_illumination: [{ file: 'MoonIllumination/AVGVISIB_65S_240M_201608.TIF', ...ILLUMINATION }],
  earth_visibility: [{ file: 'MoonIllumination/AVGVISIB_65S_240M_201608_EARTH.TIF', ...ILLUMINATION }],
  permanent_shadow: [{ file: 'MoonIllumination/LPSR_65S_240M_201608.TIF', ...ILLUMINATION, scale: 2.5e-5, offset: 0.5 }],
  slope: [
    { file: 'LOLA_20mpp/LDSM_80S_80MPP_ADJ.TIF', pixelM: 80, halfExtentM: 304_000, scale: 1, offset: 0, minZ: 6, maxZ: 6 },
    { file: 'LOLA_20mpp/LDSM_60S_240MPP_ADJ.TIF', pixelM: 240, halfExtentM: 931_200, scale: 1, offset: 0, maxZ: 5 },
  ],
}

/** Deepest live level of a layer, or −1 when it has none. */
export function liveLayerMaxZ(id: string): number {
  return Math.max(-1, ...(LIVE_LAYERS[id] ?? []).map((s) => s.maxZ))
}

/** The source a live layer tile is read from (finest that reaches this level and contains the tile), or null. */
export function liveLayerSource(id: string, ts: Pick<Tileset, 'extentM'>, t: TileKey): LiveLayerSource | null {
  for (const s of LIVE_LAYERS[id] ?? []) {
    if (t.z >= (s.minZ ?? 0) && t.z <= s.maxZ && insideSource(ts, t, { kind: 'cog', file: s.file, pixelM: s.pixelM, halfExtentM: s.halfExtentM })) return s
  }
  return null
}

/**
 * Geometry of a layer tile's cell centres in the terms of sample.ts (whose samples are a grid of points starting at
 * the tile's corner): the grid is shifted by half a cell and has 256 points per side.
 */
export function layerCellGeometry(ts: Pick<Tileset, 'extentM' | 'tileCells' | 'levels'>, t: TileKey): TileGeometry {
  const cell = ts.levels[t.z].cellM
  return {
    i0: t.x * ts.tileCells,
    j0: t.y * ts.tileCells,
    extentX0: ts.extentM[0] + cell / 2,
    extentY1: ts.extentM[3] - cell / 2,
    cellM: cell,
    samples: ts.tileCells,
  }
}

/**
 * Source pixels a layer tile needs: every pixel whose centre lies in one of its cells, plus the pixels around each
 * cell centre for the bilinear case; null when the tile reaches past the source.
 */
export function layerWindowFor(src: DemGrid, g: TileGeometry): PixelWindow | null {
  const n = g.samples - 1
  const half = g.cellM / 2
  const left = g.extentX0 + g.i0 * g.cellM - half
  const right = g.extentX0 + (g.i0 + n) * g.cellM + half
  const top = g.extentY1 - g.j0 * g.cellM + half
  const bottom = g.extentY1 - (g.j0 + n) * g.cellM - half
  const col0 = Math.floor((left - src.originX) / src.pixelM - 0.5)
  const col1 = Math.floor((right - src.originX) / src.pixelM - 0.5) + 1
  const row0 = Math.floor((src.originY - top) / src.pixelM - 0.5)
  const row1 = Math.floor((src.originY - bottom) / src.pixelM - 0.5) + 1
  if (col0 < 0 || row0 < 0 || col1 >= src.width || row1 >= src.height) return null
  return { col0, row0, width: col1 - col0 + 1, height: row1 - row0 + 1 }
}

export interface LayerSpec {
  scale: number
  offset: number
  /** The layer's byte range, from tileset.json. */
  min: number
  max: number
  /** The source's no-data value (NaN for float sources marked with NaN). */
  noData: number | null
}

/**
 * Value + coverage bytes of a layer tile's cells (row 0 at the top): bilinear between the valid source pixels, or the
 * mean of the valid pixels inside each cell when a cell spans two source pixels or more.
 */
export function sampleLayerCells(raster: ArrayLike<number>, win: PixelWindow, src: DemGrid, g: TileGeometry, spec: LayerSpec): Uint8Array {
  const n = g.samples
  const out = new Uint8Array(n * n * 2)
  const w = win.width
  const range = spec.max - spec.min
  const valid = (v: number) => !Number.isNaN(v) && v !== spec.noData && v > -1e30 && v < 1e30
  const put = (k: number, v: number) => {
    const value = v * spec.scale + spec.offset
    out[k] = Math.max(0, Math.min(255, Math.round(((value - spec.min) / range) * 255)))
    out[k + 1] = 255
  }
  if (g.cellM >= 2 * src.pixelM) {
    // first pixel (window column or row) whose centre is at or past a cell edge, along x and down y
    const firstCol = (x: number) => Math.ceil((x - src.originX) / src.pixelM - 0.5) - win.col0
    const firstRow = (y: number) => Math.ceil((src.originY - y) / src.pixelM - 0.5) - win.row0
    const half = g.cellM / 2
    const c0 = new Int32Array(n + 1)
    for (let i = 0; i <= n; i++) c0[i] = firstCol(g.extentX0 + (g.i0 + i) * g.cellM - half)
    for (let j = 0; j < n; j++) {
      const yc = g.extentY1 - (g.j0 + j) * g.cellM
      const r0 = firstRow(yc + half)
      const r1 = firstRow(yc - half)
      for (let i = 0; i < n; i++) {
        let sum = 0
        let count = 0
        for (let r = r0; r < r1; r++) {
          for (let c = c0[i]; c < c0[i + 1]; c++) {
            const v = raster[r * w + c]
            if (valid(v)) {
              sum += v
              count++
            }
          }
        }
        if (count > 0 && 2 * count >= (r1 - r0) * (c0[i + 1] - c0[i])) put(2 * (j * n + i), sum / count)
      }
    }
    return out
  }
  for (let j = 0; j < n; j++) {
    const fy = (src.originY - (g.extentY1 - (g.j0 + j) * g.cellM)) / src.pixelM - 0.5 - win.row0
    const r = Math.floor(fy)
    const ty = fy - r
    for (let i = 0; i < n; i++) {
      const fx = (g.extentX0 + (g.i0 + i) * g.cellM - src.originX) / src.pixelM - 0.5 - win.col0
      const c = Math.floor(fx)
      const tx = fx - c
      let sum = 0
      let weight = 0
      const add = (rr: number, cc: number, wt: number) => {
        const v = raster[rr * w + cc]
        if (wt > 0 && valid(v)) {
          sum += v * wt
          weight += wt
        }
      }
      add(r, c, (1 - tx) * (1 - ty))
      add(r, c + 1, tx * (1 - ty))
      add(r + 1, c, (1 - tx) * ty)
      add(r + 1, c + 1, tx * ty)
      if (weight >= 0.5) put(2 * (j * n + i), sum / weight)
    }
  }
  return out
}
