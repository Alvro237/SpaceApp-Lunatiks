/**
 * The two buttons every panel header shares, so they look and read the same everywhere:
 *   - CloseButton: an ✕ icon that closes the panel (Escape does the same where the panel handles it).
 *   - BackButton: a chevron and a short word that returns to the step or panel shown before.
 * Both are real buttons with an accessible name that says what they close or where they go back to.
 * BackToNavigator is the same Back look as a link, at the top of the text pages (Data & methods, Learn).
 */
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { IconBack, IconClose } from './icons'

export function CloseButton({
  label,
  onClick,
  size = 18,
  esc = true,
  className = '',
}: {
  label: string
  onClick: () => void
  size?: number
  /** The panel also closes with Escape (said in the tooltip). */
  esc?: boolean
  className?: string
}) {
  return (
    <button type="button" className={`icon panel-close ${className}`} onClick={onClick} aria-label={label} title={esc ? `${label} (Esc)` : label}>
      <IconClose size={size} />
    </button>
  )
}

export function BackButton({ label, onClick, children, className = '' }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" className={`panel-back ${className}`} onClick={onClick} aria-label={label} title={label}>
      <IconBack size={16} />
      <span>{children}</span>
    </button>
  )
}

/** Goes back in the history when the page was opened from the app (the navigator's place, date and panels come
 * back with its URL); a page opened directly links to the navigator's start. */
export function BackToNavigator() {
  const navigate = useNavigate()
  return (
    <Link
      className="panel-back page-back"
      to="/"
      onClick={(e) => {
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
        if (idx > 0) {
          e.preventDefault()
          navigate(-1)
        }
      }}
    >
      <IconBack size={16} />
      <span>Back to the navigator</span>
    </Link>
  )
}
