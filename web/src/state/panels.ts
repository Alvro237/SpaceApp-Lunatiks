/**
 * Which section of the place panel is open. The navigator reads it to fold the left panel and widen the right
 * one while a section is open ("focus mode"), so the section has room to spread across instead of down.
 */
import { create } from 'zustand'

export type SectionId = 'horizon' | 'power' | 'link' | 'compare'

export const usePanels = create<{ section: SectionId | null; setSection: (s: SectionId | null) => void }>()((set) => ({
  section: null,
  setSection: (section) => set({ section }),
}))
