// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fromCustomClient } from 'geotiff'
import { describe, expect, it } from 'vitest'
import type { Tileset } from '../tileset'
import { children, keyOf, parseKey } from '../tileset'
import { BLOCK_BYTES, MemoryBlockStore, bytesToFree, pickVictims } from './blockStore'
import {
  DEM_10M,
  DEM_20M,
  LIVE_LEVELS,
  LIVE_RANGE_PAD_M,
  type LiveSource,
  TREK_100M,
  TREK_30M,
  TREK_5M,
  insideSource,
  liveConfigFromEnv,
  trekTileUrl,
  withLiveLevels,
} from './config'
import { CachedRangeClient, parseContentRange, parseRange } from './rangeClient'
import { type DemGrid, type TileGeometry, sampleTile, windowFor } from './sample'
import { decodeTrekTile, readTrekTile } from './trek'

const H = 983_040

/** Like the real build: z0-z3 everywhere, z4-z7 as the four children of every tile meeting the 80 m DEM square. */
function staticTileset(): Tileset {
  const tiles: Record<string, [number, number]> = {}
  const meets = (z: number, x: number, y: number) => {
    const size = (2 * H) / 2 ** z
    const x0 = -H + x * size
    const y1 = H - y * size
    return x0 < 304_000 && x0 + size > -304_000 && y1 > -304_000 && y1 - size < 304_000
  }
  for (let z = 0; z <= 3; z++) for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) tiles[`${z}/${x}/${y}`] = [0, 100]
  let parents = Object.keys(tiles).filter((k) => k.startsWith('3/')).map(parseKey)
  for (let z = 4; z <= 7; z++) {
    const next = []
    for (const p of parents) {
      if (!meets(p.z, p.x, p.y)) continue
      for (const c of children(p)) {
        tiles[keyOf(c)] = [0, 100]
        next.push(c)
      }
    }
    parents = next
  }
  return {
    format: 1,
    kind: 'preview',
    extentM: [-H, -H, H, H],
    tileCells: 256,
    tileSamples: 257,
    levels: Array.from({ length: 8 }, (_, z) => ({ z, tiles: 2 ** z, cellM: 7680 / 2 ** z })),
    height: { path: 'height/{z}/{x}/{y}.png', encoding: '', tiles, sources: [] },
    overview: { path: 'overview.png', samples: 1025, min: -9000, max: 7000 },
    layers: {},
    builtUtc: '2026-11-14T00:00:00Z',
  }
}

/** A file served by byte ranges, like PGDA (206 + Content-Range); `truncateFirst` cuts the first answer short. */
function rangeServer(bytes: Uint8Array, opts: { truncateFirst?: boolean; ignoreRange?: boolean } = {}) {
  const log: string[] = []
  let first = true
  const fetchFn = async (_url: string, init: RequestInit) => {
    const range = (init.headers as Record<string, string>).Range
    log.push(range)
    if (opts.ignoreRange) return new Response(bytes.slice(0), { status: 200 })
    const [a, b] = parseRange(range)!
    const end = Math.min(b, bytes.length - 1)
    let body = bytes.slice(a, end + 1)
    if (opts.truncateFirst && first) body = body.slice(0, body.length >> 1)
    first = false
    return new Response(body, { status: 206, headers: { 'content-range': `bytes ${a}-${end}/${bytes.length}` } })
  }
  return { fetchFn, log }
}

describe('live levels: which tiles exist', () => {
  it('adds live tiles wherever the static ones stop, finest source first, four children per parent', () => {
    const ts = staticTileset()
    expect(Object.keys(ts.height.tiles).filter((k) => k.startsWith('4/'))).toHaveLength(64)
    const { tileset, live } = withLiveLevels(ts, { proxyBase: '/pgda/', levels: LIVE_LEVELS })
    expect(tileset.levels.map((l) => l.cellM)).toEqual([7680, 3840, 1920, 960, 480, 240, 120, 60, 30, 15, 7.5, 3.75])
    const count = (z: number, src?: LiveSource) =>
      [...live].filter(([k, s]) => k.startsWith(`${z}/`) && (!src || s === src)).length
    // hand counts: z4 = the 48 z3 tiles without static children x 4 (Moon Trek 100 m covers the whole map);
    // z9 = z8 parents inside +-(216 400 - 20) m, indices 100..155 (56 per axis), x 4 = 12 544, and z10 = 4 x z9;
    // z11 = z10 parents inside +-(75 840 - 10) m, indices 473..550 (78 per axis), x 4 = 24 336
    expect(count(4, TREK_100M)).toBe(192)
    expect(count(9, DEM_10M)).toBe(12_544)
    expect(count(10, DEM_10M)).toBe(50_176)
    expect(count(11, TREK_5M)).toBe(24_336)
    // z8 inside the 20 m square comes from PGDA (38^2 static z7 parents x 4, as before), the ring from Trek 30 m
    expect(count(8, DEM_20M)).toBe(5776)
    expect(count(8, TREK_30M)).toBeGreaterThan(0)
    expect(count(7)).toBe(count(7, TREK_30M))
    // brute force: every listed tile has its three siblings, lies inside its source, and no live tile is static
    const bad: string[] = []
    for (const [k, src] of live) {
      const t = parseKey(k)
      const p = { z: t.z - 1, x: t.x >> 1, y: t.y >> 1 }
      if (k in ts.height.tiles || !insideSource(ts, p, src) || !children(p).every((c) => keyOf(c) in tileset.height.tiles)) bad.push(k)
    }
    expect(bad).toEqual([])
    expect(tileset.height.tiles['8/90/90']).toEqual([-LIVE_RANGE_PAD_M, 100 + LIVE_RANGE_PAD_M])
    // the input is not modified
    expect(ts.levels).toHaveLength(8)
  }, 30_000)

  it('keeps Moon Trek without a proxy and drops the PGDA sources', () => {
    const cfg = liveConfigFromEnv({ DEV: false })!
    expect(cfg.proxyBase).toBeNull()
    const { live } = withLiveLevels(staticTileset(), cfg)
    expect([...live.values()].every((s) => s.kind === 'trek')).toBe(true)
    expect([...live.keys()].some((k) => k.startsWith('9/'))).toBe(false) // z9-z10 need the PGDA 10 m DEM
  })

  it('is off without a proxy in production and on in development', () => {
    const ts = staticTileset()
    expect(withLiveLevels(ts, null).tileset).toBe(ts)
    expect(liveConfigFromEnv({ DEV: true })?.proxyBase).toBe('/pgda/')
    expect(liveConfigFromEnv({ DEV: true, VITE_PGDA_PROXY: 'off' })).toBeNull()
    expect(liveConfigFromEnv({ DEV: false, VITE_PGDA_PROXY: 'https://p.example.workers.dev' })?.proxyBase).toBe('https://p.example.workers.dev/')
  })
})

describe('live levels: sampling a DEM window', () => {
  // hand-worked: a plane h = 1000 + 0.5 c - 0.25 r in pixel coordinates; bilinear reproduces a plane exactly
  const dem: DemGrid = { originX: -5500, originY: 5500, pixelM: 10, width: 1100, height: 1100 }
  const plane = (fx: number, fy: number) => 1000 + 0.5 * fx - 0.25 * fy
  const geom = (tx: number, ty: number): TileGeometry => ({
    i0: tx * 256,
    j0: ty * 256,
    extentX0: -H,
    extentY1: H,
    cellM: 7.5,
    samples: 257,
  })
  const raster = (w: { col0: number; row0: number; width: number; height: number }) => {
    const a = new Float32Array(w.width * w.height)
    for (let r = 0; r < w.height; r++) for (let c = 0; c < w.width; c++) a[r * w.width + c] = plane(w.col0 + c, w.row0 + r)
    return a
  }

  it('reproduces the plane at every vertex and finds the right window', () => {
    // tile (510, 510) of z10 spans x -3840..-1920 m, y 1920..3840 m
    const g = geom(510, 510)
    const win = windowFor(dem, g)!
    // first vertex x = -3840: fx = (-3840 + 5500) / 10 - 0.5 = 165.5; last x = -1920: fx = 357.5
    expect(win).toEqual({ col0: 165, row0: 165, width: 194, height: 194 })
    const s = sampleTile(raster(win), win, dem, g)
    expect(s.noData).toBe(0)
    expect(s.heights[0]).toBeCloseTo(plane(165.5, 165.5), 4)
    const n = 257
    for (const [i, j] of [[0, 0], [256, 0], [0, 256], [128, 77], [256, 256]]) {
      const fx = (-H + (510 * 256 + i) * 7.5 + 5500) / 10 - 0.5
      const fy = (5500 - (H - (510 * 256 + j) * 7.5)) / 10 - 0.5
      expect(s.heights[j * n + i]).toBeCloseTo(plane(fx, fy), 3)
    }
    expect(s.min).toBeCloseTo(plane(165.5, 357.5), 3)
    expect(s.max).toBeCloseTo(plane(357.5, 165.5), 3)
  })

  it('gives neighbouring tiles identical shared edges', () => {
    const a = geom(510, 510)
    const b = geom(511, 510)
    const wa = windowFor(dem, a)!
    const wb = windowFor(dem, b)!
    const sa = sampleTile(raster(wa), wa, dem, a).heights
    const sb = sampleTile(raster(wb), wb, dem, b).heights
    for (let j = 0; j < 257; j++) expect(sa[j * 257 + 256]).toBe(sb[j * 257])
  })

  it('reports no-data pixels and tiles outside the DEM', () => {
    const g = geom(510, 510)
    const win = windowFor(dem, g)!
    const r = raster(win)
    r[10 * win.width + 10] = NaN
    expect(sampleTile(r, win, dem, g).noData).toBeGreaterThan(0)
    expect(windowFor(dem, geom(500, 510))).toBeNull()
  })
})

describe('persistent cache: eviction rule', () => {
  it('frees nothing up to 45 % of the quota, then down to 35 %', () => {
    expect(bytesToFree(45, 100)).toBe(0)
    expect(bytesToFree(50, 100)).toBe(15)
    expect(bytesToFree(90, 100)).toBe(55)
    expect(bytesToFree(10, 0)).toBe(0)
  })

  it('deletes the least recently used blocks first', () => {
    const entries = [
      { key: 'c', size: 10, lastUsed: 30 },
      { key: 'a', size: 10, lastUsed: 10 },
      { key: 'b', size: 10, lastUsed: 20 },
    ]
    expect(pickVictims(entries, 15)).toEqual(['a', 'b'])
    expect(pickVictims(entries, 0)).toEqual([])
  })
})

describe('range client', () => {
  const file = new Uint8Array(200_000).map((_, i) => (i * 7) & 0xff)

  it('parses ranges', () => {
    expect(parseRange('bytes=0-99')).toEqual([0, 99])
    expect(parseRange('bytes=0-99,200-299')).toBeNull()
    expect(parseContentRange('bytes 0-99/1000')).toEqual({ start: 0, end: 99, total: 1000 })
  })

  it('returns the asked bytes, caches whole blocks and reads them back without the network', async () => {
    const store = new MemoryBlockStore()
    const srv = rangeServer(file)
    const client = new CachedRangeClient('/pgda/f.tif', 'f.tif', store, srv.fetchFn)
    const res = await client.request({ headers: { Range: 'bytes=60000-140000' } })
    expect(res.status).toBe(206)
    expect(res.getHeader('content-range')).toBe('bytes 60000-140000/200000')
    expect(new Uint8Array(await res.getData())).toEqual(file.slice(60000, 140001))
    expect(srv.log).toEqual([`bytes=0-${3 * BLOCK_BYTES - 1}`]) // blocks 0-2 in one request
    expect(store.blocks.size).toBe(3)
    const again = await client.request({ headers: { Range: 'bytes=70000-80000' } })
    expect(new Uint8Array(await again.getData())).toEqual(file.slice(70000, 80001))
    expect(srv.log).toHaveLength(1)
    // a new client (a new page load) with the same store needs no network either
    const fresh = new CachedRangeClient('/elsewhere/f.tif', 'f.tif', store, srv.fetchFn)
    await fresh.request({ headers: { Range: 'bytes=0-100' } })
    expect(srv.log).toHaveLength(1)
  })

  it('clips at the end of the file', async () => {
    const srv = rangeServer(file)
    const client = new CachedRangeClient('u', 'f', new MemoryBlockStore(), srv.fetchFn)
    const res = await client.request({ headers: { Range: 'bytes=196000-262143' } })
    expect(res.getHeader('content-range')).toBe('bytes 196000-199999/200000')
    expect(new Uint8Array(await res.getData())).toEqual(file.slice(196000))
  })

  it('retries a truncated answer and refuses a full-file answer', async () => {
    const srv = rangeServer(file, { truncateFirst: true })
    const client = new CachedRangeClient('u', 'f', null, srv.fetchFn)
    const res = await client.request({ headers: { Range: 'bytes=0-999' } })
    expect(new Uint8Array(await res.getData())).toEqual(file.slice(0, 1000))
    expect(client.counters.retries).toBe(1)
    const full = new CachedRangeClient('u', 'f', null, rangeServer(file, { ignoreRange: true }).fetchFn)
    await expect(full.request({ headers: { Range: 'bytes=0-999' } })).rejects.toThrow(/ignored the Range header/)
  })
})

describe('live levels: a real Cloud Optimized GeoTIFF through geotiff.js', () => {
  it('reads a tile window of the fixture (float32, deflate, predictor 3, 512 px blocks) exactly', async () => {
    // fixture: scripts/make_cog_fixture.py, pixel (c, r) = 1000 + 0.5 c - 0.25 r, 10 m pixels from (-5500, 5500)
    const bytes = new Uint8Array(readFileSync(new URL('./__fixtures__/plane_cog.tif', import.meta.url)))
    const srv = rangeServer(bytes)
    const store = new MemoryBlockStore()
    const tiff = await fromCustomClient(new CachedRangeClient('u', 'plane', store, srv.fetchFn), { blockSize: BLOCK_BYTES } as object)
    const image = await tiff.getImage(0)
    const [ox, oy] = image.getOrigin()
    const [px] = image.getResolution()
    const dem: DemGrid = { originX: ox, originY: oy, pixelM: px, width: image.getWidth(), height: image.getHeight() }
    expect(dem).toEqual({ originX: -5500, originY: 5500, pixelM: 10, width: 1100, height: 1100 })
    const g: TileGeometry = { i0: 510 * 256, j0: 510 * 256, extentX0: -H, extentY1: H, cellM: 7.5, samples: 257 }
    const win = windowFor(dem, g)!
    const r = await image.readRasters({ window: [win.col0, win.row0, win.col0 + win.width, win.row0 + win.height], samples: [0], interleave: true })
    const px00 = (r as unknown as Float32Array)[0]
    expect(px00).toBe(1000 + 0.5 * win.col0 - 0.25 * win.row0)
    const s = sampleTile(r as unknown as ArrayLike<number>, win, dem, g)
    expect(s.noData).toBe(0)
    expect(s.heights[0]).toBeCloseTo(1000 + 0.5 * 165.5 - 0.25 * 165.5, 3)
    expect(store.blocks.size).toBeGreaterThan(0)
  })
})

describe('live levels: Moon Trek ImageServer tiles', () => {
  // fixture: a real exportImage answer of LRO_LOLA_DEM_SPole875_5mp_v04, 17 x 17 samples of 5 m (plus the extra row
  // the client asks for) centred 2 m from the catalogue's Shackleton point (x 7690, y -6402.7 m), fetched 2026-11-14
  const g: TileGeometry = { i0: 198_138, j0: 197_881, extentX0: -H, extentY1: H, cellM: 5, samples: 17 }
  const bytes = () => new Uint8Array(readFileSync(new URL('./__fixtures__/trek_shackleton_17.tif', import.meta.url))).buffer

  it('builds the exportImage box so pixel centres fall on the vertices', () => {
    const ts = staticTileset()
    const { tileset } = withLiveLevels(ts, { proxyBase: null, levels: LIVE_LEVELS })
    const url = trekTileUrl(TREK_5M, tileset, { z: 11, x: 1024, y: 1024 })
    // tile 11/1024/1024 spans x 0..960 m, y -960..0 m; cell 3.75 m, so the box is widened by 1.875 m, plus one extra
    // row of 3.75 m below (Moon Trek zeroes the last row of its answers)
    expect(url).toContain('LRO_LOLA_DEM_SPole875_5mp_v04/ImageServer/exportImage?bbox=-1.875,-965.625,961.875,1.875&size=257,258')
    expect(url).toContain('pixelType=F32')
  })

  it('decodes a real tile: heights in metres matching the catalogue at Shackleton', async () => {
    const t = await decodeTrekTile(bytes(), g)
    expect(t.heights).toHaveLength(17 * 17)
    // vertex (8, 8) sits at x 7690, y -6405 m; the catalogue gives -2788.7 m 2.3 m away; the 5 m DEM differs from
    // the catalogue by at most 0.86 m at the sites it covers
    expect(Math.abs(t.heights[8 * 17 + 8] - -2788.7)).toBeLessThan(3)
    expect(t.min).toBeLessThanOrEqual(t.max)
  })

  it('refuses a tile whose georeference does not match', async () => {
    await expect(decodeTrekTile(bytes(), { ...g, i0: g.i0 + 1 })).rejects.toThrow(/georeference/)
    await expect(decodeTrekTile(bytes(), { ...g, samples: 257 })).rejects.toThrow(/expected 257/)
  })

  it('refuses a tile with a row of zeros (the fault that drew walls between tile rows)', async () => {
    // fixture: the same answer with row 16 set to 0.0 (scripts/make_cog_fixture.py)
    const zero = new Uint8Array(readFileSync(new URL('./__fixtures__/trek_zero_row_17.tif', import.meta.url))).buffer
    await expect(decodeTrekTile(zero, g)).rejects.toThrow(/row 16 is all zeros/)
  })

  it('caches the answer and retries a failed request', async () => {
    let calls = 0
    const fetchFn = async () => {
      calls++
      return calls === 1 ? new Response('busy', { status: 503 }) : new Response(bytes(), { status: 200 })
    }
    const store = new MemoryBlockStore()
    await readTrekTile('https://trek.example/t', g, store, fetchFn)
    expect(calls).toBe(2)
    await readTrekTile('https://trek.example/t', g, store, fetchFn)
    expect(calls).toBe(2)
    expect(store.blocks.has('trek|https://trek.example/t')).toBe(true)
  })
})
