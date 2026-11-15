/**
 * Which single-place section is open (opened from the map tool bar). With none open there is no side panel: the
 * map keeps the screen. Multiselect has its own panel and closes these.
 *
 * `trail` keeps the sections opened before the current one (Power → Horizon → …), so the drawer's Back button
 * returns to the previous section; closing the drawer forgets it. `resultsOpen` is the mission mode's
 * "Candidate sites" panel, which its close button hides and a new answer shows again.
 */
import { create } from 'zustand'

export type SectionId = 'horizon' | 'power' | 'link'

interface PanelsState {
  section: SectionId | null
  trail: SectionId[]
  setSection: (s: SectionId | null) => void
  /** Back to the section shown before this one (or close, with none before). */
  back: () => void
  resultsOpen: boolean
  setResultsOpen: (open: boolean) => void
}

export const usePanels = create<PanelsState>()((set, get) => ({
  section: null,
  trail: [],
  setSection: (section) => {
    const cur = get().section
    if (!section) return set({ section: null, trail: [] })
    if (section === cur) return
    // a section already in the trail is not stacked twice: going to it drops what came after it
    const at = get().trail.indexOf(section)
    const trail = at >= 0 ? get().trail.slice(0, at) : cur ? [...get().trail, cur].slice(-5) : []
    set({ section, trail })
  },
  back: () => {
    const trail = get().trail
    if (!trail.length) return set({ section: null })
    set({ section: trail[trail.length - 1], trail: trail.slice(0, -1) })
  },
  resultsOpen: true,
  setResultsOpen: (resultsOpen) => set({ resultsOpen }),
}))
