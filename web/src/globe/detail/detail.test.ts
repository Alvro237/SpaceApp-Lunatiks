// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MemoryBlockStore } from '../../terrain/live/blockStore'
import { MIN_DIST, MOON_R_KM } from '../orbit'
import {
  MAX_LEVEL,
  MAX_VIEW_TILES,
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
} from './grid'
import { decodeDemTile, decodePhotoTile, readGeoTile } from './trekGeo'

const fixture = (name: string) => {
  const b = readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

/** Tile of the fixtures: 22.5-28.125 E, 0-5.625 N (Mare Tranquillitatis), fetched from Moon Trek on 2026-11-14. */
const T = { z: 4, x: 36, y: 15 }

describe('detail grid', () => {
  it('builds the exact Moon Trek request the fixtures were fetched with', () => {
    expect(tileBox(T)).toEqual({ lon0: 22.5, lat0: 0, size: 5.625 })
    expect(trekTileUrl('dem', T)).toBe(
      'https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_Global_256ppd_v06/ImageServer/exportImage' +
        '?bbox=22.5,-0.02197265625,28.125,5.625&size=256,257&format=tiff&pixelType=F32&compression=LZ77' +
        '&interpolation=RSP_BilinearInterpolation&f=image',
    )
    expect(trekTileUrl('photo', T)).toContain('LRO_WAC_Mosaic_Global_303ppd_v02/ImageServer/exportImage?bbox=22.5,-0.02197265625,')
    expect(trekTileUrl('photo', T)).toContain('&format=png&')
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
      expect(extraRows({ z, x: 0, y: rows(z) - 1 })).toBe(0)
      expect(extraRows({ z, x: 0, y: 0 })).toBe(1)
    }
    expect(allTiles(1)).toHaveLength(32)
  })

  it('finds the tile of a point, wrapping longitude', () => {
    expect(tileAt(4, 2.8, 25)).toEqual(T)
    expect(tileAt(4, 2.8, 25 - 360)).toEqual(T)
    expect(tileAt(0, -90, 180)).toEqual({ z: 0, x: 0, y: 1 })
  })

  it('has 168 m cells at the finest level (182 per degree)', () => {
    expect(cellM(MAX_LEVEL)).toBeCloseTo(166.6, 0)
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
    const whole = wantedTiles({ lat: -48, lon: 10, distKm: MOON_R_KM * 3.4, fovDeg: 35, widthPx: 1600, heightPx: 900 }, MIN_HEIGHT_LEVEL)
    expect(whole.tiles.length).toBeLessThanOrEqual(MAX_VIEW_TILES)
    if (whole.level >= 0) expect(whole.level).toBeGreaterThanOrEqual(MIN_HEIGHT_LEVEL)
  })

  it('wraps the tiles around the 180 degree meridian', () => {
    const xs = new Set(tilesAround(4, 0, 179, 1, 4).map((t) => t.x))
    expect(xs.has(columns(4) - 1)).toBe(true)
    expect(xs.has(0)).toBe(true)
  })
})

describe('Moon Trek global tiles', () => {
  it('decodes the DEM tile, drops the extra row and matches LDEM_16 over the same box', async () => {
    const h = await decodeDemTile(fixture('dem_4_36_15.tif'), tileBox(T), 1)
    expect(h).toHaveLength(256 * 256)
    expect(h[0]).toBeCloseTo(-1866.16, 1)
    expect(h[256 * 256 - 1]).toBeCloseTo(-2138.34, 1)
    let sum = 0
    for (const v of h) sum += v
    // LDEM_16 (PDS, the source of the shipped globe): mean of the 90 x 90 pixels of this box is -2019.27 m
    expect(Math.abs(sum / h.length - -2019.27)).toBeLessThan(2)
  })

  it('refuses a DEM tile whose size or georeference is not the tile asked for', async () => {
    await expect(decodeDemTile(fixture('dem_4_36_15.tif'), tileBox(T), 0)).rejects.toThrow(/256 x 257/)
    await expect(decodeDemTile(fixture('dem_4_36_15.tif'), tileBox({ ...T, x: 37 }), 1)).rejects.toThrow(/georeference/)
  })

  it('decodes the photo tile and drops the extra row', async () => {
    const p = await decodePhotoTile(fixture('photo_4_36_15.png'), tileBox(T), 1)
    expect(p).toHaveLength(256 * 256)
    expect(p[0]).toBe(47)
    await expect(decodePhotoTile(fixture('photo_4_36_15.png'), tileBox(T), 0)).rejects.toThrow(/expected 256 x 256/)
  })

  it('fills the column of zeros Moon Trek returns on the photo tile from -180 degrees', async () => {
    // tile 180-135 W, 0-45 N, fetched 2026-11-14: column 0 is all zeros as served
    const box = tileBox({ z: 1, x: 0, y: 1 })
    expect(box).toEqual({ lon0: -180, lat0: 0, size: 45 })
    const p = await decodePhotoTile(fixture('photo_1_0_1.png'), box, 1)
    let zeros = 0
    for (let r = 0; r < 256; r++) {
      if (p[r * 256] === 0) zeros++
      expect(p[r * 256]).toBe(p[r * 256 + 1])
    }
    expect(zeros).toBeLessThan(256)
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
    const bad = async () => new Response(fixture('photo_4_36_15.png'))
    await expect(readGeoTile({ ...req, url: `${url}&x` }, store, bad, 2)).rejects.toThrow()
    expect((await store.getMany([`trek|${url}&x`]))[0]).toBeUndefined()
  })
})
