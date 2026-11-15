/**
 * A button that opens a small panel under it (disclosure pattern, not a modal): aria-expanded on the button, the
 * panel labelled by it, Escape or a click outside closes it and focus returns to the button. Used by the map's top
 * bars (dates, coordinates, layers, mission filters) so the map keeps the whole screen until a tool is needed.
 * `persistent` keeps it open on clicks outside (the mission panel, whose region is placed by clicking the map).
 */
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { useFitViewport } from './useFitViewport'

export function Popover({
  label,
  buttonLabel,
  button,
  className = '',
  buttonClass = '',
  align = 'left',
  pressed,
  persistent = false,
  children,
}: {
  /** Accessible name of the button (and of the panel). */
  label: string
  /** Accessible name of the button alone, when it shows text: it must contain that text (WCAG 2.5.3). */
  buttonLabel?: string
  /** What the button shows: an icon, or an icon and a short value. */
  button: ReactNode
  className?: string
  buttonClass?: string
  align?: 'left' | 'right'
  /** Marks the button as "on" while closed too (e.g. filters set). */
  pressed?: boolean
  /** Stay open on clicks outside (closed by its button or Escape). */
  persistent?: boolean
  children: ReactNode | ((close: () => void) => ReactNode)
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // the panel opens under its button; on a narrow or short window it is moved and capped to stay on screen
  useFitViewport(panel, open)
  // by id, not by ref: `close` is handed to the panel's content during render
  const close = () => {
    setOpen(false)
    document.getElementById(`${id}-b`)?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        btn.current?.focus()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (!persistent && !root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open, persistent])

  return (
    <div className={`pop ${className}`} ref={root}>
      <button
        ref={btn}
        id={`${id}-b`}
        type="button"
        className={`pop-btn ${buttonClass}${pressed ? ' is-set' : ''}`}
        aria-expanded={open}
        aria-controls={open ? `${id}-p` : undefined}
        aria-label={buttonLabel ?? label}
        title={label}
        onClick={() => setOpen(!open)}
      >
        {button}
      </button>
      {open && (
        <div ref={panel} id={`${id}-p`} className={`pop-panel pop-${align}`} role="group" aria-label={label}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}
