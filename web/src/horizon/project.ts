/**
 * Geometry of the first-person horizon view. The view is a linear (equirectangular) projection centred on the
 * camera direction: one screen pixel is the same number of degrees across and up, so the azimuth and elevation
 * scales read directly. That is exact for the angles shown, and near the horizon (where the Sun and the Earth
 * stay at the poles) it is also what a narrow camera would see.
 *
 * Earth phase as seen from the Moon: with the Sun at infinity, the Earth's phase angle is 180° minus the
 * Sun-Earth elongation ε in the lunar sky, so the lit fraction of the disc is k = (1 − cos ε) / 2, and the bright
 * limb faces the Sun along the great circle (position angle χ, measured from "up" towards increasing azimuth).
 */
const DEG = Math.PI / 180

/** Angle in (−180, 180]. */
export function wrap180(a: number): number {
  const w = (((a + 180) % 360) + 360) % 360 - 180
  return w === -180 ? 180 : w
}

export const wrap360 = (a: number) => ((a % 360) + 360) % 360

export interface Camera {
  yaw: number
  pitch: number
  /** Degrees per CSS pixel, the same across and up. */
  degPerPx: number
  /** Screen point the camera direction falls on (centre of the free map area). */
  cx: number
  cy: number
}

export function cameraFor(yaw: number, pitch: number, fov: number, freeWidth: number, cx: number, cy: number): Camera {
  return { yaw, pitch, degPerPx: fov / Math.max(120, freeWidth), cx, cy }
}

/** Screen position of a direction (azimuth, elevation in degrees). */
export function project(c: Camera, az: number, el: number): { x: number; y: number } {
  return { x: c.cx + wrap180(az - c.yaw) / c.degPerPx, y: c.cy - (el - c.pitch) / c.degPerPx }
}

/** Direction under a screen point. */
export function unproject(c: Camera, x: number, y: number): { az: number; el: number } {
  return { az: wrap360(c.yaw + (x - c.cx) * c.degPerPx), el: c.pitch - (y - c.cy) * c.degPerPx }
}

/** Share of the horizontal field kept between the skyline and the centre when following a low body. */
export const SKYLINE_MARGIN = 0.12

/**
 * Pitch (degrees) that keeps a followed body in view without losing the sky: the body's elevation, raised when the
 * body is below or just above the skyline at its azimuth so that the skyline sits SKYLINE_MARGIN × fov below the
 * centre. Then the sky above it, with the window's Sun and Earth tracks, fills the view instead of the ground (a body
 * below the skyline is drawn behind the terrain, as it is seen).
 */
export function followPitch(bodyEl: number, skylineEl: number, fov: number): number {
  return Math.min(60, Math.max(bodyEl, skylineEl + SKYLINE_MARGIN * fov))
}

const unit = (az: number, el: number): [number, number, number] => [Math.cos(el * DEG) * Math.sin(az * DEG), Math.cos(el * DEG) * Math.cos(az * DEG), Math.sin(el * DEG)]

/** Angular separation of two directions, degrees. */
export function separation(az1: number, el1: number, az2: number, el2: number): number {
  const a = unit(az1, el1)
  const b = unit(az2, el2)
  const d = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  return Math.acos(d) / DEG
}

/**
 * Earth phase for an observer on the Moon: lit fraction k (0 = new Earth, 1 = full Earth) and the position angle χ
 * of the bright limb, degrees from "up" (towards the zenith) clockwise towards increasing azimuth.
 */
export function earthPhase(sun: { az: number; el: number }, earth: { az: number; el: number }): { lit: number; brightLimbDeg: number } {
  const eps = separation(sun.az, sun.el, earth.az, earth.el) * DEG
  const lit = (1 - Math.cos(eps)) / 2
  const dA = (sun.az - earth.az) * DEG
  const ds = sun.el * DEG
  const de = earth.el * DEG
  const chi = Math.atan2(Math.cos(ds) * Math.sin(dA), Math.sin(ds) * Math.cos(de) - Math.cos(ds) * Math.sin(de) * Math.cos(dA))
  return { lit, brightLimbDeg: chi / DEG }
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
export const compass16 = (az: number) => COMPASS[Math.round(wrap360(az) / 22.5) % 16]

/** Tick step (degrees) giving about `targetPx` pixels between ticks. */
export function tickStep(degPerPx: number, targetPx = 70): number {
  const raw = degPerPx * targetPx
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 45, 90]) if (s >= raw) return s
  return 90
}
