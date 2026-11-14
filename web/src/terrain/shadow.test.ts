// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { horizonDeg, mapDirection, stepDistance, sunFraction } from './shadow'
import { R_M, polarXY } from './tileset'

const CELL = 960

describe('direction of an azimuth on the polar map', () => {
  it('north points away from the pole and east turns clockwise on the map', () => {
    // On the meridian lon = 0 (the +y axis) north is +y and east is +x.
    const n = mapDirection(0, 0)
    const e = mapDirection(90, 0)
    expect(n[0]).toBeCloseTo(0, 12)
    expect(n[1]).toBeCloseTo(1, 12)
    expect(e[0]).toBeCloseTo(1, 12)
    expect(e[1]).toBeCloseTo(0, 12)
    // On lon = 90° E (the +x axis) north is +x.
    expect(mapDirection(0, 90)[0]).toBeCloseTo(1, 12)
  })
})

describe('terrain horizon by ray marching (hand-worked)', () => {
  const [x0, y0] = polarXY(-88, 0)

  it('flat ground: the horizon is the curvature drop at the first step, just below 0°', () => {
    const h = horizonDeg(() => 0, x0, y0, 45, CELL)
    // first step d1 = 960 × (1 + 1/24) = 1000 m → atan(−d1 / 2R) = −0.0165°
    const d1 = stepDistance(1, CELL)
    expect(d1).toBeCloseTo(1000, 9)
    expect(h).toBeCloseTo(Math.atan(-d1 / (2 * R_M)) * (180 / Math.PI), 9)
  })

  it('a 1 000 m wall 10 km east raises the horizon to about atan(1000 / 10 000) = 5.7°', () => {
    // East on the lon = 0 meridian is +x; the map scale factor at 88° S is ~1.0003, so the wall starts at
    // ground distance 10 km within a few metres.
    const wall = (x: number) => (x - x0 > 10_000 ? 1000 : 0)
    const h = horizonDeg((x) => wall(x), x0, y0, 90, CELL)
    expect(h).toBeGreaterThan(5.0)
    expect(h).toBeLessThanOrEqual(5.72)
    // the same wall does not block the west
    expect(horizonDeg((x) => wall(x), x0, y0, 270, CELL)).toBeLessThan(0)
  })

  it('a Sun at 3° behind that wall is hidden; at 7° it is fully visible', () => {
    expect(sunFraction(3, 5.5, 0.27)).toBe(0)
    expect(sunFraction(7, 5.5, 0.27)).toBe(1)
    expect(sunFraction(5.5, 5.5, 0.27)).toBeCloseTo(0.5, 12)
  })

  it('stops at the edge of the data', () => {
    expect(horizonDeg(() => null, x0, y0, 0, CELL)).toBe(-90)
  })
})
