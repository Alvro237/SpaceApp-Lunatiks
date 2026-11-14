// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { type Tileset, tileBounds } from '../tileset'
import { LIVE_LAYERS, layerCellGeometry, layerWindowFor, liveLayerMaxZ, liveLayerSource, sampleLayerCells } from './layers'
import { windowFor } from './sample'

const H = 983_040
/** The map's extent and levels (7 680 m cells at z0, halving), as the live levels extend them. */
const ts = {
  extentM: [-H, -H, H, H] as [number, number, number, number],
  tileCells: 256,
  levels: Array.from({ length: 12 }, (_, z) => ({ z, tiles: 2 ** z, cellM: 7680 / 2 ** z })),
} satisfies Pick<Tileset, 'extentM' | 'tileCells' | 'levels'>

/** Tile of level z whose box contains the projected point (x, y), metres. */
const tileAt = (z: number, x: number, y: number) => {
  const size = (2 * H) / 2 ** z
  return { z, x: Math.floor((x + H) / size), y: Math.floor((H - y) / size) }
}

describe('live layer sources', () => {
  it('reads the 80 m slope near the pole, the 240 m slope farther out, and nothing finer than each allows', () => {
    expect(liveLayerSource('slope', ts, tileAt(6, 50_000, 50_000))?.file).toBe('LOLA_20mpp/LDSM_80S_80MPP_ADJ.TIF')
    expect(liveLayerSource('slope', ts, tileAt(5, 600_000, 0))?.file).toBe('LOLA_20mpp/LDSM_60S_240MPP_ADJ.TIF')
    expect(liveLayerSource('slope', ts, tileAt(6, 600_000, 0))).toBeNull()
    // at 480 m and 240 m cells near the pole the 240 m slope is read, not 16 or 4 times as many 80 m pixels
    expect(liveLayerSource('slope', ts, tileAt(4, 50_000, 50_000))?.pixelM).toBe(240)
    expect(liveLayerSource('slope', ts, tileAt(5, 50_000, 50_000))?.pixelM).toBe(240)
    expect(liveLayerMaxZ('slope')).toBe(6)
    expect(liveLayerMaxZ('sun_illumination')).toBe(5)
    expect(liveLayerMaxZ('no_such_layer')).toBe(-1)
  })

  it('has no live tile beyond the 65 S illumination square', () => {
    expect(liveLayerSource('sun_illumination', ts, tileAt(5, 100_000, -100_000))).not.toBeNull()
    expect(liveLayerSource('sun_illumination', ts, tileAt(5, 800_000, 0))).toBeNull()
  })

  it('uses the GeoTIFF scale and offset tags of each product', () => {
    expect(LIVE_LAYERS.sun_illumination[0].scale).toBe(4e-5)
    expect(LIVE_LAYERS.permanent_shadow[0]).toMatchObject({ scale: 2.5e-5, offset: 0.5 })
  })

  it('puts the first cell centre half a cell inside the tile corner', () => {
    const t = { z: 5, x: 20, y: 9 }
    const g = layerCellGeometry(ts, t)
    const [x0, , , y1] = tileBounds(ts as unknown as Tileset, t)
    expect(g.extentX0 + g.i0 * g.cellM).toBeCloseTo(x0 + 120, 6)
    expect(g.extentY1 - g.j0 * g.cellM).toBeCloseTo(y1 - 120, 6)
    expect(g.samples).toBe(256)
  })
})

describe('layer cell sampling', () => {
  // a 240 m source grid whose stored value is the column index × 1000, with a no-data block
  const src = { originX: -H, originY: H, pixelM: 240, width: 8192, height: 8192 }
  const t = { z: 5, x: 16, y: 16 }
  const g = layerCellGeometry(ts, t)
  const win = windowFor(src, g)!
  const raster = new Float64Array(win.width * win.height)
  for (let r = 0; r < win.height; r++) for (let c = 0; c < win.width; c++) raster[r * win.width + c] = (win.col0 + c) * 1000
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) raster[r * win.width + c] = -32768

  it('maps each cell centre onto its source pixel at equal cell and pixel size', () => {
    // 240 m cells on 240 m pixels: cell i is exactly pixel col0 + i (its centre is the pixel's centre)
    expect(win.width).toBe(257)
    const spec = { scale: 1e-6, offset: 0.5, min: 0, max: 8.692, noData: -32768 }
    const out = sampleLayerCells(raster, win, src, g, spec)
    const cell = (i: number, j: number) => [out[2 * (j * 256 + i)], out[2 * (j * 256 + i) + 1]]
    // value of cell (100, 50) = (col0 + 100) * 1000 * 1e-6 + 0.5, as a byte of 0..8.692
    const v = (win.col0 + 100) * 1000 * 1e-6 + 0.5
    expect(cell(100, 50)).toEqual([Math.round((v / 8.692) * 255), 255])
  })

  it('leaves no-data pixels out and marks cells with no valid pixel as no data', () => {
    const spec = { scale: 1e-6, offset: 0, min: 0, max: 10, noData: -32768 }
    const out = sampleLayerCells(raster, win, src, g, spec)
    expect(out[1]).toBe(0) // cell (0, 0) sits on no-data pixels
    expect(out[2 * (20 * 256 + 20) + 1]).toBe(255)
  })

  it('clips values beyond the layer range to its ends', () => {
    const spec = { scale: 1, offset: 0, min: 0, max: 1, noData: -32768 }
    const out = sampleLayerCells(raster, win, src, g, spec)
    expect(out[2 * (50 * 256 + 50)]).toBe(255)
  })
})

describe('layer cells coarser than the source pixels', () => {
  // 480 m cells (z4) on a 240 m grid aligned with the map: each cell holds exactly 2 x 2 pixels
  const src = { originX: -H, originY: H, pixelM: 240, width: 8192, height: 8192 }
  const t = { z: 4, x: 8, y: 8 }
  const g = layerCellGeometry(ts, t)
  const win = layerWindowFor(src, g)!
  const raster = new Float64Array(win.width * win.height)
  for (let r = 0; r < win.height; r++) for (let c = 0; c < win.width; c++) raster[r * win.width + c] = (win.col0 + c) * 1000
  const spec = { scale: 1e-6, offset: 0, min: 0, max: 10, noData: -32768 }
  const cell = (out: Uint8Array, i: number, j: number) => [out[2 * (j * 256 + i)], out[2 * (j * 256 + i) + 1]]
  const first = (8 * 256 * 480) / 240 // source column of the tile's first cell's first pixel

  it('covers every pixel of every cell', () => {
    expect(win.col0).toBeLessThanOrEqual(first)
    expect(win.col0 + win.width).toBeGreaterThanOrEqual(first + 512)
  })

  it('averages the 2 x 2 pixels of each cell', () => {
    const out = sampleLayerCells(raster, win, src, g, spec)
    // cell 100 holds columns first + 200 and first + 201: mean (first + 200.5) × 1000 × 1e-6, a byte of 0..10
    expect(cell(out, 100, 7)).toEqual([Math.round((((first + 200.5) * 1e-3) / 10) * 255), 255])
  })

  it('keeps a cell with half its pixels valid and drops one with fewer', () => {
    const r = new Float64Array(raster)
    const at = (row: number, col: number) => (row - win.row0) * win.width + (col - win.col0)
    const row0 = (8 * 256 * 480) / 240
    // cell (0, 0): one no-data pixel of four; cell (1, 0): three of four
    r[at(row0, first)] = -32768
    r[at(row0, first + 2)] = r[at(row0, first + 3)] = r[at(row0 + 1, first + 2)] = -32768
    const out = sampleLayerCells(r, win, src, g, spec)
    expect(cell(out, 0, 0)[1]).toBe(255)
    expect(cell(out, 0, 0)[0]).toBe(Math.round(((((first + 1) * 2 + first) / 3) * 1e-3 / 10) * 255))
    expect(cell(out, 1, 0)[1]).toBe(0)
  })
})
