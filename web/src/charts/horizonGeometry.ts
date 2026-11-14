/**
 * Pure geometry of the horizon panorama: azimuth/elevation to SVG pixels, horizon silhouette,
 * day paths split at the 0°/360° seam, vertical exaggeration. No React, no DOM: unit-tested.
 *
 * Conventions (CLAUDE.md): azimuth clockwise from north in degrees, elevation in degrees.
 */

export interface Viewport {
  /** Left and right azimuth of the view; az1 > az0, may run past 360 (wraps). */
  az0: number
  az1: number
  /** Bottom elevation of the view. */
  el0: number
  /** Pixel size of the drawing area. */
  width: number
  height: number
  /** Vertical pixels per degree divided by horizontal pixels per degree (1 = true shape). */
  exaggeration: number
}

export const pxPerDegX = (v: Viewport) => v.width / (v.az1 - v.az0)
export const pxPerDegY = (v: Viewport) => pxPerDegX(v) * v.exaggeration
/** Top elevation that fits in the view. */
export const el1 = (v: Viewport) => v.el0 + v.height / pxPerDegY(v)

/** Normalise any angle to [0, 360). */
export function wrap360(az: number): number {
  const a = az % 360
  return a < 0 ? a + 360 : a
}

/** Azimuth to x; the azimuth is first unwrapped to the turn that lies inside or right after az0. */
export function xOf(v: Viewport, az: number): number {
  let a = wrap360(az)
  const base = wrap360(v.az0)
  if (a < base) a += 360
  return (a - base) * pxPerDegX(v)
}

export const yOf = (v: Viewport, el: number) => v.height - (el - v.el0) * pxPerDegY(v)

const NICE = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100]

/** Largest "nice" exaggeration so that the elevation span fits in the height of the view. */
export function niceExaggeration(spanDeg: number, width: number, height: number, azSpan = 360): number {
  const raw = height / Math.max(spanDeg, 1e-6) / (width / azSpan)
  let best = 1
  for (const n of NICE) if (n <= raw) best = n
  return best
}

/** Horizon elevation at any azimuth, linear between the stored samples (720 → 0.5° spacing). */
export function horizonAt(values: number[], az: number): number {
  const step = 360 / values.length
  const f = wrap360(az) / step
  const i = Math.floor(f)
  const a = values[i % values.length]
  const b = values[(i + 1) % values.length]
  return a + (b - a) * (f - i)
}

/** Closed SVG path of the terrain below the horizon line, for the azimuth range of the view. */
export function horizonPath(v: Viewport, values: number[]): string {
  const step = 360 / values.length
  const pts: string[] = []
  const first = Math.floor(v.az0 / step) * step
  for (let az = first; az <= v.az1 + step; az += step) {
    const x = (az - v.az0) * pxPerDegX(v)
    pts.push(`${r(x)},${r(yOf(v, horizonAt(values, az)))}`)
  }
  const xl = r((first - v.az0) * pxPerDegX(v))
  const xr = r((first + (pts.length - 1) * step - v.az0) * pxPerDegX(v))
  return `M${xl},${v.height} L${pts.join(' L')} L${xr},${v.height} Z`
}

/**
 * Polyline segments of a body's path. A new segment starts where the azimuth jumps across the
 * 0°/360° seam (more than 180° between two samples), so no line is drawn across the whole chart.
 */
export function pathSegments(v: Viewport, az: number[], el: number[]): [number, number][][] {
  const segs: [number, number][][] = []
  let cur: [number, number][] = []
  for (let i = 0; i < az.length; i++) {
    if (i > 0 && Math.abs(wrap360(az[i]) - wrap360(az[i - 1])) > 180) {
      if (cur.length > 1) segs.push(cur)
      cur = []
    }
    cur.push([xOf(v, az[i]), yOf(v, el[i])])
  }
  if (cur.length > 1) segs.push(cur)
  return segs
}

/** Elevation ticks at a round step that gives about `target` ticks across the view. */
export function elevationTicks(v: Viewport, target = 5): number[] {
  const span = el1(v) - v.el0
  const steps = [0.5, 1, 2, 5, 10, 15, 20, 30, 45]
  const step = steps.find((s) => span / s <= target) ?? 90
  const out: number[] = []
  for (let e = Math.ceil(v.el0 / step) * step; e <= el1(v); e += step) out.push(+e.toFixed(3))
  return out
}

export const COMPASS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }

const r = (x: number) => Math.round(x * 10) / 10
