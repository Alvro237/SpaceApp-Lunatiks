/**
 * Cinematic mode: every panel and bar steps aside and the whole Moon turns by itself (globe/orbit.ts, setCinematic).
 * It is a view of the moment, not part of a shared scenario, so it is not in the address. Entering it shows the
 * globe and closes the horizon view; leaving it puts back the polar map if that was the view.
 */
import { create } from 'zustand'
import { usePanels } from './panels'
import { type Scale, useApp } from './store'

interface CinematicState {
  on: boolean
  /** The view before entering, restored on leaving. */
  prevScale: Scale | null
  enter: () => void
  exit: () => void
}

export const useCinematic = create<CinematicState>()((set, get) => ({
  on: false,
  prevScale: null,
  enter: () => {
    if (get().on) return
    const app = useApp.getState()
    if (usePanels.getState().section === 'horizon') usePanels.getState().setSection(null)
    set({ on: true, prevScale: app.scale })
    if (app.scale !== 'globe') app.set({ scale: 'globe' })
  },
  exit: () => {
    if (!get().on) return
    const prev = get().prevScale
    set({ on: false, prevScale: null })
    if (prev && prev !== useApp.getState().scale) useApp.getState().set({ scale: prev })
  },
}))
