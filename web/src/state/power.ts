/**
 * Power model inputs and the last /power answer, shared between the Power section (right panel) and the
 * timeline (battery chart). Kept outside the panel so switching sections does not lose what the planner typed,
 * and tagged with the scenario it was computed for so a stale answer is never drawn over a different window.
 */
import { create } from 'zustand'
import type { PowerResponse } from '../api/types'
import { type Selection, useApp } from './store'

export type PowerKey =
  | 'panel_area_m2'
  | 'cell_efficiency'
  | 'derating'
  | 'battery_capacity_wh'
  | 'battery_initial_soc'
  | 'battery_min_soc'
  | 'charge_efficiency'
  | 'discharge_efficiency'
  | 'load_w'
  | 'night_load_w'
export type PowerFields = Partial<Record<PowerKey, string>>

/** What the advanced model computes: the array alone, or the array feeding a battery and a load. */
export type PowerModel = 'array' | 'battery'

export interface ScenarioKey {
  selection: Selection
  startMs: number
  durationH: number
  mastM: number
  panel: string
}

export const scenarioId = (k: ScenarioKey) =>
  JSON.stringify([k.selection, k.startMs, k.durationH, k.mastM, k.panel])

interface PowerState {
  model: PowerModel
  fields: PowerFields
  usedExample: boolean
  /** GCR quality factor typed by the planner (no cited default yet), for the radiation risk index. */
  qualityFactor: string
  result: PowerResponse | null
  resultFor: string | null
  setModel: (m: PowerModel) => void
  setQualityFactor: (q: string) => void
  setFields: (f: PowerFields, usedExample?: boolean) => void
  setResult: (r: PowerResponse | null, forScenario: string | null) => void
}

export const usePowerStore = create<PowerState>((set) => ({
  model: 'array',
  fields: {},
  usedExample: false,
  qualityFactor: '',
  result: null,
  resultFor: null,
  setModel: (model) => set({ model }),
  setQualityFactor: (qualityFactor) => set({ qualityFactor }),
  setFields: (fields, usedExample = false) => set({ fields, usedExample }),
  setResult: (result, resultFor) => set({ result, resultFor }),
}))

/** Identity of the scenario on screen (place, window, mast, panel): a power answer is valid only for it. */
export function useScenarioId(): string {
  const selection = useApp((s) => s.selection)
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const mastM = useApp((s) => s.mastM)
  const panel = useApp((s) => s.panel)
  return scenarioId({ selection, startMs, durationH, mastM, panel })
}

/** The last /power answer if it belongs to the scenario on screen, else null. */
export function useCurrentPowerResult(): PowerResponse | null {
  const sid = useScenarioId()
  const result = usePowerStore((s) => s.result)
  const resultFor = usePowerStore((s) => s.resultFor)
  return result && resultFor === sid ? result : null
}
