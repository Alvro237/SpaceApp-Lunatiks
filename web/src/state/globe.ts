/**
 * Whether the Moon is anchored: pinned in place instead of turning slowly by itself after 20 s without a touch.
 * Kept outside the globe view so it survives going down to the polar map and back.
 */
import { create } from 'zustand'

export const useGlobe = create<{ anchored: boolean; setAnchored: (a: boolean) => void }>()((set) => ({
  anchored: false,
  setAnchored: (anchored) => set({ anchored }),
}))
