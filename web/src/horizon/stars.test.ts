/**
 * The Moon's orientation in the inertial sky (stars.ts, IAU series) against this app's own Sun and Earth tables
 * (JPL DE440, Moon-fixed mean-Earth frame): the Sun and the Earth are put in the inertial frame with the
 * Astronomical Almanac's low-precision formulas, turned into the Moon's frame with the same rotation the stars use,
 * and compared with the tables. If the rotation were wrong (pole, prime meridian, a sign), the stars would be too.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EphemerisTable, siteFrame } from '../time/engine'
import { type EphemerisIndex, parseSegments } from '../time/staticData'
import { STARS, inertialToMoon, moonOrientation, starColour, starDirections, toMoon } from './stars'

const ROOT = resolve(__dirname, '../../../data')
const read = (p: string) => readFileSync(resolve(ROOT, p))
function table(): EphemerisTable {
  const index = JSON.parse(read('ephemeris.json').toString()) as EphemerisIndex
  const buffers = index.segments.map((seg) => {
    const b = read(seg.file)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  })
  return new EphemerisTable(parseSegments(index, buffers))
}

const DEG = Math.PI / 180
const J2000 = Date.UTC(2000, 0, 1, 12)
const AU_KM = 149_597_870.7
const unit = (v: number[]) => {
  const n = Math.hypot(v[0], v[1], v[2])
  return [v[0] / n, v[1] / n, v[2] / n]
}
const sepDeg = (a: number[], b: number[]) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])) / DEG

/** Ecliptic longitude / latitude of date (degrees) and distance (km) to an equatorial J2000 vector. */
function eclipticToJ2000(lonDeg: number, latDeg: number, distKm: number, T: number): number[] {
  const lon = (lonDeg - 1.397 * T) * DEG // general precession in longitude: equinox of date → J2000
  const lat = latDeg * DEG
  const eps = 23.4393 * DEG
  const x = Math.cos(lat) * Math.cos(lon)
  const y = Math.cos(lat) * Math.sin(lon)
  const z = Math.sin(lat)
  return [distKm * x, distKm * (y * Math.cos(eps) - z * Math.sin(eps)), distKm * (y * Math.sin(eps) + z * Math.cos(eps))]
}

/** Astronomical Almanac low-precision Sun (0.01°) and Moon (0.3°), geocentric, J2000 equatorial, km. */
function sunAndMoon(tMs: number): { sun: number[]; moon: number[] } {
  const d = (tMs - J2000) / 86_400_000
  const T = d / 36_525
  const g = (357.528 + 0.9856003 * d) * DEG
  const sunLon = 280.46 + 0.9856474 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)
  const sunDist = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * AU_KM
  const s = (a: number, b: number) => Math.sin((a + b * T) * DEG)
  const c = (a: number, b: number) => Math.cos((a + b * T) * DEG)
  const moonLon =
    218.32 + 481267.881 * T + 6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36) + 0.66 * s(235.7, 890534.22) + 0.21 * s(269.9, 954397.74) -
    0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03)
  const moonLat = 5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21)
  const par = 0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36) + 0.0078 * c(235.7, 890534.22) + 0.0028 * c(269.9, 954397.74)
  const moonDist = 6378.14 / Math.sin(par * DEG)
  return { sun: eclipticToJ2000(sunLon, 0, sunDist, T), moon: eclipticToJ2000(moonLon, moonLat, moonDist, T) }
}

describe('Moon orientation for the star field', () => {
  const eph = table()
  const times = [Date.UTC(2025, 2, 14, 6), Date.UTC(2026, 10, 14, 21), Date.UTC(2027, 5, 3, 0), Date.UTC(2029, 0, 20, 12), Date.UTC(2031, 8, 9, 3), Date.UTC(2034, 11, 1, 18)]

  it('puts the Sun and the Earth where the JPL tables have them', () => {
    for (const t of times) {
      const p = eph.positions(t)
      const m = inertialToMoon(t)
      const { sun, moon } = sunAndMoon(t)
      // seen from the Moon: Sun = Sun − Moon (geocentric), Earth = −Moon
      const sunMoon = unit(toMoon(m, sun[0] - moon[0], sun[1] - moon[1], sun[2] - moon[2]))
      const earthMoon = unit(toMoon(m, -moon[0], -moon[1], -moon[2]))
      expect(sepDeg(sunMoon, unit([p[0], p[1], p[2]]))).toBeLessThan(0.1)
      // limited by the low-precision Moon (0.3° in longitude), not by the orientation
      expect(sepDeg(earthMoon, unit([p[3], p[4], p[5]]))).toBeLessThan(0.6)
    }
  })

  it('is a rotation, with the pole near the ecliptic pole and one turn a month', () => {
    const m = inertialToMoon(times[1])
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const dot = m[3 * i] * m[3 * j] + m[3 * i + 1] * m[3 * j + 1] + m[3 * i + 2] * m[3 * j + 2]
        expect(dot).toBeCloseTo(i === j ? 1 : 0, 12)
      }
    const o = moonOrientation(times[1])
    expect(Math.abs(o.delta0 - 66.54)).toBeLessThan(1.6) // 1.54° of nodal wobble about 66.54°
    const w0 = moonOrientation(times[1]).w
    const w1 = moonOrientation(times[1] + 86_400_000).w
    expect((((w1 - w0) % 360) + 360) % 360).toBeCloseTo(13.18, 0)
  })

  it('places the stars: the pole star of the Moon’s south sky, angles between stars, colours', () => {
    const t = times[2]
    const south = siteFrame(-89.9, 0)
    const dir = starDirections(t, south)
    expect(dir.length).toBe(STARS.length * 2)
    // Sirius (brightest, first) and Canopus (second) are 36.2° apart in any sky
    const v = (i: number) => {
      const az = dir[2 * i] * DEG
      const el = dir[2 * i + 1] * DEG
      return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)]
    }
    expect(STARS[0].vmag).toBeCloseTo(-1.46, 2)
    const inertial = sepDeg([STARS[0].x, STARS[0].y, STARS[0].z], [STARS[1].x, STARS[1].y, STARS[1].z])
    expect(inertial).toBeCloseTo(36.2, 0)
    expect(sepDeg(v(0), v(1))).toBeCloseTo(inertial, 3)
    // from the lunar south pole a star's elevation is minus its Moon-frame latitude: about half the sky is up
    let up = 0
    for (let i = 0; i < STARS.length; i++) if (dir[2 * i + 1] > 0) up++
    expect(up / STARS.length).toBeGreaterThan(0.35)
    expect(up / STARS.length).toBeLessThan(0.65)
    expect(starColour(-0.2)[2]).toBeGreaterThan(starColour(1.5)[2]) // hot stars are bluer
    expect(starColour(null)).toEqual(starColour(0.6))
  })
})
