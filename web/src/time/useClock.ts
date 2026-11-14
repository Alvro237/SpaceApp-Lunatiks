/**
 * Drives playback: while playing, the active instant advances every animation frame (or by 6-hour jumps
 * once a second when the system asks for reduced motion). Space toggles play anywhere outside a form field;
 * "," and "." step one hour back and forward.
 */
import { useEffect } from 'react'
import { useApp } from '../state/store'
import { KEY_STEP_MS, advance } from './clock'
import { useEphemeris } from './hooks'

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

export function useClock(): void {
  const eph = useEphemeris().data
  const playing = useApp((s) => s.playing)

  useEffect(() => {
    if (!playing || !eph) return
    const s0 = useApp.getState()
    const seg = eph.table.coverage().find(([a, b]) => a <= s0.tMs && s0.tMs <= b) ?? eph.table.coverage()[0]
    const tick = (realMs: number) => {
      const s = useApp.getState()
      const r = advance(s.tMs, realMs, s.speed, seg, reducedMotion())
      s.setTime(r.tMs)
      if (r.ended) s.setPlaying(false)
    }
    if (reducedMotion()) {
      const id = setInterval(() => tick(1000), 1000)
      return () => clearInterval(id)
    }
    let last = performance.now()
    let raf = requestAnimationFrame(function frame(now) {
      tick(Math.min(now - last, 100))
      last = now
      raf = requestAnimationFrame(frame)
    })
    return () => cancelAnimationFrame(raf)
  }, [playing, eph])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, select, textarea, button, [role="slider"], [contenteditable="true"]')) return
      const s = useApp.getState()
      if (e.key === ' ') {
        e.preventDefault()
        s.setPlaying(!s.playing)
      } else if (e.key === '.' && !s.playing) s.setTime(s.tMs + KEY_STEP_MS)
      else if (e.key === ',' && !s.playing) s.setTime(s.tMs - KEY_STEP_MS)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
