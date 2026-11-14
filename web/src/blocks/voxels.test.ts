import { describe, expect, it } from 'vitest'
import { polarXY } from '../terrain/tileset'
import { dayBlocks, earthBlocks, gridHeightBilinear, offsetLatLon, sampleGlobal, earthSurface, groundBlocks, groundTopNear, moonBlocks, sampleGround, simpleDuration, skyVector, sunBlocks } from './voxels'

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

  it('scales the curvature drop when asked (Learn mode draws it at true size under stretched relief)', () => {
    const full = sampleGround(() => 0, polarXY, -85, 30, 5, 1000)!
    const quarter = sampleGround(() => 0, polarXY, -85, 30, 5, 1000, 0.25)!
    expect(quarter.heightsM[0]).toBeCloseTo(full.heightsM[0] * 0.25, 6)
    expect(sampleGlobal(() => 0, 10, 20, 5, 2000, 0.25).heightsM[0]).toBeCloseTo(sampleGlobal(() => 0, 10, 20, 5, 2000).heightsM[0] * 0.25, 6)
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

describe('anywhere on the Moon', () => {
  it('walks east and north along the sphere', () => {
    // 1° of arc on a 1737.4 km sphere is 30.32 km
    const km1deg = (Math.PI / 180) * 1_737_400
    const [la, lo] = offsetLatLon(0, 10, km1deg, 0)
    expect(la).toBeCloseTo(0, 6)
    expect(lo).toBeCloseTo(11, 6)
    const [la2, lo2] = offsetLatLon(20, 10, 0, km1deg)
    expect(la2).toBeCloseTo(21, 6)
    expect(lo2).toBeCloseTo(10, 6)
    // across the antimeridian
    expect(offsetLatLon(0, 179.5, km1deg, 0)[1]).toBeCloseTo(-179.5, 6)
  })

  it('interpolates the global grid and wraps in longitude', () => {
    // 4 × 2 grid: columns centred at 45, 135, 225, 315 E; rows at 45 N and 45 S
    const h = new Float32Array([0, 100, 200, 300, 0, 100, 200, 300])
    expect(gridHeightBilinear(h, 4, 2, 45, 90)).toBeCloseTo(50, 6)
    // between 315 E and 45 E (wrap): halfway
    expect(gridHeightBilinear(h, 4, 2, 45, 0)).toBeCloseTo(150, 6)
  })

  it('samples a flat Moon as the curvature drop only, centre at 0', () => {
    const g = sampleGlobal(() => 0, 10, 20, 5, 2000)
    expect(g.heightsM[2 * 5 + 2]).toBeCloseTo(0, 6)
    expect(g.heightsM[0]).toBeCloseTo(-(2 * 4000 ** 2) / (2 * 1_737_400), 4)
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

describe('sphereBlocks', () => {
  it('keeps peaks that rise above the plain radius (no cut-off, no holes)', () => {
    // a 20 % bulge everywhere: the shell must sit at 1.2 × the radius, not be clipped by the grid
    const b = moonBlocks(new Float32Array(8 * 4).fill(0.2 * 1_737_400), 8, 4, 30, 1)
    let max = 0
    for (let k = 0; k < b.count; k++) max = Math.max(max, Math.hypot(b.pos[k * 3], b.pos[k * 3 + 1], b.pos[k * 3 + 2]))
    expect(max).toBeGreaterThan(b.radius * 1.15)
    // a closed shell: every direction meets a cube
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0.6, 0.64, -0.48]]
    for (const [x, y, z] of dirs) {
      let hit = false
      for (let k = 0; k < b.count && !hit; k++) {
        const px = b.pos[k * 3], py = b.pos[k * 3 + 1], pz = b.pos[k * 3 + 2]
        const t = px * x + py * y + pz * z
        if (t > 0 && Math.hypot(px - t * x, py - t * y, pz - t * z) < 0.9) hit = true
      }
      expect(hit).toBe(true)
    }
  })
})

describe('sun and earth balls', () => {
  it('builds round shells of the asked size', () => {
    const sun = sunBlocks(14)
    expect(sun.radius).toBe(6)
    let max = 0
    for (let k = 0; k < sun.count; k++) max = Math.max(max, Math.hypot(sun.pos[k * 3], sun.pos[k * 3 + 1], sun.pos[k * 3 + 2]))
    expect(max).toBeLessThanOrEqual(6.01)
    expect(earthBlocks(20).count).toBeGreaterThan(sun.count)
  })

  it('draws the continents where they are, roughly', () => {
    expect(earthSurface(48, 2)).toBe('land') // France
    expect(earthSurface(40, -100)).toBe('land') // United States
    expect(earthSurface(-25, 134)).toBe('desert') // Australia
    expect(earthSurface(23, 10)).toBe('desert') // Sahara
    expect(earthSurface(0, -150)).toBe('ocean') // Pacific
    expect(earthSurface(30, -40)).toBe('ocean') // Atlantic
    expect(earthSurface(-80, 0)).toBe('ice') // Antarctica
    expect(earthSurface(72, -40)).toBe('ice') // Greenland
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

describe('groundTopNear', () => {
  // 5 x 5 columns, flat at 0 except a 7-cube tower at i = 4, j = 0 (x = +2, z = -2)
  const columns = new Int16Array(25)
  columns[4] = 7
  it('gives the upper face of the tallest column within reach', () => {
    expect(groundTopNear(columns, 0, 0, 1)).toBe(0.5)
    expect(groundTopNear(columns, 1, -1, 1)).toBe(7.5)
    expect(groundTopNear(columns, 0, 0, 2)).toBe(7.5)
  })
  it('is null outside the island', () => {
    expect(groundTopNear(columns, 9, 0, 1)).toBeNull()
  })
})
