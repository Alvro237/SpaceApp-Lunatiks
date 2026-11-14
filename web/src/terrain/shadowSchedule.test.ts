// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BANDS, MIN_INTERVAL_MS, SETTLE_MS, ShadowSchedule, type ShadowStep } from './shadowSchedule'

/** Run the schedule frame by frame (16 ms apart) from t0 to t1; `sun(t)` says whether the Sun moved that frame. */
function run(s: ShadowSchedule, t0: number, t1: number, sun: (t: number) => boolean, playing = false): [number, ShadowStep][] {
  const out: [number, ShadowStep][] = []
  for (let t = t0; t <= t1; t += 16) {
    if (sun(t)) s.changed(t)
    const step = s.next(t, playing)
    if (step) out.push([t, step])
  }
  return out
}

describe('shadow pass schedule', () => {
  it('answers a single change with a fast pass, then the full pass in strips once the Sun is still', () => {
    const s = new ShadowSchedule()
    const steps = run(s, 1000, 2000, (t) => t === 1000)
    expect(steps[0]).toEqual([1000, { kind: 'fast' }])
    const full = steps.slice(1)
    expect(full.map(([, x]) => x)).toEqual(Array.from({ length: BANDS }, (_, band) => ({ kind: 'full', band, last: band === BANDS - 1 })))
    // the strips start after the settle time, one per frame
    expect(full[0][0] - 1000).toBeGreaterThan(SETTLE_MS)
    expect(full[BANDS - 1][0] - full[0][0]).toBe(16 * (BANDS - 1))
  })

  it('runs only fast passes, spaced, while the slider is dragged, and ends with exactly one full pass', () => {
    const s = new ShadowSchedule()
    const steps = run(s, 0, 2000, (t) => t <= 800)
    const fast = steps.filter(([, x]) => x.kind === 'fast').map(([t]) => t)
    const full = steps.filter(([, x]) => x.kind === 'full')
    for (let i = 1; i < fast.length; i++) expect(fast[i] - fast[i - 1]).toBeGreaterThanOrEqual(MIN_INTERVAL_MS)
    expect(fast[fast.length - 1]).toBeLessThanOrEqual(800 + MIN_INTERVAL_MS)
    expect(full).toHaveLength(BANDS)
    expect(full[0][0]).toBeGreaterThan(800 + SETTLE_MS)
    expect(full.filter(([, x]) => x.kind === 'full' && x.last)).toHaveLength(1)
  })

  it('never runs the full pass while playing, and runs it once playing stops', () => {
    const s = new ShadowSchedule()
    const playing = run(s, 0, 1000, () => true, true)
    expect(playing.every(([, x]) => x.kind === 'fast')).toBe(true)
    // the last change of the playback (held back by the interval) is drawn fast first, then the full pass
    const after = run(s, 1016, 2000, () => false, false)
    expect(after.map(([, x]) => x.kind)).toEqual(['fast', ...Array(BANDS).fill('full')])
  })

  it('starts again from a fast pass when the Sun moves between strips', () => {
    const s = new ShadowSchedule()
    run(s, 0, 0, () => true)
    // first strip at 400 ms, then the Sun moves
    expect(s.next(400, false)).toEqual({ kind: 'full', band: 0, last: false })
    s.changed(416)
    expect(s.next(416, false)).toEqual({ kind: 'fast' })
    const rest = run(s, 432, 1200, () => false)
    expect(rest.map(([, x]) => (x.kind === 'full' ? x.band : -1))).toEqual(Array.from({ length: BANDS }, (_, i) => i))
  })

  it('does nothing while nothing changes', () => {
    const s = new ShadowSchedule()
    run(s, 0, 2000, (t) => t === 0)
    expect(run(s, 2016, 5000, () => false)).toEqual([])
  })
})
