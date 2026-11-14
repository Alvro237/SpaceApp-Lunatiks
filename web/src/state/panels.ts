/**
 * Which single-place section is open (opened from the map tool bar). With none open there is no side panel: the
 * map keeps the screen. Multiselect has its own panel and closes these.
 */
import { create } from 'zustand'

export type SectionId = 'horizon' | 'power' | 'link'

export const usePanels = create<{ section: SectionId | null; setSection: (s: SectionId | null) => void }>()((set) => ({
  section: null,
  setSection: (section) => set({ section }),
}))
