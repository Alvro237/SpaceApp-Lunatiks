// @vitest-environment node
/**
 * The browser engine must agree with JPL Horizons as tightly as the API engine does (0.01°), using the same
 * fixture and the same tables, and must reproduce the API's visibility rules on hand-worked cases.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EphemerisTable,
  Horizon,
  bodyDirection,
  computeMetrics,
  discVisibleFraction,
  evaluateAt,
  flatFraction,
  flatHorizon,
  longestRun,
  makeModel,
  nextTransition,
  siteFrame,
  sphericalHorizonDeg,
  timeGrid,
  visibilityRanges,
} from './engine'
import { HorizonMasks, parseSegments, type EphemerisIndex, type SitesDoc } from './staticData'

const ROOT = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(ROOT, p))

function table(): EphemerisTable {
  const index = JSON.parse(read('data/ephemeris.json').toString()) as EphemerisIndex
  const buffers = index.segments.map((s) => {
    const b = read(`data/${s.file}`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  })
  return new EphemerisTable(parseSegments(index, buffers))
}

function masks(): HorizonMasks {
  const doc = JSON.parse(read('data/sites.json').toString()) as SitesDoc
  const b = read('data/horizons.i16')
  return new HorizonMasks(doc, new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))
}

const eph = table()
const DEG = Math.PI / 180

function skyErrorDeg(az1: number, el1: number, az2: number, el2: number): number {
  const c =
    Math.sin(el1 * DEG) * Math.sin(el2 * DEG) + Math.cos(el1 * DEG) * Math.cos(el2 * DEG) * Math.cos((az1 - az2) * DEG)
  return Math.acos(Math.min(1, Math.max(-1, c))) / DEG
}

describe('ephemeris and geometry against JPL Horizons', () => {
  it('reproduces every fixture sample within 0.01°', () => {
    const fixture = JSON.parse(read('api/tests/fixtures/horizons_reference.json').toString()) as {
      cases: { lat: number; lon: number; alt_km: number; samples: { utc: string; sun: { az: number; el: number }; earth: { az: number; el: number } }[] }[]
    }
    let worst = 0
    let checked = 0
    for (const c of fixture.cases) {
      const f = siteFrame(c.lat, c.lon, c.alt_km)
      for (const s of c.samples) {
        const t = Date.parse(s.utc)
        if (!eph.covers(t)) continue
        const v = eph.positions(t)
        const sun = bodyDirection(v[0], v[1], v[2], f)
        const earth = bodyDirection(v[3], v[4], v[5], f)
        worst = Math.max(worst, skyErrorDeg(sun.az, sun.el, s.sun.az, s.sun.el))
        worst = Math.max(worst, skyErrorDeg(earth.az, earth.el, s.earth.az, s.earth.el))
        checked += 2
      }
    }
    expect(checked).toBeGreaterThanOrEqual(100)
    expect(worst).toBeLessThan(0.01)
  })

  it('throws outside the tables', () => {
    expect(() => eph.positions(Date.parse('2040-01-01T00:00:00Z'))).toThrow(/outside the ephemeris/)
  })
})

describe('visible fraction of a disc (hand-worked)', () => {
  it('flat horizon: centre on the line is half, one radius above is all, one below is none', () => {
    expect(flatFraction(0, 0.27)).toBeCloseTo(0.5, 12)
    expect(flatFraction(0.27, 0.27)).toBeCloseTo(1, 12)
    expect(flatFraction(-0.27, 0.27)).toBeCloseTo(0, 12)
  })

  it('flat horizon: centre half a radius above → (acos(-0.5) + 0.5·√0.75)/π = 0.8045', () => {
    expect(flatFraction(0.135, 0.27)).toBeCloseTo((Math.acos(-0.5) + 0.5 * Math.sqrt(0.75)) / Math.PI, 12)
  })

  it('terrain step: a wall at 2° over half the sky hides a Sun at 1° there, not on the open side', () => {
    const values = Array.from({ length: 720 }, (_, i) => (i < 360 ? 2 : 0)) // 0..180° az blocked to 2°
    const h = new Horizon(values, 'terrain')
    expect(discVisibleFraction(1, 90, 0.27, h)).toBe(0)
    expect(discVisibleFraction(1, 270, 0.27, h)).toBe(1)
  })

  it('smooth sphere: a 2 m mast sees about √(2h/R) = 0.0869° below the horizontal', () => {
    // acos(R / (R + 2 m)) with R = 1 737 400 m
    expect(sphericalHorizonDeg(2)).toBeCloseTo(-Math.acos(1737400 / 1737402) / DEG, 12)
    expect(sphericalHorizonDeg(2)).toBeCloseTo(-Math.sqrt((2 * 2) / 1737400) / DEG, 4)
  })
})

describe('time summaries', () => {
  it('ranges and longest runs', () => {
    const t = [0, 1, 2, 3, 4, 5]
    const f = [true, true, false, false, false, true]
    expect(visibilityRanges(t, f)).toEqual([
      [0, 1],
      [5, 5],
    ])
    expect(longestRun(f, false)).toBe(3)
    expect(timeGrid(0, 1, 10)).toHaveLength(7)
  })
})

describe('catalogue sites with LOLA masks', () => {
  const m = masks()

  it('uses the terrain mask at IM-2 and the nearest stored mast', () => {
    const site = m.site('im-2')!
    const { horizon, mastUsedM } = m.forSite(site, 3)
    expect(horizon.kind).toBe('terrain')
    expect(mastUsedM).toBe(2)
    expect(horizon.values).toHaveLength(720)
  })

  it('falls back to the smooth sphere where there is no terrain (Apollo 11)', () => {
    const { horizon } = m.forSite(m.site('apollo-11')!, 2)
    expect(horizon.kind).toBe('smooth_sphere')
  })

  it('evaluates a 30-day window at IM-2 with consistent metrics and a next transition', () => {
    const site = m.site('im-2')!
    const { horizon } = m.forSite(site, 2)
    const model = makeModel(site.lat, site.lon, site.terrain.groundHeightM ?? 0, horizon, 2)
    const start = Date.parse('2027-01-01T00:00:00Z')
    const samples = timeGrid(start, 24 * 30, 60).map((t) => evaluateAt(eph, model, t))
    const metrics = computeMetrics(samples)
    expect(metrics.windowHours).toBe(720)
    expect(metrics.sunlightPct).toBeGreaterThan(0)
    expect(metrics.sunlightPct).toBeLessThanOrEqual(100)
    expect(metrics.bothPct).toBeLessThanOrEqual(Math.min(metrics.sunlightPct, metrics.commsPct))
    const next = nextTransition(eph, model, start, 'sun')
    expect(next).not.toBeNull()
    const before = evaluateAt(eph, model, next!.atMs - 2000).sun.fraction > 0
    const after = evaluateAt(eph, model, next!.atMs + 2000).sun.fraction > 0
    expect(before).not.toBe(after)
  })

  it('a flat horizon equals the flat-fraction formula', () => {
    const h = flatHorizon(-0.0869)
    expect(discVisibleFraction(0, 10, 0.27, h)).toBeCloseTo(flatFraction(0.0869, 0.27), 12)
  })
})
