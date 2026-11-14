/**
 * Playback clock: simulated time advances at 1 hour, 6 hours or 1 day per real second. With reduced motion
 * requested by the system, play jumps in 6-hour steps once a second instead of animating (plan: "Movimiento
 * reducido"). Pure functions here; the React hook that drives them is in useClock.ts.
 */
import { MS_PER_HOUR } from './engine'

export const SPEEDS = [
  { id: '1h', label: '1 hour / s', simMsPerSec: MS_PER_HOUR },
  { id: '6h', label: '6 hours / s', simMsPerSec: 6 * MS_PER_HOUR },
  { id: '1d', label: '1 day / s', simMsPerSec: 24 * MS_PER_HOUR },
] as const

export type SpeedId = (typeof SPEEDS)[number]['id']

export const REDUCED_MOTION_STEP_MS = 6 * MS_PER_HOUR
/** Keyboard step for "previous / next" while paused. */
export const KEY_STEP_MS = MS_PER_HOUR

export const speedOf = (id: SpeedId) => SPEEDS.find((s) => s.id === id)!.simMsPerSec

/**
 * New simulated time after `realMs` of wall-clock time. Clamped to [min, max]; `ended` is true when the clamp
 * stopped playback at the end of the tables.
 */
export function advance(
  tMs: number,
  realMs: number,
  speed: SpeedId,
  bounds: [number, number],
  reducedMotion: boolean,
): { tMs: number; ended: boolean } {
  const delta = reducedMotion ? REDUCED_MOTION_STEP_MS : (speedOf(speed) * realMs) / 1000
  const next = tMs + delta
  if (next >= bounds[1]) return { tMs: bounds[1], ended: true }
  return { tMs: Math.max(bounds[0], next), ended: false }
}

/** Snap to a whole minute so URLs and API calls are stable. */
export const snapMinute = (tMs: number) => Math.round(tMs / 60_000) * 60_000

export function isoMinute(tMs: number): string {
  return new Date(snapMinute(tMs)).toISOString().replace(/:\d\d\.\d{3}Z$/, ':00Z')
}

/** Countdown text from the active instant (not from the system clock): "3 d 4 h 05 min". */
export function formatDuration(ms: number): string {
  const totalMin = Math.round(Math.abs(ms) / 60_000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `${d} d ${h} h ${String(m).padStart(2, '0')} min`
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`
  return `${m} min`
}

/** "2027-01-01 12:00 UTC" */
export function formatUtc(tMs: number): string {
  return `${new Date(snapMinute(tMs)).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
