/**
 * The real night sky of the Moon for the first-person horizon view: where each naked-eye star of the Yale Bright Star
 * Catalogue stands over the observer's horizon at the chosen instant.
 *
 * Stars are fixed in the inertial sky (J2000 right ascension and declination, stars.json). The Moon turns under them
 * once a month, so the star field depends only on how the Moon is oriented at that instant: the direction of its
 * north pole (α0, δ0) and the angle W of its prime meridian, from the IAU Working Group on Cartographic Coordinates
 * and Rotational Elements (Archinal et al. 2018, Celest. Mech. Dyn. Astron. 130:22, Table 2, the Moon), with
 * d days and T Julian centuries from J2000.0 (TDB; UTC is used, 69 s apart, far below the drawing accuracy).
 * A star's unit vector s in the inertial frame becomes, in the Moon-fixed frame of the site model,
 *
 *     m = Rz(W) · Rx(90° − δ0) · Rz(90° + α0) · s
 *
 * and its azimuth and elevation follow from the site's east / north / up as for the Sun and the Earth (stars are at
 * infinity: no parallax). The IAU series is the mean-Earth / polar-axis orientation to a few hundredths of a degree;
 * stars.test.ts checks it against this app's own Sun and Earth tables (JPL DE440).
 *
 * No atmosphere: stars do not twinkle and are not dimmed towards the horizon. They are drawn at every hour, also
 * with the Sun up: a presentation choice (an eye or a camera exposed for sunlit ground would not show them).
 */
import type { SiteFrame } from '../time/engine'
import catalogue from './stars.json'

const DEG = Math.PI / 180
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0)

export interface Star {
  /** Unit vector in the inertial frame (J2000 equator and equinox). */
  x: number
  y: number
  z: number
  vmag: number
  /** B − V colour index; null when the catalogue has none. */
  bv: number | null
}

export const STARS: Star[] = (catalogue.stars as [number, number, number, number | null][]).map(([ra, dec, vmag, bv]) => ({
  x: Math.cos(dec * DEG) * Math.cos(ra * DEG),
  y: Math.cos(dec * DEG) * Math.sin(ra * DEG),
  z: Math.sin(dec * DEG),
  vmag,
  bv,
}))
export const STARS_SOURCE: string = catalogue.source

/** Pole (α0, δ0) and prime meridian W of the Moon, degrees (IAU WGCCRE 2015 report, the terms above 0.004°). */
export function moonOrientation(tMs: number): { alpha0: number; delta0: number; w: number } {
  const d = (tMs - J2000_MS) / 86_400_000
  const T = d / 36_525
  const E = (a: number, b: number) => (a + b * d) * DEG
  const E1 = E(125.045, -0.0529921)
  const E2 = E(250.089, -0.1059842)
  const E3 = E(260.008, 13.0120009)
  const E4 = E(176.625, 13.3407154)
  const E5 = E(357.529, 0.9856003)
  const E6 = E(311.589, 26.4057084)
  const E7 = E(134.963, 13.064993)
  const E8 = E(276.617, 0.3287146)
  const E9 = E(34.226, 1.7484877)
  const E10 = E(15.134, -0.1589763)
  const E11 = E(119.743, 0.0036096)
  const E12 = E(239.961, 0.1643573)
  const E13 = E(25.053, 12.9590088)
  const alpha0 =
    269.9949 + 0.0031 * T - 3.8787 * Math.sin(E1) - 0.1204 * Math.sin(E2) + 0.07 * Math.sin(E3) - 0.0172 * Math.sin(E4) + 0.0072 * Math.sin(E6) -
    0.0052 * Math.sin(E10) + 0.0043 * Math.sin(E13)
  const delta0 =
    66.5392 + 0.013 * T + 1.5419 * Math.cos(E1) + 0.0239 * Math.cos(E2) - 0.0278 * Math.cos(E3) + 0.0068 * Math.cos(E4) - 0.0029 * Math.cos(E6) +
    0.0009 * Math.cos(E7) + 0.0008 * Math.cos(E10) - 0.0009 * Math.cos(E13)
  const w =
    38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.561 * Math.sin(E1) + 0.1208 * Math.sin(E2) - 0.0642 * Math.sin(E3) + 0.0158 * Math.sin(E4) +
    0.0252 * Math.sin(E5) - 0.0066 * Math.sin(E6) - 0.0047 * Math.sin(E7) - 0.0046 * Math.sin(E8) + 0.0028 * Math.sin(E9) + 0.0052 * Math.sin(E10) +
    0.004 * Math.sin(E11) + 0.0019 * Math.sin(E12) - 0.0044 * Math.sin(E13)
  return { alpha0, delta0, w: ((w % 360) + 360) % 360 }
}

/** Rotation from the inertial frame (J2000) to the Moon-fixed frame, row-major 3 × 3. */
export function inertialToMoon(tMs: number): Float64Array {
  const { alpha0, delta0, w } = moonOrientation(tMs)
  const a = (90 + alpha0) * DEG
  const b = (90 - delta0) * DEG
  const c = w * DEG
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const cb = Math.cos(b)
  const sb = Math.sin(b)
  const cc = Math.cos(c)
  const sc = Math.sin(c)
  // Rz(c) Rx(b) Rz(a), each a rotation of the axes (passive): Rz(t) = [[cos, sin, 0], [-sin, cos, 0], [0, 0, 1]]
  return Float64Array.of(
    cc * ca - sc * cb * sa,
    cc * sa + sc * cb * ca,
    sc * sb,
    -sc * ca - cc * cb * sa,
    -sc * sa + cc * cb * ca,
    cc * sb,
    sb * sa,
    -sb * ca,
    cb,
  )
}

/** A vector of the inertial frame in the Moon-fixed frame. */
export function toMoon(m: Float64Array, x: number, y: number, z: number): [number, number, number] {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z]
}

/**
 * Azimuth and elevation (degrees) of every catalogue star at the site, into `out` as [az0, el0, az1, el1, ...]
 * (catalogue order: brightest first).
 */
export function starDirections(tMs: number, f: SiteFrame, out: Float32Array = new Float32Array(STARS.length * 2)): Float32Array {
  const m = inertialToMoon(tMs)
  // rows of (site frame) × (inertial → Moon): one 3 × 3 product per frame, then three dot products per star
  const row = (v: [number, number, number]) => [v[0] * m[0] + v[1] * m[3] + v[2] * m[6], v[0] * m[1] + v[1] * m[4] + v[2] * m[7], v[0] * m[2] + v[1] * m[5] + v[2] * m[8]]
  const e = row(f.east)
  const n = row(f.north)
  const u = row(f.up)
  for (let i = 0; i < STARS.length; i++) {
    const s = STARS[i]
    const ee = e[0] * s.x + e[1] * s.y + e[2] * s.z
    const nn = n[0] * s.x + n[1] * s.y + n[2] * s.z
    const uu = u[0] * s.x + u[1] * s.y + u[2] * s.z
    let az = Math.atan2(ee, nn) / DEG
    if (az < 0) az += 360
    out[2 * i] = az
    out[2 * i + 1] = Math.asin(uu > 1 ? 1 : uu < -1 ? -1 : uu) / DEG
  }
  return out
}

/** Colour of a star from its B − V index (blue-white to orange), as r, g, b in 0..255. Presentation, not photometry. */
export function starColour(bv: number | null): [number, number, number] {
  const t = Math.min(1, Math.max(0, ((bv ?? 0.6) + 0.3) / 1.9)) // −0.3 (hot, blue) .. 1.6 (cool, orange)
  const mix = (a: number, b: number, c: number) => (t < 0.5 ? a + (b - a) * (t / 0.5) : b + (c - b) * ((t - 0.5) / 0.5))
  return [Math.round(mix(170, 255, 255)), Math.round(mix(200, 250, 190)), Math.round(mix(255, 235, 130))]
}
