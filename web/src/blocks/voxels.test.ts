import { describe, expect, it } from 'vitest'
import { polarXY } from '../terrain/tileset'
import { dayBlocks, groundBlocks, moonBlocks, sampleGround, simpleDuration, skyVector } from './voxels'

describe('skyVector', () => {
  it('points north, east, south and up as the scene axes say', () => {
    const north = skyVector(0, 0)
    expect(north[0]).toBeCloseTo(0)
    expect(north[2]).toBeCloseTo(-1)
    const east = skyVector(90, 0)
    expect(east[0]).toBeCloseTo(1)
    expect(skyVector(180, 0)[2]).toBeCloseTo(1)
    expect(skyVector(0, 90)[1]).toBeCloseTo(1)
  })

  it('stretches the elevation like the heights: tan el\' = k tan el', () => {
    const v = skyVector(0, 1.5, 4)
    const el = Math.atan2(v[1], Math.hypot(v[0], v[2]))
    expect(Math.tan(el)).toBeCloseTo(4 * Math.tan((1.5 * Math.PI) / 180), 10)
    expect(skyVector(0, -2, 4)[1]).toBeLessThan(0)
  })
})

describe('sampleGround', () => {
  it('lays rows north to south and columns west to east', () => {
    // a ramp that rises to the north (away from the pole): the north edge must be higher
    const [, y0] = polarXY(-85, 0)
    const g = sampleGround((_x, y) => y - y0, polarXY, -85, 0, 5, 1000)!
    expect(g.heightsM[0]).toBeGreaterThan(g.heightsM[4 * 5])
    // centre sample: no curvature drop, ground at 0 m
    expect(g.heightsM[2 * 5 + 2]).toBeCloseTo(0, 6)
  })

  it('subtracts the curvature drop d² / 2R', () => {
    const g = sampleGround(() => 0, polarXY, -85, 30, 5, 1000)!
    // corner: 2 km east and 2 km north of the centre
    expect(g.heightsM[0]).toBeCloseTo(-(8_000_000 / (2 * 1_737_400)), 4)
  })

  it('returns null off the map', () => {
    expect(sampleGround(() => null, polarXY, -85, 0, 3, 1000)).toBeNull()
  })
})

describe('groundBlocks', () => {
  const flat = { n: 5, cellM: 960, heightsM: new Float32Array(25) }

  it('makes one cube per inner column on flat ground and walls on the outer ring', () => {
    const b = groundBlocks(flat)
    expect(b.centreTop).toBe(0)
    expect(b.floor).toBe(-2)
    // 9 inner columns × 1 cube + 16 ring columns × 3 cubes (0, −1, −2)
    expect(b.count).toBe(9 + 16 * 3)
  })

  it('stacks a hill as cubes of cellM / exaggeration', () => {
    const h = new Float32Array(25)
    h[1 * 5 + 1] = 960 // one cell 960 m higher: 4 cubes at ×4
    const b = groundBlocks({ n: 5, cellM: 960, heightsM: h }, 4)
    expect(b.columns[1 * 5 + 1]).toBe(4)
    // the hill shows its sides: cubes 1..4 (its neighbours stand at 0)
    expect(b.count).toBe(9 - 1 + 4 + 16 * 3)
  })
})

describe('moonBlocks', () => {
  it('builds a hollow shell whose cubes lie near the radius', () => {
    const b = moonBlocks(new Float32Array(8 * 4), 8, 4, 16, 1)
    expect(b.count).toBeGreaterThan(300)
    for (let k = 0; k < b.count; k++) {
      const r = Math.hypot(b.pos[k * 3], b.pos[k * 3 + 1], b.pos[k * 3 + 2])
      expect(r).toBeGreaterThan(b.radius - 2)
      expect(r).toBeLessThanOrEqual(b.radius + 0.01)
    }
  })
})

describe('dayBlocks', () => {
  it('gives the share of each day with the Sun and with Earth contact', () => {
    const H = 3_600_000
    const t = Array.from({ length: 48 }, (_, k) => k * H)
    const sun = t.map((_, k) => k < 12)
    const comms = t.map((_, k) => k >= 24)
    const d = dayBlocks(t, sun, comms, 0, 3)
    expect(d[0].sun).toBeCloseTo(0.5)
    expect(d[0].earth).toBe(0)
    expect(d[1].sun).toBe(0)
    expect(d[1].earth).toBe(1)
    expect(Number.isNaN(d[2].sun)).toBe(true)
  })
})

describe('simpleDuration', () => {
  it('rounds to minutes, hours or days', () => {
    expect(simpleDuration(20 * 60_000)).toBe('20 minutes')
    expect(simpleDuration(13.7 * 3_600_000)).toBe('14 hours')
    expect(simpleDuration(19.8 * 86_400_000)).toBe('20 days')
  })
})
