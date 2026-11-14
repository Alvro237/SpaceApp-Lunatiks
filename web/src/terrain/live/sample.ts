/**
 * Heights of one live tile from a window of a DEM: the same sampling as the static fine levels
 * (web/scripts/fine_levels.py), so the contract (docs/web-tileset.md) is unchanged.
 *
 * Vertex (i, j) of tile (z, x, y) sits at X = x0 + (256 x + i) cell, Y = y1 - (256 y + j) cell (global integer
 * indices: neighbouring tiles compute their shared edge from identical numbers). The DEM is pixel-is-area: pixel
 * (c, r) is centred at X = ox + (c + 0.5) px, Y = oy - (r + 0.5) px, so the fractional pixel of a vertex is
 * fx = (X - ox) / px - 0.5, fy = (oy - Y) / px - 0.5, and the height is bilinear between the four pixels around.
 */

export interface DemGrid {
  /** Projected x of the left edge and y of the top edge of pixel (0, 0), metres. */
  originX: number
  originY: number
  pixelM: number
  width: number
  height: number
}

export interface PixelWindow {
  col0: number
  row0: number
  width: number
  height: number
}

export interface TileGeometry {
  /** Global index of the tile's first vertex column and row (tile x or y × cells per tile). */
  i0: number
  j0: number
  /** Map origin: x of the left edge and y of the top edge of the tileset extent, metres. */
  extentX0: number
  extentY1: number
  cellM: number
  samples: number
}

const vertexX = (g: TileGeometry, i: number) => g.extentX0 + (g.i0 + i) * g.cellM
const vertexY = (g: TileGeometry, j: number) => g.extentY1 - (g.j0 + j) * g.cellM

/** Pixels needed to sample every vertex of the tile; null when the tile reaches past the DEM. */
export function windowFor(dem: DemGrid, g: TileGeometry): PixelWindow | null {
  const n = g.samples - 1
  const fx0 = (vertexX(g, 0) - dem.originX) / dem.pixelM - 0.5
  const fx1 = (vertexX(g, n) - dem.originX) / dem.pixelM - 0.5
  const fy0 = (dem.originY - vertexY(g, 0)) / dem.pixelM - 0.5
  const fy1 = (dem.originY - vertexY(g, n)) / dem.pixelM - 0.5
  const col0 = Math.floor(fx0)
  const row0 = Math.floor(fy0)
  const col1 = Math.floor(fx1) + 1
  const row1 = Math.floor(fy1) + 1
  if (col0 < 0 || row0 < 0 || col1 >= dem.width || row1 >= dem.height) return null
  return { col0, row0, width: col1 - col0 + 1, height: row1 - row0 + 1 }
}

export interface SampledTile {
  heights: Float32Array
  min: number
  max: number
  /** Vertices that touched a no-data pixel (NaN); the tile is not usable when > 0. */
  noData: number
}

/** Bilinear heights at the tile's samples x samples vertices, row 0 at the top. `raster` is the window's pixels. */
export function sampleTile(raster: ArrayLike<number>, win: PixelWindow, dem: DemGrid, g: TileGeometry): SampledTile {
  const n = g.samples
  const out = new Float32Array(n * n)
  const cols = new Int32Array(n)
  const tx = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const fx = (vertexX(g, i) - dem.originX) / dem.pixelM - 0.5 - win.col0
    cols[i] = Math.floor(fx)
    tx[i] = fx - cols[i]
  }
  let min = Infinity
  let max = -Infinity
  let noData = 0
  const w = win.width
  for (let j = 0; j < n; j++) {
    const fy = (dem.originY - vertexY(g, j)) / dem.pixelM - 0.5 - win.row0
    const r = Math.floor(fy)
    const ty = fy - r
    const a = r * w
    const b = a + w
    for (let i = 0; i < n; i++) {
      const c = cols[i]
      const u = tx[i]
      const v =
        (raster[a + c] * (1 - u) + raster[a + c + 1] * u) * (1 - ty) + (raster[b + c] * (1 - u) + raster[b + c + 1] * u) * ty
      out[j * n + i] = v
      if (Number.isNaN(v)) noData++
      else {
        if (v < min) min = v
        if (v > max) max = v
      }
    }
  }
  return { heights: out, min, max, noData }
}
