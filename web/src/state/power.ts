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
  // level 4, colony analysis (temperatures in °C here, sent as kelvin)
  | 'critical_load_w'
  | 'deferrable_load_w'
  | 'comms_load_w'
  | 'shed_soc'
  | 'max_charge_w'
  | 'max_discharge_w'
  | 'crew_count'
  | 't_set_c'
  | 't_min_c'
  | 'ua_w_k'
  | 'hab_area_m2'
  | 'skin_absorptivity'
  | 'skin_emissivity'
  | 'structure_mass_kg'
  | 'structure_specific_heat_j_kgk'
  | 'air_volume_m3'
  | 'air_pressure_pa'
  | 'metabolic_w_per_crew'
export type PowerFields = Partial<Record<PowerKey, string>>

/** What the advanced model computes: the array alone, or the array feeding a battery and a load. */
export type PowerModel = 'array' | 'battery' | 'colony'

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
  /** Level 4 switches. Sizing is on by default, as in the API (it adds about one second). */
  comms_critical: boolean
  include_sizing: boolean
  result: PowerResponse | null
  resultFor: string | null
  setModel: (m: PowerModel) => void
  setQualityFactor: (q: string) => void
  setFlag: (k: 'comms_critical' | 'include_sizing', v: boolean) => void
  setFields: (f: PowerFields, usedExample?: boolean) => void
  setResult: (r: PowerResponse | null, forScenario: string | null) => void
}

export const usePowerStore = create<PowerState>((set) => ({
  model: 'array',
  fields: {},
  usedExample: false,
  qualityFactor: '',
  comms_critical: false,
  include_sizing: true,
  result: null,
  resultFor: null,
  setModel: (model) => set({ model }),
  setQualityFactor: (qualityFactor) => set({ qualityFactor }),
  setFlag: (k, v) => set({ [k]: v }),
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
