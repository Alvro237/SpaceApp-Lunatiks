/**
 * Worker side of the globe's detail tiles (grid.ts): fetch one Moon Trek exportImage answer (or read it from the
 * browser's block cache under its URL), check it and decode it.
 *
 * - 'dem': float32 GeoTIFF. Checked: size, georeference against the tile's box (origin and cell size in degrees),
 *   no no-data, and no row of exact zeros among the kept rows (the Moon Trek fault the extra row works around;
 *   real terrain is never 0.0 m across a whole row). On the south-pole tiles, which have no extra row, a last row
 *   of exact zeros is replaced by the row above it (one row of cells at the pole).
 * - 'photo': 256 × 256 JPEG of the LROC WAC mosaic from Moon Trek's WMTS cache, decoded by the browser
 *   (createImageBitmap) and reduced to one grey byte per cell. Checked: size.
 *
 * Every request has a time limit (FETCH_TIMEOUT_MS): a Moon Trek request that hangs would otherwise hold one of the
 * loader's six connections for good.
 */
import { fromArrayBuffer } from 'geotiff'
import { type BlockStore, IdbBlockStore, MemoryBlockStore } from '../../terrain/live/blockStore'
import { type DetailKind, TILE_CELLS, type TileBox } from './grid'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/** Longest wait for one answer, ms (a DEM tile usually takes 1-2 s, a photo tile under 1 s). */
export const FETCH_TIMEOUT_MS = 15_000

export interface GeoTileRequest {
  url: string
  kind: DetailKind
  box: TileBox
  extraRows: number
  /** DEM: factor from the served values to metres (grid.ts, demSource). */
  scale?: number
  /** Cells per side: 256 for a tile, 512 for a quad (grid.ts, quadUrl). */
  cells?: number
}

export type GeoTile = { kind: 'dem'; heights: Float32Array } | { kind: 'photo'; bytes: Uint8Array }

/** A quad's 512 × 512 heights as its four 256 × 256 tiles: north-west, north-east, south-west, south-east. */
export function splitQuad(h: Float32Array): Float32Array[] {
  const n = TILE_CELLS
  const out = [0, 1, 2, 3].map(() => new Float32Array(n * n))
  for (let r = 0; r < 2 * n; r++) {
    const top = r < n ? 0 : 2
    const row = r % n
    out[top].set(h.subarray(r * 2 * n, r * 2 * n + n), row * n)
    out[top + 1].set(h.subarray(r * 2 * n + n, (r + 1) * 2 * n), row * n)
  }
  return out
}

export async function decodeDemTile(buf: ArrayBuffer, box: TileBox, extraRows: number, scale = 1, N = TILE_CELLS): Promise<Float32Array> {
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
    else heights[i] = v * scale
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

/** One grey byte per cell from RGBA pixels (the WMTS JPEG is grey: red = green = blue). */
export function greyFromRgba(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length / 4)
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4]
  return out
}

export async function decodePhotoTile(buf: ArrayBuffer): Promise<Uint8Array> {
  const N = TILE_CELLS
  const bitmap = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }), { colorSpaceConversion: 'none' })
  try {
    if (bitmap.width !== N || bitmap.height !== N) throw new Error(`Trek photo tile is ${bitmap.width} x ${bitmap.height}, expected ${N} x ${N}`)
    const ctx = new OffscreenCanvas(N, N).getContext('2d')
    if (!ctx) throw new Error('no 2D canvas in this worker')
    ctx.drawImage(bitmap, 0, 0)
    return greyFromRgba(ctx.getImageData(0, 0, N, N).data)
  } finally {
    bitmap.close()
  }
}

let storePromise: Promise<BlockStore> | null = null
function store(): Promise<BlockStore> {
  storePromise ??= IdbBlockStore.open().then((s) => s ?? new MemoryBlockStore())
  return storePromise
}

async function decode(buf: ArrayBuffer, req: GeoTileRequest): Promise<GeoTile> {
  return req.kind === 'dem'
    ? { kind: 'dem', heights: await decodeDemTile(buf, req.box, req.extraRows, req.scale, req.cells) }
    : { kind: 'photo', bytes: await decodePhotoTile(buf) }
}

/** Fetch (or read from the cache) and decode one tile; up to `attempts` tries, each within `timeoutMs`. */
export async function readGeoTile(
  req: GeoTileRequest,
  cache: BlockStore | null = null,
  fetchFn: FetchFn = (u, i) => fetch(u, i),
  attempts = 2,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<GeoTile> {
  const s = cache ?? (await store())
  const key = `trek|${req.url}`
  const cached = (await s.getMany([key]))[0]
  if (cached) return decode(cached, req)
  let last: unknown = null
  for (let a = 0; a < attempts; a++) {
    try {
      const res = await fetchFn(req.url, { signal: AbortSignal.timeout(timeoutMs) })
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
