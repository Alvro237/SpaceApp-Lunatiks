import { describe, expect, it } from 'vitest'
import { MOON_R_KM } from './orbit'
import { PATCH_CELLS, PATCH_MAX_CELL_KM, holeOf, patchGeometry, patchWindows } from './patch'

const KM_PER_DEG = (MOON_R_KM * Math.PI) / 180

describe('relief grids around the place in view', () => {
  it('nests up to three grids of power-of-two cells, each four times the one inside', () => {
    // hand-worked: 50 km away, the finest grid should reach 1.5 x 50 km each way: 150 km / 256 cells = 0.586 km
    // = 0.01932 degrees, and the nearest power of two is 1/64 degree (0.474 km)
    const w = patchWindows(10, 20, 50)
    expect(w.map((x) => x.cellLat)).toEqual([1 / 64, 1 / 16, 1 / 4])
    expect(w[0].cellKm).toBeCloseTo(KM_PER_DEG / 64, 9)
    // at 10 degrees of latitude a degree of longitude is nearly as long: no widening
    expect(w[0].cellLon).toBe(w[0].cellLat)
    expect(w.every((x) => x.cellKm <= PATCH_MAX_CELL_KM)).toBe(true)
  })

  it('draws none far from the Moon or near a pole, and fewer as the camera rises', () => {
    expect(patchWindows(0, 0, 4000)).toEqual([])
    expect(patchWindows(85, 0, 50)).toEqual([])
    expect(patchWindows(0, 0, 500).map((x) => x.cellLat)).toEqual([1 / 4])
  })

  it('widens the cells in longitude by a power of two at high latitude', () => {
    // 1 / cos(60°) = 2
    const w = patchWindows(60, 0, 50)[0]
    expect(w.cellLon).toBe(2 * w.cellLat)
  })

  it('keeps every vertex over the same ground while the camera moves', () => {
    // the centre is always a multiple of the cell, so vertices (centre + whole cells) land on the same grid
    for (const lon of [20, 20.004, 20.0101, -179.99]) {
      const w = patchWindows(10, lon, 50)[0]
      expect(Math.abs(w.lon / w.cellLon - Math.round(w.lon / w.cellLon))).toBeLessThan(1e-9)
      expect(Math.abs(w.lon - lon)).toBeLessThanOrEqual(w.cellLon / 2 + 1e-12)
    }
  })

  it('leaves out of the coarser mesh a box one cell smaller than the grid, inside the poles', () => {
    const w = patchWindows(10, 20, 50)[0]
    const [lon, halfLon, south, north] = holeOf(w)
    expect(lon).toBe(w.lon)
    expect(halfLon).toBeCloseTo((PATCH_CELLS / 2 - 1) * w.cellLon, 12)
    expect(north - south).toBeCloseTo((PATCH_CELLS - 2) * w.cellLat, 12)
    const high = patchWindows(79, 0, 50)[2]
    expect(holeOf(high)[3]).toBe(89.9)
  })

  it('has one vertex per cell corner plus a rim that hangs down', () => {
    const g = patchGeometry(4)
    const skirt = g.getAttribute('skirt')
    expect(skirt.count).toBe(5 * 5 + 16)
    expect(Array.from(skirt.array as Float32Array).filter((s) => s === 1)).toHaveLength(16)
    // cells from the centre: -2..2 across
    const x = Array.from({ length: 25 }, (_, i) => g.getAttribute('position').getX(i))
    expect(Math.min(...x)).toBe(-2)
    expect(Math.max(...x)).toBe(2)
    expect(g.getIndex()!.count).toBe(4 * 4 * 6 + 16 * 6)
  })
})
