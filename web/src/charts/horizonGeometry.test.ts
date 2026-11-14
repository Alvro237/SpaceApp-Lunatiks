import { describe, expect, it } from 'vitest'
import { type Viewport, el1, elevationTicks, horizonAt, horizonPath, niceExaggeration, pathSegments, wrap360, xOf, yOf } from './horizonGeometry'

const full: Viewport = { az0: 0, az1: 360, el0: -2, width: 720, height: 100, exaggeration: 10 }

describe('panorama geometry', () => {
  it('wraps azimuths to [0, 360)', () => {
    expect(wrap360(-10)).toBe(350)
    expect(wrap360(370)).toBe(10)
    expect(wrap360(360)).toBe(0)
  })

  it('maps azimuth to x and elevation to y', () => {
    expect(xOf(full, 0)).toBe(0)
    expect(xOf(full, 180)).toBe(360)
    expect(yOf(full, -2)).toBe(100)
    // 2 px per degree horizontally, ×10 vertically → 20 px per degree
    expect(yOf(full, 0)).toBe(60)
    expect(el1(full)).toBe(3)
  })

  it('places azimuths across the seam inside a window that runs past 360', () => {
    const v: Viewport = { az0: 356, az1: 364, el0: 0, width: 80, height: 80, exaggeration: 1 }
    expect(xOf(v, 358)).toBe(20)
    expect(xOf(v, 2)).toBe(60)
  })

  it('interpolates the horizon and wraps at 360', () => {
    const values = [0, 1, 2, 3] // 90° step
    expect(horizonAt(values, 45)).toBe(0.5)
    expect(horizonAt(values, 315)).toBe(1.5) // between 3 (at 270) and 0 (at 360)
    expect(horizonAt(values, 360)).toBe(0)
  })

  it('closes the terrain path at the bottom of the view', () => {
    const d = horizonPath(full, new Array(720).fill(0))
    expect(d.startsWith('M0,100')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
  })

  it('splits a path that crosses the 0°/360° seam', () => {
    const segs = pathSegments(full, [350, 355, 359, 3, 8], [0, 0, 0, 0, 0])
    expect(segs).toHaveLength(2)
    expect(segs[0]).toHaveLength(3)
    expect(segs[1]).toHaveLength(2)
  })

  it('chooses a nice exaggeration that fits', () => {
    // 4° of elevation in 280 px on a 1000 px wide 360° chart: raw 25.2 → 25
    expect(niceExaggeration(4, 1000, 280)).toBe(25)
    expect(niceExaggeration(1000, 1000, 280)).toBe(1)
  })

  it('gives round elevation ticks', () => {
    expect(elevationTicks(full)).toEqual([-2, -1, 0, 1, 2, 3])
  })
})
