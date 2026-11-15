/**
 * Cinematic mode's two controls.
 *   CinematicButton: in the top bar, enters the mode.
 *   CinematicExit: the only control left on screen while the mode is on. It takes the focus, so Enter, Space or
 *   Escape leave at once; for the pointer it fades away after a few still seconds (with the cursor) and comes back
 *   when the mouse moves. Escape leaves from anywhere.
 */
import { useEffect, useRef, useState } from 'react'
import { useCinematic } from '../state/cinematic'
import { IconCinema, IconClose } from '../ui/icons'
import './cinematic.css'

const HIDE_AFTER_MS = 2500

export function CinematicButton() {
  const enter = useCinematic((s) => s.enter)
  return (
    <button type="button" className="cinema-btn" onClick={enter} aria-label="Cinematic mode" title="Cinematic mode: hide every panel and let the Moon turn (Esc to leave)">
      <IconCinema size={18} />
      <span className="cinema-btn-text">Cinematic</span>
    </button>
  )
}

export function CinematicExit() {
  const exit = useCinematic((s) => s.exit)
  const btn = useRef<HTMLButtonElement>(null)
  const [awake, setAwake] = useState(true)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    btn.current?.focus({ preventScroll: true })
    let t = window.setTimeout(() => setAwake(false), HIDE_AFTER_MS)
    const wake = () => {
      setAwake(true)
      window.clearTimeout(t)
      t = window.setTimeout(() => setAwake(false), HIDE_AFTER_MS)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        exit()
      } else wake()
    }
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      document.removeEventListener('keydown', onKey)
      // back to the button that entered the mode, once the bars are shown again
      requestAnimationFrame(() => (opener?.isConnected ? opener : document.querySelector<HTMLElement>('.cinema-btn'))?.focus())
    }
  }, [exit])

  return (
    <button ref={btn} type="button" className={`cinema-exit${awake ? '' : ' is-asleep'}`} onClick={exit} aria-label="Leave cinematic mode" title="Leave cinematic mode (Esc)">
      <IconClose size={16} />
      <span>Leave cinematic mode</span>
    </button>
  )
}
