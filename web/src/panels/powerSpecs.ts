/**
 * Input fields of the MECH /power model (docs/api-guide-mech.md): label, unit and the one-line explanation that
 * sits behind the ⓘ button. Labels follow the guide's interface rules: 1-3 plain words plus the unit, never the
 * API field name. Temperatures are typed in °C and sent in kelvin. No value has a cited default, so none is
 * pre-filled; the example sets are the guide's / test suite's values and are labelled as such.
 */
import type { PowerKey } from '../state/power'

export interface FieldSpec {
  key: PowerKey
  label: string
  unit: string
  hint: string
  optional?: boolean
}

export const ARRAY: FieldSpec[] = [
  { key: 'panel_area_m2', label: 'Panel area', unit: 'm²', hint: 'Total area of solar cells.' },
  { key: 'cell_efficiency', label: 'Cell efficiency', unit: '0–1', hint: 'Share of sunlight turned into electricity, e.g. 0.3.' },
  { key: 'derating', label: 'Other losses factor', unit: '0–1', hint: '1 means no wiring, dust or temperature losses.' },
]
export const BATTERY: FieldSpec[] = [
  { key: 'battery_capacity_wh', label: 'Capacity', unit: 'Wh', hint: 'Energy the battery holds when full.' },
  { key: 'battery_initial_soc', label: 'Charge at start', unit: '0–1', hint: '1 means full at the start of the window.' },
  { key: 'battery_min_soc', label: 'Lowest allowed charge', unit: '0–1', hint: 'Below this the battery counts as empty.' },
  { key: 'charge_efficiency', label: 'Charge efficiency', unit: '0–1', hint: 'Energy kept when charging.' },
  { key: 'discharge_efficiency', label: 'Discharge efficiency', unit: '0–1', hint: 'Energy delivered when discharging.' },
]
export const LOAD: FieldSpec[] = [
  { key: 'load_w', label: 'Load', unit: 'W', hint: 'Power the lander draws while in sunlight.' },
  { key: 'night_load_w', label: 'Load in darkness', unit: 'W', hint: 'Leave empty to use the same load.', optional: true },
]

/** Level 4, colony analysis. */
export const COLONY_LOADS: FieldSpec[] = [
  { key: 'critical_load_w', label: 'Essential load', unit: 'W', hint: 'Life support and everything that must never stop. The heater is added automatically.' },
  { key: 'deferrable_load_w', label: 'Optional load', unit: 'W', hint: 'Science, rovers: switched off in saving mode.' },
  { key: 'comms_load_w', label: 'Comms load', unit: 'W', hint: 'Earth link, drawn only while the Earth is visible.' },
  { key: 'shed_soc', label: 'Saving mode below', unit: '0–1', hint: 'Below this battery charge the optional loads switch off. At least the lowest allowed charge.' },
  { key: 'max_charge_w', label: 'Charge limit', unit: 'W', hint: 'Highest charging power the battery accepts.' },
  { key: 'max_discharge_w', label: 'Discharge limit', unit: 'W', hint: 'Highest power the battery can deliver.' },
]
export const HABITAT: FieldSpec[] = [
  { key: 'crew_count', label: 'Crew', unit: 'people', hint: 'Crew inside. Each gives off body heat (140.6 W by default, NASA BVAD).' },
  { key: 't_set_c', label: 'Inside target', unit: '°C', hint: 'Temperature the heater holds.' },
  { key: 't_min_c', label: 'Inside minimum', unit: '°C', hint: 'Lowest safe temperature. Must be below the target.' },
  { key: 'ua_w_k', label: 'Insulation leak', unit: 'W/K', hint: 'Heat lost per kelvin between the inside and the outer skin.' },
  { key: 'hab_area_m2', label: 'Outer area', unit: 'm²', hint: 'Radiating surface of the habitat.' },
  { key: 'skin_absorptivity', label: 'Skin absorbs', unit: '0–1', hint: 'Share of sunlight the outer skin absorbs.' },
  { key: 'skin_emissivity', label: 'Skin radiates', unit: '0–1', hint: 'How well the outer skin gives off heat (emissivity).' },
  { key: 'structure_mass_kg', label: 'Structure mass', unit: 'kg', hint: 'Structure and contents kept at the inside temperature.' },
  { key: 'structure_specific_heat_j_kgk', label: 'Structure heat', unit: 'J/kg·K', hint: 'Mean specific heat of that mass.' },
  { key: 'air_volume_m3', label: 'Cabin volume', unit: 'm³', hint: 'Pressurised volume.' },
  { key: 'air_pressure_pa', label: 'Cabin pressure', unit: 'Pa', hint: 'Earth-like air is assumed.' },
  { key: 'metabolic_w_per_crew', label: 'Heat per person', unit: 'W', hint: 'Leave empty for 140.6 W (mean of NASA BVAD Table 3-21).', optional: true },
]
export const REGOLITH: FieldSpec[] = [
  { key: 'reg_albedo', label: 'Albedo', unit: '0–1', hint: 'Share of sunlight the ground reflects.' },
  { key: 'reg_emissivity', label: 'Emissivity', unit: '0–1', hint: 'How well the ground gives off heat.' },
  { key: 'reg_conductivity_w_mk', label: 'Conductivity', unit: 'W/m·K', hint: 'Heat conduction of the regolith (constant).' },
  { key: 'reg_density_kg_m3', label: 'Density', unit: 'kg/m³', hint: 'Bulk density of the regolith.' },
  { key: 'reg_heat_capacity_j_kgk', label: 'Heat capacity', unit: 'J/kg·K', hint: 'Specific heat of the regolith.' },
  { key: 'reg_geothermal_flux_w_m2', label: 'Heat from inside', unit: 'W/m²', hint: 'Heat flowing up from the Moon’s interior.' },
]

export const ALL_FIELDS: FieldSpec[] = [...ARRAY, ...BATTERY, ...LOAD, ...COLONY_LOADS, ...HABITAT, ...REGOLITH]

/** docs/api-guide-mech.md test values: for trying the model, not recommended limits. */
export const EXAMPLE: Partial<Record<PowerKey, string>> = {
  panel_area_m2: '2',
  cell_efficiency: '0.3',
  derating: '0.9',
  load_w: '60',
  battery_capacity_wh: '3000',
  battery_initial_soc: '1',
  battery_min_soc: '0.2',
  charge_efficiency: '0.95',
  discharge_efficiency: '0.95',
}

/** api/tests/test_colony.py values (294 K = 20.85 °C, 283 K = 9.85 °C). */
export const EXAMPLE_COLONY: Partial<Record<PowerKey, string>> = {
  panel_area_m2: '60',
  cell_efficiency: '0.3',
  derating: '0.9',
  battery_capacity_wh: '2000000',
  battery_initial_soc: '1',
  battery_min_soc: '0.2',
  charge_efficiency: '0.95',
  discharge_efficiency: '0.95',
  critical_load_w: '1500',
  deferrable_load_w: '1000',
  comms_load_w: '200',
  shed_soc: '0.5',
  max_charge_w: '10000',
  max_discharge_w: '10000',
  crew_count: '4',
  t_set_c: '20.85',
  t_min_c: '9.85',
  ua_w_k: '5',
  hab_area_m2: '200',
  skin_absorptivity: '0.3',
  skin_emissivity: '0.8',
  structure_mass_kg: '20000',
  structure_specific_heat_j_kgk: '900',
  air_volume_m3: '150',
  air_pressure_pa: '101325',
  reg_albedo: '0.12',
  reg_emissivity: '0.95',
  reg_conductivity_w_mk: '0.002',
  reg_density_kg_m3: '1500',
  reg_heat_capacity_j_kgk: '600',
  reg_geothermal_flux_w_m2: '0.018',
}

/** One synodic month: the shortest window the colony analysis accepts (hours). */
export const SYNODIC_MONTH_H = 708.7
