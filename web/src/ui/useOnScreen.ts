import { useEffect, useState } from 'react'

/**
 * Whether an element shows any part of itself in the window. The 3D views pause their render loop while it is false:
 * on a phone the map is one block of a scrolling column, and once the reader scrolls down to a panel the globe would
 * otherwise keep drawing 60 frames a second that nobody sees (battery, heat, a slower panel).
 *
 * Pass the element from a callback ref (`ref={setEl}`). True until it is measured, and always true where the browser
 * has no IntersectionObserver (tests), so nothing is ever paused by mistake.
 */
export function useOnScreen(el: Element | null): boolean {
  const [on, setOn] = useState(true)
  useEffect(() => {
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setOn(entry.isIntersecting))
    io.observe(el)
    return () => {
      io.disconnect()
      setOn(true)
    }
  }, [el])
  return on
}
