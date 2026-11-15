/**
 * Builds the POST /api/v1/power body from the fields typed in the Power section. Shared by the Power section (one
 * place) and the comparison (every place picked with Multiselect), so both send exactly the same inputs.
 * Nothing is defaulted here: a missing required field throws an Error whose message names it (docs/api-guide-mech.md).
 */
import type { PowerRequest } from '../api/types'
import type { PowerFields, PowerKey, PowerModel } from '../state/power'
import type { Selection } from '../state/store'
import { isoMinute } from '../time/clock'
import { ALL_FIELDS, SYNODIC_MONTH_H } from './powerSpecs'

const KELVIN = 273.15

/** API level of each model in the Power section. */
export const MODEL_LEVEL: Record<PowerModel, 2 | 3 | 4> = { array: 2, battery: 3, colony: 4 }

/** Keep within the API's 20 000-sample limit for long windows. */
export const stepFor = (durationH: number) => Math.max(60, Math.ceil((durationH * 60) / 19_000))

/** The place part of a request: a catalogue id, or coordinates with the skyline traced over LOLA terrain. */
export function placeFields(sel: Selection | null) {
  if (!sel) return {}
  return sel.kind === 'site' ? { site_id: sel.id } : { lat: sel.lat, lon: sel.lon, horizon: 'terrain' as const }
}

export interface PowerInputs {
  model: PowerModel
  fields: PowerFields
  commsCritical: boolean
  includeSizing: boolean
  panel: PowerRequest['panel']
  startMs: number
  durationH: number
  mastM: number
}

/** The model-dependent part of the request (everything but the place); throws when a required field is empty. */
export function buildPowerRequest(p: PowerInputs, sel: Selection | null): PowerRequest {
  const f = p.fields
  const level = MODEL_LEVEL[p.model]
  const num = (k: PowerKey): number | undefined => {
    const s = ALL_FIELDS.find((x) => x.key === k)!
    const v = f[k]?.trim()
    if (!v) {
      if (s.optional) return undefined
      throw new Error(`${s.label} is required`)
    }
    const n = Number(v)
    if (!Number.isFinite(n)) throw new Error(`${s.label} must be a number`)
    return n
  }
  const req = (k: PowerKey) => num(k) as number

  if (level === 4 && p.durationH < SYNODIC_MONTH_H) throw new Error('The colony analysis needs a window of at least 30 days')

  const battery =
    level >= 3
      ? {
          battery_capacity_wh: num('battery_capacity_wh'),
          battery_initial_soc: num('battery_initial_soc'),
          battery_min_soc: num('battery_min_soc'),
          charge_efficiency: num('charge_efficiency'),
          discharge_efficiency: num('discharge_efficiency'),
        }
      : {}
  let extra: Partial<PowerRequest> = {}
  if (level === 3) extra = { load_w: num('load_w'), night_load_w: num('night_load_w') }
  if (level === 4) {
    const tSet = req('t_set_c') + KELVIN
    const tMin = req('t_min_c') + KELVIN
    if (tMin >= tSet) throw new Error('Inside minimum must be below the inside target')
    extra = {
      critical_load_w: num('critical_load_w'),
      deferrable_load_w: num('deferrable_load_w'),
      comms_load_w: num('comms_load_w'),
      comms_critical: p.commsCritical,
      shed_soc: num('shed_soc'),
      max_charge_w: num('max_charge_w'),
      max_discharge_w: num('max_discharge_w'),
      include_sizing: p.includeSizing,
      habitat: {
        crew_count: req('crew_count'),
        t_set_k: tSet,
        t_min_k: tMin,
        ua_w_k: req('ua_w_k'),
        area_m2: req('hab_area_m2'),
        skin_absorptivity: req('skin_absorptivity'),
        skin_emissivity: req('skin_emissivity'),
        structure_mass_kg: req('structure_mass_kg'),
        structure_specific_heat_j_kgk: req('structure_specific_heat_j_kgk'),
        air_volume_m3: req('air_volume_m3'),
        air_pressure_pa: req('air_pressure_pa'),
        ...(f.metabolic_w_per_crew?.trim() ? { metabolic_w_per_crew: req('metabolic_w_per_crew') } : {}),
      },
    }
  }
  return {
    ...placeFields(sel),
    start: isoMinute(p.startMs),
    duration_h: p.durationH,
    step_min: stepFor(p.durationH),
    mast_m: p.mastM,
    panel: p.panel,
    level,
    panel_area_m2: num('panel_area_m2'),
    cell_efficiency: num('cell_efficiency'),
    derating: num('derating'),
    ...battery,
    ...extra,
  }
}
