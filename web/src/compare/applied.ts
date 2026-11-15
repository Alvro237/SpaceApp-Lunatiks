/**
 * The power and link inputs the planner chose to apply to every compared place. Typing in the parameters panel
 * changes the forms only; the API is asked when "Apply" is pressed (not on every keystroke), and the applied
 * snapshot is kept here so the results table and the requests read the same values. The place, window, mast and
 * panel are not part of the snapshot: they are read live, so a changed window recomputes the comparison.
 */
import { create } from 'zustand'
import type { LinkBand, LinkDirection } from '../api/types'
import type { LinkBudgetFields, LinkNetwork } from '../state/link'
import type { PowerFields, PowerModel } from '../state/power'

export interface AppliedPower {
  model: PowerModel
  fields: PowerFields
  commsCritical: boolean
  includeSizing: boolean
}
export interface AppliedLink {
  level: 1 | 2
  networks: LinkNetwork[]
  direction: LinkDirection
  band: LinkBand
  budget: LinkBudgetFields
}

interface AppliedState {
  power: AppliedPower | null
  link: AppliedLink | null
  apply: (p: { power?: AppliedPower | null; link?: AppliedLink | null }) => void
}

export const useApplied = create<AppliedState>((set) => ({
  power: null,
  link: null,
  apply: (p) => set((s) => ({ power: p.power === undefined ? s.power : p.power, link: p.link === undefined ? s.link : p.link })),
}))
