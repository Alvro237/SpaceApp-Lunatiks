import { describe, expect, it } from 'vitest'
import { type TileKey, keyOf } from '../../terrain/tileset'
import { MOON_R_KM, latLonToScene } from '../orbit'
import { OVERVIEW_DELAY_S, POLAR_MAX_Z, overviewDue, polarIndexRow, polarWanted } from './polar'

// the polar map's tileset geometry (tiles/tileset.json): ±983 040 m, 256 cells a tile, disc to 60 S
const TS = { extentM: [-983_040, -983_040, 983_040, 983_040] as [number, number, number, number], discRadiusM: 931_069.9, tileCells: 256 }
const all = () => true

describe('south-polar detail tiles on the globe', () => {
  it('stacks the levels in the index: level z starts at row 2^z − 1 (511 rows for z0-z8)', () => {
    expect(polarIndexRow(0, 0)).toBe(0)
    expect(polarIndexRow(1, 1)).toBe(2)
    expect(polarIndexRow(POLAR_MAX_Z, 255)).toBe(510)
  })

  it('from far away keeps the root: its 7.68 km cells are under SPLIT_PX pixels', () => {
    // 12 000 km from the centre over the pole, 35° over 500 px (1.22 mrad a pixel); the root's nearest point, the
    // pole, is 10 263 km away, where a pixel spans 12.5 km > 7.68 km
    const cam = { position: latLonToScene(-90, 0, 12_000) as [number, number, number], pixelRad: (35 * Math.PI) / 180 / 500, visible: () => true }
    expect(polarWanted(TS, all, cam)).toEqual([{ z: 0, x: 0, y: 0 }])
  })

  it('close in, splits down to the finest level under the camera and keeps every ancestor', () => {
    const cam = { position: latLonToScene(-89.5, 0, MOON_R_KM + 5) as [number, number, number], pixelRad: (35 * Math.PI) / 180 / 1000, visible: () => true }
    const w = polarWanted(TS, all, cam)
    const keys = new Set(w.map(keyOf))
    const finest = w.filter((t) => t.z === POLAR_MAX_Z)
    expect(finest.length).toBeGreaterThan(0)
    for (const t of finest) {
      let p: TileKey = t
      while (p.z > 0) {
        p = { z: p.z - 1, x: p.x >> 1, y: p.y >> 1 }
        expect(keys.has(keyOf(p))).toBe(true)
      }
    }
  })

  it('leaves out tiles outside the view and tiles wholly outside the disc', () => {
    const cam = { position: latLonToScene(-89, 0, MOON_R_KM + 50) as [number, number, number], pixelRad: 0.001, visible: () => false }
    // nothing beyond the root is in view
    expect(polarWanted(TS, all, cam)).toEqual([{ z: 0, x: 0, y: 0 }])
    const anywhere = { ...cam, visible: () => true }
    // every tile drawn has some of its square inside the 931 km disc
    for (const t of polarWanted(TS, all, anywhere)) {
      const size = 1_966_080 / 2 ** t.z
      const x0 = -983_040 + t.x * size
      const y1 = 983_040 - t.y * size
      const nx = Math.max(x0, Math.min(0, x0 + size))
      const ny = Math.max(y1 - size, Math.min(0, y1))
      expect(Math.hypot(nx, ny)).toBeLessThanOrEqual(931_069.9)
    }
  })
})

describe('when the globe asks for the polar overview heights', () => {
  const above = (lat: number, distFromCentreKm: number) => ({ position: latLonToScene(lat, 0, distFromCentreKm) })
  it('waits while the opening whole-Moon view loads', () => {
    expect(overviewDue(0, above(-48, MOON_R_KM * 3.4))).toBe(false)
    expect(overviewDue(OVERVIEW_DELAY_S - 0.1, above(-48, MOON_R_KM * 3.4))).toBe(false)
  })
  it('starts after OVERVIEW_DELAY_S of frames wherever the camera is', () => {
    expect(overviewDue(OVERVIEW_DELAY_S, above(30, MOON_R_KM * 3.4))).toBe(true)
  })
  it('starts at once with the camera over the south pole, before the dive into the map (1.8 radii)', () => {
    expect(overviewDue(0, above(-90, MOON_R_KM * 1.8))).toBe(true)
    expect(overviewDue(0, above(-90, MOON_R_KM * 2.5))).toBe(false)
  })
})
