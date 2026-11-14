/**
 * Worker side of the live levels: open a remote Cloud Optimized GeoTIFF once per file (through the proxy and the
 * block cache), read the pixel window under a tile and sample its vertices (sample.ts).
 */
import { type BlockedSourceOptions, type GeoTIFFImage, type RemoteSourceOptions, fromCustomClient } from 'geotiff'
import { BLOCK_BYTES, type BlockStore, IdbBlockStore, MemoryBlockStore } from './blockStore'
import { type LayerSpec, layerWindowFor, sampleLayerCells } from './layers'
import { CachedRangeClient } from './rangeClient'
import { type DemGrid, type TileGeometry, sampleTile, windowFor } from './sample'
import { readTrekTile } from './trek'

export interface LiveTileRequest {
  /** cog: proxy URL of the file; trek: the tile's exportImage URL. */
  url: string
  /** cog: the PGDA path (the cache key); trek: the service name. */
  file: string
  source: 'cog' | 'trek'
  geometry: TileGeometry
  /** A colour-layer tile (live/layers.ts): cells are sampled into value + coverage bytes instead of heights. */
  layer?: Omit<LayerSpec, 'noData'>
  /**
   * Only open the file (read its header and keep it open) and answer with no samples: asked for when the map opens or
   * a layer is chosen, so the first tile does not wait for the several round trips of opening a remote GeoTIFF.
   */
  warm?: boolean
}

interface OpenDem {
  image: GeoTIFFImage
  grid: DemGrid
  client: CachedRangeClient
}

let storePromise: Promise<BlockStore> | null = null
const dems = new Map<string, Promise<OpenDem>>()

function store(): Promise<BlockStore> {
  storePromise ??= IdbBlockStore.open().then((s) => s ?? new MemoryBlockStore())
  return storePromise
}

async function openDem(url: string, file: string): Promise<OpenDem> {
  const client = new CachedRangeClient(url, file, await store())
  // geotiff.js keeps up to 256 blocks of 64 KiB (16 MiB) in memory on top of the persistent cache
  const options: RemoteSourceOptions & BlockedSourceOptions = { blockSize: BLOCK_BYTES, cacheSize: 256 }
  const tiff = await fromCustomClient(client, options)
  const image = await tiff.getImage(0)
  const [ox, oy] = image.getOrigin()
  const [px, py] = image.getResolution()
  if (Math.abs(Math.abs(py) - px) > 1e-9) throw new Error(`${file}: pixels are not square`)
  return { image, client, grid: { originX: ox, originY: oy, pixelM: px, width: image.getWidth(), height: image.getHeight() } }
}

export async function readLiveTile(
  req: LiveTileRequest,
): Promise<{ heights?: Float32Array; bytes?: Uint8Array; min?: number; max?: number; samples: number }> {
  if (req.source === 'trek') {
    const t = await readTrekTile(req.url, req.geometry, await store())
    return { ...t, samples: req.geometry.samples }
  }
  let dem = dems.get(req.url)
  if (!dem) {
    dem = openDem(req.url, req.file)
    dems.set(req.url, dem)
    dem.catch(() => dems.delete(req.url)) // a failed open is retried by the next tile
  }
  const { image, grid } = await dem
  if (req.warm) return { heights: new Float32Array(0), min: 0, max: 0, samples: 0 }
  const win = req.layer ? layerWindowFor(grid, req.geometry) : windowFor(grid, req.geometry)
  if (!win) throw new Error(`tile outside ${req.file}`)
  const rasters = await image.readRasters({
    window: [win.col0, win.row0, win.col0 + win.width, win.row0 + win.height],
    samples: [0],
    interleave: true,
  })
  if (req.layer) {
    const noData = image.getGDALNoData()
    const bytes = sampleLayerCells(rasters as unknown as ArrayLike<number>, win, grid, req.geometry, { ...req.layer, noData })
    return { bytes, samples: req.geometry.samples }
  }
  const s = sampleTile(rasters as unknown as ArrayLike<number>, win, grid, req.geometry)
  if (s.noData > 0) throw new Error(`${s.noData} vertices without data in ${req.file}`)
  return { heights: s.heights, min: s.min, max: s.max, samples: req.geometry.samples }
}
