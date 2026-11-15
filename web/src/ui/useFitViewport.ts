import { type RefObject, useLayoutEffect } from 'react'

/** Gap kept between a floating panel and the window edge, px. */
const MARGIN = 8
/** A panel is never capped below this height, px: it scrolls inside instead of becoming a sliver. */
const MIN_HEIGHT = 160

/**
 * Keeps a floating panel (a popover, a menu, a result list) inside the window. The panel is placed by CSS under
 * its button; this shifts it sideways when it would cross the left or right edge and caps its height to the room
 * below its top edge, so its own scroll takes over. It runs when the panel opens and on every window resize.
 */
export function useFitViewport(ref: RefObject<HTMLElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!active || !el) return
    const fit = () => {
      el.style.translate = ''
      el.style.maxHeight = ''
      el.style.top = ''
      el.style.bottom = ''
      const r = el.getBoundingClientRect()
      // not laid out (hidden, or a test DOM): leave the stylesheet's placement alone
      if (r.width === 0 || r.height === 0) return
      const w = document.documentElement.clientWidth
      const h = window.innerHeight
      let dx = 0
      if (r.right > w - MARGIN) dx = w - MARGIN - r.right
      if (r.left + dx < MARGIN) dx = MARGIN - r.left
      if (dx !== 0) el.style.translate = `${Math.round(dx)}px 0`
      const room = h - Math.max(r.top, 0) - MARGIN
      if (r.height > room) {
        // a button low on the screen (a phone's column): open the panel above it when there is more room there
        const anchor = el.parentElement?.getBoundingClientRect()
        const gap = anchor ? Math.max(0, r.top - anchor.bottom) : 0
        const above = anchor ? anchor.top - gap - MARGIN : 0
        if (anchor && room < MIN_HEIGHT && above > room) {
          el.style.top = 'auto'
          el.style.bottom = `calc(100% + ${Math.round(gap)}px)`
          if (r.height > above) el.style.maxHeight = `${Math.round(above)}px`
        } else {
          el.style.maxHeight = `${Math.max(MIN_HEIGHT, Math.round(room))}px`
        }
      }
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [ref, active])
}
