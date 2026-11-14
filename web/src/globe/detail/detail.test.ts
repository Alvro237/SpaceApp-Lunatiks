// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MemoryBlockStore } from '../../terrain/live/blockStore'
import { MIN_DIST, MOON_R_KM } from '../orbit'
import {
  MAX_LEVEL,
  MAX_VIEW_TILES,
  COARSE_STEP,
  MIN_HEIGHT_LEVEL,
  allTiles,
  cellM,
  columns,
  extraRows,
  groundAngle,
  levelFor,
  rows,
  tileAt,
  tileBox,
  tilesAround,
  trekTileUrl,
  wantedTiles,
  demSource,
  quadBox,
  quadExtraRows,
  quadOf,
  quadTiles,
  quadUrl,
  TILE_CELLS,
  tileSize,
} from './grid'
import { CAPACITY, DetailSlots, INDEX_HEIGHT, INDEX_WIDTH, findSlot, indexRow } from './slots'
import { decodeDemTile, greyFromRgba, readGeoTile, splitQuad } from './trekGeo'

const fixture = (name: string) => {
  const b = readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

/** Tiles of the fixtures, fetched 2026-11-14: 22.5-28.125 E, 0-5.625 N (Mare Tranquillitatis, global DEM) and
 * 22.5-28.125 E, 67.5-73.125 S (south polar DEM). */
const T = { z: 4, x: 36, y: 15 }
const P = { z: 4, x: 36, y: 28 }

describe('detail grid', () => {
  it('builds the exact Moon Trek request the fixtures were fetched with', () => {
    expect(tileBox(T)).toEqual({ lon0: 22.5, lat0: 0, size: 5.625 })
    expect(trekTileUrl('dem', T)).toBe(
      'https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_Global_256ppd_v06/ImageServer/exportImage' +
        '?bbox=22.5,-0.02197265625,28.125,5.625&size=256,257&format=tiff&pixelType=S16&compression=LZ77' +
        '&interpolation=RSP_BilinearInterpolation&renderingRule=' +
        encodeURIComponent('{"rasterFunction":"Arithmetic","rasterFunctionArguments":{"Raster":"$$","Raster2":2,"Operation":3},"outputPixelType":"F32"}') +
        '&f=image',
    )
  })

  it('reads tiles poleward of 45 degrees from the polar DEMs (half-metres) and the others from the global DEM', () => {
    expect(demSource(T)).toEqual({ service: 'LRO_LOLA_DEM_Global_256ppd_v06', scale: 0.5 })
    expect(demSource(P)).toEqual({ service: 'LRO_LOLA_DEM_SPole45_100mp_v04_EQ', scale: 0.5 })
    expect(demSource({ z: 2, x: 0, y: 0 })).toEqual({ service: 'LRO_LOLA_DEM_NPole45_100mp_v04_EQ', scale: 0.5 })
    // a tile reaching across 45 S stays on the global DEM
    expect(demSource({ z: 2, x: 0, y: 5 }).service).toBe('LRO_LOLA_DEM_Global_256ppd_v06')
    expect(trekTileUrl('dem', P)).toContain('/LRO_LOLA_DEM_SPole45_100mp_v04_EQ/ImageServer/exportImage?bbox=22.5,-73.14697265625,28.125,-67.5&')
  })

  it('asks for four sibling DEM tiles at once: the parent box at 512 cells', () => {
    const q = quadOf(T)
    expect(q).toEqual({ z: 4, x: 18, y: 7 })
    expect(quadTiles(q)).toEqual([
      { z: 4, x: 36, y: 14 },
      { z: 4, x: 37, y: 14 },
      { z: 4, x: 36, y: 15 },
      { z: 4, x: 37, y: 15 },
    ])
    expect(quadTiles(q)).toContainEqual(T)
    expect(quadBox(q)).toEqual({ lon0: 22.5, lat0: 0, size: 11.25 })
    expect(quadUrl(q)).toContain('/LRO_LOLA_DEM_Global_256ppd_v06/ImageServer/exportImage?bbox=22.5,-0.02197265625,33.75,11.25&size=512,513&')
    // the quads on the south pole have no extra row; poleward of 45 S they come from the polar DEM
    const pole = quadOf({ z: 5, x: 10, y: rows(5) - 1 })
    expect(quadExtraRows(pole)).toBe(0)
    expect(quadUrl(pole)).toContain('/LRO_LOLA_DEM_SPole45_100mp_v04_EQ/')
    expect(quadUrl(pole)).toContain('&size=512,512&')
  })

  it('splits a quad into its four tiles in quadTiles order', () => {
    const h = new Float32Array(512 * 512)
    for (let r = 0; r < 512; r++) for (let c = 0; c < 512; c++) h[r * 512 + c] = (r < 256 ? 0 : 2) + (c < 256 ? 0 : 1) + (r % 256) * 1000 + (c % 256) * 0.001
    const parts = splitQuad(h)
    parts.forEach((p, i) => {
      expect(p).toHaveLength(256 * 256)
      expect(p[0]).toBeCloseTo(i, 6)
      expect(p[255 * 256 + 255]).toBeCloseTo(i + 255 * 1000 + 0.255, 1)
    })
  })

  it('maps a tile to the WMTS photo tile of the same box (matrix z + 1, row y, column x)', () => {
    // WMTS matrix 5 has 64 x 32 tiles of 5.625 degrees from 180 W, 90 N: column 36 starts at 22.5 E, row 15 at 5.625 N
    expect(trekTileUrl('photo', T)).toBe(
      'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/5/15/36.jpg',
    )
    expect(extraRows('photo', T)).toBe(0)
  })

  it('never crosses 180 degrees or the poles, and asks for no extra row on the south-pole tiles', () => {
    for (let z = 0; z <= MAX_LEVEL; z++) {
      expect(columns(z) * tileBox({ z, x: 0, y: 0 }).size).toBe(360)
      for (const t of [{ z, x: 0, y: 0 }, { z, x: columns(z) - 1, y: rows(z) - 1 }]) {
        const b = tileBox(t)
        expect(b.lon0).toBeGreaterThanOrEqual(-180)
        expect(b.lon0 + b.size).toBeLessThanOrEqual(180)
        expect(b.lat0).toBeGreaterThanOrEqual(-90)
        expect(b.lat0 + b.size).toBeLessThanOrEqual(90)
      }
      expect(extraRows('dem', { z, x: 0, y: rows(z) - 1 })).toBe(0)
      expect(extraRows('dem', { z, x: 0, y: 0 })).toBe(1)
    }
    expect(allTiles(1)).toHaveLength(32)
  })

  it('finds the tile of a point, wrapping longitude', () => {
    expect(tileAt(4, 2.8, 25)).toEqual(T)
    expect(tileAt(4, 2.8, 25 - 360)).toEqual(T)
    expect(tileAt(0, -90, 180)).toEqual({ z: 0, x: 0, y: 1 })
  })

  it('has 83 m cells at the finest level (364 per degree)', () => {
    expect(cellM(MAX_LEVEL)).toBeCloseTo(83.3, 0)
    expect(cellM(0)).toBeCloseTo(10_662, -1)
  })

  it('measures the ground angle of a ray, or the horizon when it misses', () => {
    expect(groundAngle(2 * MOON_R_KM, 0)).toBe(0)
    expect(groundAngle(2 * MOON_R_KM, 40)).toBeCloseTo(60, 6) // misses: horizon at acos(1/2)
    // a ray grazing the limb meets it at the horizon angle
    const graze = (Math.asin(1 / 2) * 180) / Math.PI
    expect(groundAngle(2 * MOON_R_KM, graze - 1e-6)).toBeCloseTo(60, 1)
  })

  it('picks the finest level at the closest zoom and a coarse one for the whole Moon', () => {
    const view = { lat: 0, lon: 25, fovDeg: 35, widthPx: 1600, heightPx: 900 }
    expect(levelFor({ ...view, distKm: MIN_DIST })).toBe(MAX_LEVEL)
    expect(levelFor({ ...view, distKm: MOON_R_KM * 3.4 })).toBe(2)
  })

  it('wants at most MAX_VIEW_TILES tiles, the one under the centre first', () => {
    const close = wantedTiles({ lat: 2.8, lon: 25, distKm: MIN_DIST, fovDeg: 35, widthPx: 1600, heightPx: 900 }, MIN_HEIGHT_LEVEL)
    expect(close.level).toBe(MAX_LEVEL)
    expect(close.tiles.length).toBeGreaterThan(4)
    expect(close.tiles.length).toBeLessThanOrEqual(MAX_VIEW_TILES)
    expect(close.tiles[0]).toEqual(tileAt(MAX_LEVEL, 2.8, 25))
    // a few coarse tiles first, covering the tile under the centre
    expect(close.coarse.length).toBeGreaterThan(0)
    expect(close.coarse.length).toBeLessThanOrEqual(12)
    expect(close.coarse.every((t) => t.z === MAX_LEVEL - COARSE_STEP)).toBe(true)
    expect(close.coarse[0]).toEqual(tileAt(MAX_LEVEL - COARSE_STEP, 2.8, 25))
    const whole = wantedTiles({ lat: -48, lon: 10, distKm: MOON_R_KM * 3.4, fovDeg: 35, widthPx: 1600, heightPx: 900 }, MIN_HEIGHT_LEVEL)
    // the whole Moon needs more 22.5-degree tiles than allowed: the ones nearest to the centre are taken
    expect(whole.level).toBe(MIN_HEIGHT_LEVEL)
    expect(whole.tiles).toHaveLength(MAX_VIEW_TILES)
    expect(whole.tiles[0]).toEqual(tileAt(MIN_HEIGHT_LEVEL, -48, 10))
  })

  it('wraps the tiles around the 180 degree meridian', () => {
    const xs = new Set(tilesAround(4, 0, 179, 1, 4).map((t) => t.x))
    expect(xs.has(columns(4) - 1)).toBe(true)
    expect(xs.has(0)).toBe(true)
  })
})

describe('Moon Trek global tiles', () => {
  it('decodes the DEM tile (16-bit half-metres), drops the extra row and matches LDEM_16 over the same box', async () => {
    const h = await decodeDemTile(fixture('dem_4_36_15.tif'), tileBox(T), 1, demSource(T).scale)
    expect(h).toHaveLength(256 * 256)
    // float32 answer of the same request: -1866.16 and -2138.34 (the 16-bit one is within 0.25 m)
    expect(h[0]).toBe(-1866)
    expect(h[256 * 256 - 1]).toBe(-2138.5)
    let sum = 0
    for (const v of h) sum += v
    // LDEM_16 (PDS, the source of the shipped globe): mean of the 90 x 90 pixels of this box is -2019.27 m
    expect(Math.abs(sum / h.length - -2019.27)).toBeLessThan(2)
  })

  it('scales the polar DEM from half-metres to metres, matching LDEM_16 over the same box', async () => {
    const h = await decodeDemTile(fixture('dem_4_36_28.tif'), tileBox(P), 1, demSource(P).scale)
    expect(h[0]).toBe(1316.5)
    let sum = 0
    for (const v of h) sum += v
    // LDEM_16: mean of the 90 x 90 pixels of this box is 725.31 m (unscaled, the tile's mean would be twice that)
    expect(Math.abs(sum / h.length - 725.31)).toBeLessThan(15)
  })

  it('refuses a DEM tile whose size or georeference is not the tile asked for', async () => {
    await expect(decodeDemTile(fixture('dem_4_36_15.tif'), tileBox(T), 0)).rejects.toThrow(/256 x 257/)
    await expect(decodeDemTile(fixture('dem_4_36_15.tif'), tileBox({ ...T, x: 37 }), 1)).rejects.toThrow(/georeference/)
  })

  it('keeps one grey byte per pixel of the decoded photo', () => {
    expect([...greyFromRgba(new Uint8Array([10, 10, 10, 255, 200, 200, 200, 255]))]).toEqual([10, 200])
  })

  it('caches a checked answer and does not cache a bad one', async () => {
    const store = new MemoryBlockStore()
    let calls = 0
    const url = trekTileUrl('dem', T)
    const ok = async () => {
      calls++
      return new Response(fixture('dem_4_36_15.tif'))
    }
    const req = { url, kind: 'dem' as const, box: tileBox(T), extraRows: 1 }
    await readGeoTile(req, store, ok)
    await readGeoTile(req, store, ok)
    expect(calls).toBe(1)
    const bad = async () => new Response(new Uint8Array([1, 2, 3]))
    await expect(readGeoTile({ ...req, url: `${url}&x` }, store, bad, 2)).rejects.toThrow()
    expect((await store.getMany([`trek|${url}&x`]))[0]).toBeUndefined()
  })

  it('gives up on an answer that does not come within the time limit', async () => {
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    const req = { url: `${trekTileUrl('dem', T)}&hang`, kind: 'dem' as const, box: tileBox(T), extraRows: 1 }
    const t0 = Date.now()
    await expect(readGeoTile(req, new MemoryBlockStore(), hang, 2, 50)).rejects.toThrow()
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})

describe('detail slots index', () => {
  it('stacks every level of the grid in the index texture', () => {
    expect(INDEX_WIDTH).toBe(columns(MAX_LEVEL))
    expect(indexRow(MAX_LEVEL, rows(MAX_LEVEL) - 1)).toBe(INDEX_HEIGHT - 1)
    for (let z = 1; z <= MAX_LEVEL; z++) expect(indexRow(z, 0)).toBe(indexRow(z - 1, rows(z - 1) - 1) + 1)
  })

  it('finds the finest loaded tile not finer than the view, and forgets a replaced one', () => {
    const slots = new DetailSlots('photo')
    const data = new Uint8Array(TILE_CELLS * TILE_CELLS)
    const index = slots.index.image.data as Uint8Array
    const coarse = tileAt(2, -60, 30)
    const fine = tileAt(4, -60, 30)
    expect(findSlot(index, 7, -60, 30)).toBe(-1)
    slots.put(coarse, data)
    slots.put(fine, data)
    expect(findSlot(index, 7, -60, 30)).toBe(1)
    expect(findSlot(index, 3, -60, 30)).toBe(0) // the view's level is 3: the level-4 tile is not used
    expect(findSlot(index, 7, 60, 30)).toBe(-1)
    // fill every layer, wanting only the new tiles: the two first ones are replaced and leave the index
    slots.setWanted([])
    for (let i = 0; i < CAPACITY; i++) slots.put({ z: 7, x: i, y: 0 }, data)
    expect(slots.has(coarse) || slots.has(fine)).toBe(false)
    expect(findSlot(index, 7, -60, 30)).toBe(-1)
    // layers 0 and 1 went to the last two tiles (126, 127); tile 2 of the top row sits in layer 2 + 2
    expect(findSlot(index, 7, 89.9, -180 + 2.5 * tileSize(7))).toBe(4)
    expect(findSlot(index, 7, 89.9, -180 + 126.5 * tileSize(7))).toBe(0)
  })
})
