/**
 * The power inputs the planner chose to apply to every compared place. Typing in the parameters panel changes the
 * form only; the API is asked when "Apply" is pressed (not on every keystroke), and the applied snapshot is kept here
 * so the results table and the requests read the same values. The place, window, mast and panel are not part of the
 * snapshot: they are read live, so a changed window recomputes the comparison. The radio link has its own settings
 * (state/link.ts) and is computed by the link panel's own queries.
 */
import { create } from 'zustand'
import type { PowerFields, PowerModel } from '../state/power'

export interface AppliedPower {
  model: PowerModel
  fields: PowerFields
  commsCritical: boolean
  includeSizing: boolean
}

interface AppliedState {
  power: AppliedPower | null
  apply: (power: AppliedPower | null) => void
}

export const useApplied = create<AppliedState>((set) => ({
  power: null,
  apply: (power) => set({ power }),
}))
