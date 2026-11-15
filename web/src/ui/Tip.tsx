/**
 * A mini information button (ⓘ) that opens a floating bubble with a short note, placed to the right of the
 * button (or the left, near the edge) with a pointer facing it. Rendered in a portal on `document.body`, so it
 * can never be clipped by a scrolling panel and never pushes the row's own layout around.
 * One bubble open at a time: opening one closes any other (a small module-level store below).
 */
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { IconInfo } from './icons'

const MARGIN = 8
const GAP = 12

const useOpenTip = create<{ id: string | null; set: (id: string | null) => void }>((set) => ({
  id: null,
  set: (id) => set({ id }),
}))

interface Placement {
  left: number
  top: number
  /** true: the bubble sits to the right of the button and the pointer is on its left edge. */
  right: boolean
  /** the pointer's centre, from the bubble's top edge: level with the button's centre. */
  pointerTop: number
}

const POINTER_INSET = 12

/**
 * Where the bubble goes: beside the button (right, or left when it does not fit), with its pointer level with the
 * button's centre. The bubble is centred on that height when it can be, and slid up or down to stay inside the
 * window; the pointer then moves along its edge so it still points at the button.
 */
export function place(btn: DOMRect, size: { w: number; h: number }, view: { w: number; h: number }): Placement {
  const cy = btn.top + btn.height / 2
  const w = Math.min(size.w, view.w - 2 * MARGIN)
  const fitsRight = btn.right + GAP + w + MARGIN <= view.w
  const fitsLeft = btn.left - GAP - w >= MARGIN
  const right = fitsRight || !fitsLeft
  const left = right ? Math.min(btn.right + GAP, view.w - MARGIN - w) : btn.left - GAP - w
  const top = Math.min(Math.max(MARGIN, cy - size.h / 2), Math.max(MARGIN, view.h - MARGIN - size.h))
  const pointerTop = Math.min(Math.max(POINTER_INSET, cy - top), Math.max(POINTER_INSET, size.h - POINTER_INSET))
  return { left, top, right, pointerTop }
}

export function Tip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  const btnRef = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const open = useOpenTip((s) => s.id === id)
  const setOpenId = useOpenTip((s) => s.set)
  const [pos, setPos] = useState<Placement | null>(null)

  const close = () => setOpenId(null)
  const toggle = () => setOpenId(open ? null : id)

  // Measured placement: the bubble's real size is known once it is in the page (first pass: an estimate, drawn
  // hidden; second pass: the exact place). Re-run on open and on every reposition request.
  const [tick, setTick] = useState(0)
  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null)
      return
    }
    const b = bubbleRef.current
    const size = { w: b?.offsetWidth || 280, h: b?.offsetHeight || 0 } // 280 = the CSS max width, until measured
    const next = place(btnRef.current.getBoundingClientRect(), size, { w: window.innerWidth, h: window.innerHeight })
    setPos((p) => (p && p.left === next.left && p.top === next.top && p.pointerTop === next.pointerTop && p.right === next.right ? p : next))
  }, [open, tick, pos === null])

  useEffect(() => {
    if (!open) return
    const reposition = () => setTick((t) => t + 1)
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (bubbleRef.current?.contains(t) || btnRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
      btnRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', reposition)
    // scroll of any ancestor of the button (capture: scroll does not bubble)
    document.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', reposition)
      document.removeEventListener('scroll', reposition, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="tip-btn"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`About ${label}`}
        title={`About ${label}`}
        onClick={toggle}
      >
        <IconInfo size={15} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="note"
            className={`tip-bubble${pos.right ? ' tip-right' : ' tip-left'}`}
            style={{ left: pos.left, top: pos.top }}
          >
            <span className="tip-pointer" style={{ top: pos.pointerTop }} aria-hidden="true" />
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}
