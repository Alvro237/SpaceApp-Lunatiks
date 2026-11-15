/**
 * Filters button of the top bar: which rows the timeline draws besides the sunlit row and the Link row. For now one
 * option, the "Earth up" row (when the place sees the Earth, whatever the antennas do), off by default because the
 * Link row already answers "can we talk to the Earth". A native checkbox in a small popover; Escape or a click outside
 * closes it and focus returns to the button.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { useLinkStore } from '../state/link'
import { IconFilter } from '../ui/icons'

export function TimelineFilters() {
  const id = useId()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const showEarthRow = useLinkStore((s) => s.showEarthRow)
  const set = useLinkStore((s) => s.set)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="tl-filters">
      <button ref={button} type="button" className="filters-btn" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
        <IconFilter size={16} />
        <span>Filters</span>
      </button>
      {open && (
        <div ref={box} id={id} className="filters-pop" role="group" aria-label="Timeline rows">
          <span className="band-sub">Timeline rows</span>
          <label className="check-row">
            <input type="checkbox" checked={showEarthRow} onChange={(e) => set({ showEarthRow: e.target.checked })} />
            <span>Earth above the horizon</span>
          </label>
        </div>
      )}
    </div>
  )
}
