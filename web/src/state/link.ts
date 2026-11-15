/**
 * Radio link inputs (POST /api/v1/link), kept outside the panels so the comparison and any later link section
 * share what the planner typed. Nothing is pre-filled except what the API itself defaults (all three networks,
 * downlink, level 1): the budget values (EIRP, data rate) have no cited default, so the caller types them.
 * The share of the Earth's disc that counts as contact is the analysis setting `commsMinFraction` (Settings).
 */
import { create } from 'zustand'
import type { LinkBand, LinkDirection } from '../api/types'

export type LinkNetwork = 'dsn' | 'estrack' | 'jaxa'
export const LINK_NETWORKS: { id: LinkNetwork; label: string }[] = [
  { id: 'dsn', label: 'NASA DSN' },
  { id: 'estrack', label: 'ESA ESTRACK' },
  { id: 'jaxa', label: 'JAXA' },
]

export type LinkBudgetKey =
  | 'transmit_eirp_dbw'
  | 'data_rate_bps'
  | 'receive_gt_db_per_k'
  | 'frequency_ghz'
  | 'required_ebn0_db'
  | 'other_losses_db'
  | 'min_margin_db'
export type LinkBudgetFields = Partial<Record<LinkBudgetKey, string>>

interface LinkState {
  /** 1 = geometric contact; 2 = adds the link budget. */
  level: 1 | 2
  networks: LinkNetwork[]
  direction: LinkDirection
  band: LinkBand
  budget: LinkBudgetFields
  setLevel: (l: 1 | 2) => void
  toggleNetwork: (n: LinkNetwork) => void
  setDirection: (d: LinkDirection) => void
  setBand: (b: LinkBand) => void
  setBudget: (b: LinkBudgetFields) => void
}

export const useLinkStore = create<LinkState>((set) => ({
  level: 1,
  networks: ['dsn', 'estrack', 'jaxa'],
  direction: 'downlink',
  band: 'X',
  budget: {},
  setLevel: (level) => set({ level }),
  toggleNetwork: (n) =>
    set((s) => ({ networks: s.networks.includes(n) ? s.networks.filter((x) => x !== n) : [...s.networks, n] })),
  setDirection: (direction) => set({ direction }),
  setBand: (band) => set({ band }),
  setBudget: (budget) => set({ budget }),
}))
