/**
 * A mini information button (ⓘ) that reveals a short note in place, so labels and fields stay clean and the
 * explanation is one tap or key press away. The note is inline (no floating layer): it cannot be clipped by a
 * scrolling panel, it is read in order by screen readers, and Escape closes it. Place it inside a flex row; the
 * note takes the full row width underneath (see .tip-note).
 */
import { type ReactNode, useId, useState } from 'react'
import { IconInfo } from './icons'

export function Tip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="tip-btn"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`About ${label}`}
        title={`About ${label}`}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation()
            setOpen(false)
          }
        }}
      >
        <IconInfo size={15} />
      </button>
      {open && (
        <span id={id} role="note" className="tip-note">
          {children}
        </span>
      )}
    </>
  )
}
