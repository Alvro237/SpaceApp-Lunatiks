/**
 * Worker side of the globe's detail tiles (grid.ts): fetch one Moon Trek exportImage answer (or read it from the
 * browser's block cache under its URL), check it and decode it.
 *
 * - 'dem': float32 GeoTIFF. Checked: size, georeference against the tile's box (origin and cell size in degrees),
 *   no no-data, and no row of exact zeros among the kept rows (the Moon Trek fault the extra row works around;
 *   real terrain is never 0.0 m across a whole row). On the south-pole tiles, which have no extra row, a last row
 *   of exact zeros is replaced by the row above it (one row of cells at the pole).
 * - 'photo': 8-bit grey PNG of the LROC WAC mosaic. Checked: size and channels. The extra row is dropped. On the
 *   tiles that touch ±180°, Moon Trek answers the edge column with zeros (measured 2026-11-14: column 0 of the
 *   tile from −180°, column 255 of the tile to 180°; the DEM does not do this); such a column is replaced by the
 *   column next to it.
 */
import { fromArrayBuffer } from 'geotiff'
import { type BlockStore, IdbBlockStore, MemoryBlockStore } from '../../terrain/live/blockStore'
import { decodePng } from '../../terrain/png'
import { type DetailKind, TILE_CELLS, type TileBox } from './grid'

type FetchFn = (url: string) => Promise<Response>

export interface GeoTileRequest {
  url: string
  kind: DetailKind
  box: TileBox
  extraRows: number
}

export type GeoTile = { kind: 'dem'; heights: Float32Array } | { kind: 'photo'; bytes: Uint8Array }

const N = TILE_CELLS

export async function decodeDemTile(buf: ArrayBuffer, box: TileBox, extraRows: number): Promise<Float32Array> {
  const tiff = await fromArrayBuffer(buf)
  const image = await tiff.getImage(0)
  if (image.getWidth() !== N || image.getHeight() !== N + extraRows) {
    throw new Error(`Trek tile is ${image.getWidth()} x ${image.getHeight()}, expected ${N} x ${N + extraRows}`)
  }
  const c = box.size / N
  const [ox, oy] = image.getOrigin()
  const [px, py] = image.getResolution()
  const tol = c * 1e-3
  const top = box.lat0 + box.size
  if (Math.abs(ox - box.lon0) > tol || Math.abs(oy - top) > tol || Math.abs(px - c) > tol || Math.abs(Math.abs(py) - c) > tol) {
    throw new Error(`Trek tile georeference (${ox}, ${oy}, ${px}) differs from the tile (${box.lon0}, ${top}, ${c})`)
  }
  const raster = (await image.readRasters({ samples: [0], interleave: true })) as unknown as ArrayLike<number>
  const noDataValue = image.getGDALNoData()
  const heights = new Float32Array(N * N)
  let noData = 0
  for (let i = 0; i < N * N; i++) {
    const v = raster[i]
    if (Number.isNaN(v) || v === noDataValue || v < -1e30 || v > 1e30) noData++
    else heights[i] = v
  }
  if (noData > 0) throw new Error(`${noData} Trek samples without data`)
  const zeroRow = (r: number) => {
    for (let k = 0; k < N; k++) if (heights[r * N + k] !== 0) return false
    return true
  }
  if (extraRows === 0 && zeroRow(N - 1)) heights.copyWithin((N - 1) * N, (N - 2) * N, (N - 1) * N)
  for (let r = 0; r < N; r++) if (zeroRow(r)) throw new Error(`Trek tile row ${r} is all zeros`)
  return heights
}

export async function decodePhotoTile(buf: ArrayBuffer, box: TileBox, extraRows: number): Promise<Uint8Array> {
  const png = await decodePng(buf)
  if (png.width !== N || png.height !== N + extraRows || png.channels !== 1) {
    throw new Error(`Trek photo tile is ${png.width} x ${png.height} x ${png.channels}, expected ${N} x ${N + extraRows} x 1`)
  }
  const out = png.data.slice(0, N * N)
  const fixEdge = (col: number, from: number) => {
    for (let r = 0; r < N; r++) if (out[r * N + col] !== 0) return
    for (let r = 0; r < N; r++) out[r * N + col] = out[r * N + from]
  }
  if (box.lon0 === -180) fixEdge(0, 1)
  if (box.lon0 + box.size === 180) fixEdge(N - 1, N - 2)
  return out
}

let storePromise: Promise<BlockStore> | null = null
function store(): Promise<BlockStore> {
  storePromise ??= IdbBlockStore.open().then((s) => s ?? new MemoryBlockStore())
  return storePromise
}

async function decode(buf: ArrayBuffer, req: GeoTileRequest): Promise<GeoTile> {
  return req.kind === 'dem'
    ? { kind: 'dem', heights: await decodeDemTile(buf, req.box, req.extraRows) }
    : { kind: 'photo', bytes: await decodePhotoTile(buf, req.box, req.extraRows) }
}

/** Fetch (or read from the cache) and decode one tile; up to `attempts` tries on a bad answer. */
export async function readGeoTile(
  req: GeoTileRequest,
  cache: BlockStore | null = null,
  fetchFn: FetchFn = (u) => fetch(u),
  attempts = 3,
): Promise<GeoTile> {
  const s = cache ?? (await store())
  const key = `trek|${req.url}`
  const cached = (await s.getMany([key]))[0]
  if (cached) return decode(cached, req)
  let last: unknown = null
  for (let a = 0; a < attempts; a++) {
    try {
      const res = await fetchFn(req.url)
      if (!res.ok) throw new Error(`Moon Trek answered HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      const out = await decode(buf, req) // checks before caching
      await s.putMany([[key, buf]])
      return out
    } catch (e) {
      last = e
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}
