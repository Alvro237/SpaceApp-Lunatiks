/**
 * Screen space the floating panels cover, in CSS pixels from each edge. The map keeps its centre of view in
 * the free area between them, so the Moon is never hidden behind a panel.
 */
import { create } from 'zustand'

export interface Insets {
  left: number
  right: number
  top: number
  bottom: number
}

export const useInsets = create<Insets & { setInsets: (i: Insets) => void }>()((set) => ({
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  setInsets: (i) => set(i),
}))
