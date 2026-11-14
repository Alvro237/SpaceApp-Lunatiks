/**
 * When the shadow pass runs, and at which size. Pure (times are passed in), so it is unit-tested without a GPU.
 *
 * - When the Sun moves (or the heights arrive), a FAST pass (1024 texels) runs at once, then at most every
 *   MIN_INTERVAL_MS while the Sun keeps moving (time playing or the slider dragged): a quarter of the pixels of the
 *   full pass, which took 11-13 ms of GPU time at 2048 (measured).
 * - Once the Sun has been still for SETTLE_MS, the FULL pass (2048 texels) runs in BANDS horizontal strips, one per
 *   frame (each a quarter of the pixels, so no single frame carries the whole 11-13 ms), into a texture that is shown
 *   only when every strip is done. A Sun change in between starts again from a fast pass.
 */
export const MIN_INTERVAL_MS = 60
export const SETTLE_MS = 250
export const BANDS = 4

export type ShadowStep = { kind: 'fast' } | { kind: 'full'; band: number; last: boolean }

export class ShadowSchedule {
  private dirty = true
  private lastFastAt = -Infinity
  private lastChangeAt = -Infinity
  /** The texture on screen is the fast one; the full pass has to run. */
  private fastShown = false
  /** Next strip of the full pass. */
  private band = 0

  /** The Sun moved, the mast changed or the heights arrived. */
  changed(now: number): void {
    this.dirty = true
    this.lastChangeAt = now
  }

  /** What to render this frame, or null. */
  next(now: number, playing: boolean): ShadowStep | null {
    if (this.dirty) {
      const moving = playing || now - this.lastFastAt < SETTLE_MS
      if (moving && now - this.lastFastAt < MIN_INTERVAL_MS) return null
      this.dirty = false
      this.lastFastAt = now
      this.fastShown = true
      this.band = 0
      return { kind: 'fast' }
    }
    if (!this.fastShown || playing || now - this.lastChangeAt <= SETTLE_MS) return null
    const band = this.band++
    const last = this.band === BANDS
    if (last) this.fastShown = false
    return { kind: 'full', band, last }
  }
}
