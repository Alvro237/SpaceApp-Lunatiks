/**
 * Live tiles from NASA Moon Trek's ArcGIS ImageServer (config.ts, trekTileUrl): one request per tile returns a
 * float32 GeoTIFF whose pixel centres are the tile's vertices. The answer is checked (size, georeference, no-data)
 * and kept in the browser's block cache under its URL, so a tile seen before needs no request.
 */
import { fromArrayBuffer } from 'geotiff'
import type { BlockStore } from './blockStore'
import { TREK_EXTRA_ROWS } from './config'
import type { TileGeometry } from './sample'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Heights of a Trek tile, row 0 at the top. The image has `extraRows` more rows than the tile (config.ts,
 * TREK_EXTRA_ROWS), dropped here. Throws when the image does not match the tile, holds no-data, or has a row of
 * exact zeros among the kept ones (the Moon Trek fault the extra row works around; real terrain is never 0.0 m
 * across a whole row).
 */
export async function decodeTrekTile(
  buf: ArrayBuffer,
  g: TileGeometry,
  extraRows = TREK_EXTRA_ROWS,
): Promise<{ heights: Float32Array; min: number; max: number }> {
  const tiff = await fromArrayBuffer(buf)
  const image = await tiff.getImage(0)
  const n = g.samples
  if (image.getWidth() !== n || image.getHeight() !== n + extraRows) {
    throw new Error(`Trek tile is ${image.getWidth()} x ${image.getHeight()}, expected ${n} x ${n + extraRows}`)
  }
  const [ox, oy] = image.getOrigin()
  const [px, py] = image.getResolution()
  const ex = g.extentX0 + g.i0 * g.cellM - g.cellM / 2
  const ey = g.extentY1 - g.j0 * g.cellM + g.cellM / 2
  const tol = g.cellM * 1e-3
  if (Math.abs(ox - ex) > tol || Math.abs(oy - ey) > tol || Math.abs(px - g.cellM) > tol || Math.abs(Math.abs(py) - g.cellM) > tol) {
    throw new Error(`Trek tile georeference (${ox}, ${oy}, ${px}) differs from the tile (${ex}, ${ey}, ${g.cellM})`)
  }
  const raster = (await image.readRasters({ samples: [0], interleave: true })) as unknown as ArrayLike<number>
  const noDataValue = image.getGDALNoData()
  const heights = new Float32Array(n * n)
  let min = Infinity
  let max = -Infinity
  let noData = 0
  for (let i = 0; i < n * n; i++) {
    const v = raster[i]
    if (Number.isNaN(v) || v === noDataValue || v < -1e30 || v > 1e30) noData++
    else {
      heights[i] = v
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (noData > 0) throw new Error(`${noData} Trek samples without data`)
  for (let r = 0; r < n; r++) {
    let zero = true
    for (let c = 0; c < n && zero; c++) zero = heights[r * n + c] === 0
    if (zero) throw new Error(`Trek tile row ${r} is all zeros`)
  }
  return { heights, min, max }
}

/** Fetch (or read from the cache) and decode one Trek tile; up to `attempts` tries on a bad answer. */
export async function readTrekTile(
  url: string,
  g: TileGeometry,
  store: BlockStore | null,
  fetchFn: FetchFn = (u, i) => fetch(u, i),
  attempts = 3,
): Promise<{ heights: Float32Array; min: number; max: number }> {
  const key = `trek|${url}`
  const cached = store ? (await store.getMany([key]))[0] : undefined
  if (cached) return decodeTrekTile(cached, g)
  let last: unknown = null
  for (let a = 0; a < attempts; a++) {
    try {
      const res = await fetchFn(url)
      if (!res.ok) throw new Error(`Moon Trek answered HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      const out = await decodeTrekTile(buf, g) // checks before caching
      await store?.putMany([[key, buf]])
      return out
    } catch (e) {
      last = e
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}
