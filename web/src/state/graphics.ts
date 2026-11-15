/**
 * Graphics quality, the viewer's choice for a slow computer (the "Low graphics" switch in the top bar):
 *   - high (default): the LROC WAC photo draped on the Moon, and the horizon view's ground rendered from LOLA heights
 *     and the place's photo;
 *   - low: the globe shows the lit LOLA relief only (no photo tiles are loaded) at a pixel ratio of at most 1, and the
 *     horizon view draws a plain ground under the real LOLA skyline (no relief is loaded or ray cast).
 * The numbers (Sun, Earth, horizon masks, every metric) are the same in both: only the pictures change.
 *
 * Kept in this browser (localStorage, best effort): a convenience of this viewer, not part of a shared link.
 */
import { create } from 'zustand'

const STORAGE = 'lunatiks.graphics.v1'

function read(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(STORAGE) === 'low'
  } catch {
    return false
  }
}

function write(low: boolean): void {
  try {
    if (low) window.localStorage.setItem(STORAGE, 'low')
    else window.localStorage.removeItem(STORAGE)
  } catch {
    // private window or blocked storage: the choice lasts for this visit only
  }
}

interface Graphics {
  low: boolean
  setLow: (low: boolean) => void
}

export const useGraphics = create<Graphics>()((set) => ({
  low: read(),
  setLow: (low) => {
    write(low)
    set({ low })
  },
}))
