/**
 * Threshold fields of the hard filters, as specified in docs/endpoints.md and docs/api-guide-mech.md. Only the
 * filters the API reports as registered (GET /meta/constraints) are offered; a registered filter without a spec
 * here gets a JSON box. No value is pre-filled: thresholds need a cited source or the owner's decision (CLAUDE.md).
 *
 * Labels follow the MECH interface rules: a few plain words plus the unit; the explanation goes behind ⓘ. A key
 * with a dot ("regolith.albedo") is sent nested; `toApi` converts what the planner types (°C) to the API's unit (K).
 */
export type FilterIcon = 'slope' | 'sun' | 'radiation' | 'battery' | 'thermo' | 'earth' | 'crater' | 'rock' | 'clock'

export interface FieldSpec {
  key: string
  label: string
  kind: 'number' | 'select'
  unit?: string
  hint?: string
  options?: { value: string; label: string }[]
  optional?: boolean
  toApi?: (n: number) => number
}

export interface FilterSpec {
  title: string
  icon: FilterIcon
  /** One line behind the ⓘ next to the title. */
  summary: string
  fields: FieldSpec[]
  help?: string
}

const C_TO_K = (c: number) => c + 273.15

const REGOLITH: FieldSpec[] = [
  { key: 'regolith.albedo', label: 'Ground albedo', kind: 'number', unit: '0–1', hint: 'Share of sunlight the ground reflects.' },
  { key: 'regolith.emissivity', label: 'Ground emissivity', kind: 'number', unit: '0–1', hint: 'How well the ground gives off heat.' },
  { key: 'regolith.conductivity_w_mk', label: 'Conductivity', kind: 'number', unit: 'W/m·K', hint: 'Heat conduction of the regolith.' },
  { key: 'regolith.density_kg_m3', label: 'Density', kind: 'number', unit: 'kg/m³', hint: 'Bulk density of the regolith.' },
  { key: 'regolith.heat_capacity_j_kgk', label: 'Heat capacity', kind: 'number', unit: 'J/kg·K', hint: 'Specific heat of the regolith.' },
  { key: 'regolith.geothermal_flux_w_m2', label: 'Heat from inside', kind: 'number', unit: 'W/m²', hint: 'Heat flowing up from the interior.' },
]

export const FILTER_SPECS: Record<string, FilterSpec> = {
  max_slope: {
    title: 'Maximum slope',
    icon: 'slope',
    summary: 'Ground steeper than this is out. From the LOLA slope at the site.',
    fields: [{ key: 'max_deg', label: 'Steepest slope', kind: 'number', unit: '°', hint: 'Largest ground slope the lander accepts.' }],
  },
  continuous_light: {
    title: 'Sunlight during the mission',
    icon: 'sun',
    summary: 'Enough sunlight over the mission window, over the real horizon.',
    fields: [
      { key: 'min_fraction', label: 'Lit at least', kind: 'number', unit: '0–1', optional: true, hint: 'Share of the window with some Sun visible.' },
      { key: 'max_dark_h', label: 'Longest night', kind: 'number', unit: 'h', optional: true, hint: 'Longest stretch without Sun allowed.' },
      { key: 'min_sun_fraction', label: 'Counts as lit from', kind: 'number', unit: '0–1', optional: true, hint: 'Share of the solar disc that counts as lit.' },
    ],
    help: 'Leave all blank for the strict reading: light for the whole mission.',
  },
  max_dose: {
    title: 'Radiation dose',
    icon: 'radiation',
    summary: 'Cosmic-ray dose over the mission at the site (LRO CRaTER, open sky as shielding).',
    fields: [{ key: 'max_mgy_si', label: 'Most dose', kind: 'number', unit: 'mGy', hint: 'Absorbed dose in silicon over the window.' }],
  },
  battery_survives: {
    title: 'Battery lasts',
    icon: 'battery',
    summary: 'The solar array and battery serve the load for the whole window (power model, level 3).',
    fields: [
      { key: 'panel_area_m2', label: 'Panel area', kind: 'number', unit: 'm²', hint: 'Total area of solar cells.' },
      { key: 'cell_efficiency', label: 'Cell efficiency', kind: 'number', unit: '0–1', hint: 'Share of sunlight turned into electricity.' },
      { key: 'derating', label: 'Other losses factor', kind: 'number', unit: '0–1', hint: '1 means no other losses.' },
      { key: 'load_w', label: 'Load', kind: 'number', unit: 'W', hint: 'Power the lander draws.' },
      { key: 'night_load_w', label: 'Load in darkness', kind: 'number', unit: 'W', optional: true, hint: 'Leave empty to use the same load.' },
      { key: 'battery_capacity_wh', label: 'Battery capacity', kind: 'number', unit: 'Wh', hint: 'Energy the battery holds when full.' },
      { key: 'battery_initial_soc', label: 'Charge at start', kind: 'number', unit: '0–1', hint: '1 means full at the start.' },
      { key: 'battery_min_soc', label: 'Lowest allowed charge', kind: 'number', unit: '0–1', hint: 'Below this the battery counts as empty.' },
      { key: 'charge_efficiency', label: 'Charge efficiency', kind: 'number', unit: '0–1', hint: 'Energy kept when charging.' },
      { key: 'discharge_efficiency', label: 'Discharge efficiency', kind: 'number', unit: '0–1', hint: 'Energy delivered when discharging.' },
    ],
  },
  max_temperature: {
    title: 'Maximum temperature',
    icon: 'thermo',
    summary: 'The ground surface (thermal model) does not get hotter than the limit.',
    fields: [
      { key: 'max_k', label: 'Hottest allowed', kind: 'number', unit: '°C', toApi: C_TO_K, hint: 'Sent to the API in kelvin.' },
      {
        key: 'mode',
        label: 'Reading',
        kind: 'select',
        options: [
          { value: 'discrete', label: 'Any moment' },
          { value: 'continuous', label: 'For a while' },
        ],
        hint: 'Any moment: one sample above fails. For a while: fails only if it stays above longer than allowed.',
      },
      { key: 'max_hours_above', label: 'Hours above allowed', kind: 'number', unit: 'h', optional: true, hint: 'Only for “For a while”.' },
      ...REGOLITH,
    ],
  },
  sun_elevation_at_landing: {
    title: 'Solar elevation at landing',
    icon: 'sun',
    summary: 'The Sun is within these heights at the landing instant.',
    fields: [
      { key: 'min_deg', label: 'Lowest Sun', kind: 'number', unit: '°' },
      { key: 'max_deg', label: 'Highest Sun', kind: 'number', unit: '°', optional: true },
    ],
  },
  crater_density: {
    title: 'Crater density',
    icon: 'crater',
    summary: 'Not too many craters around the site (Robbins 2018 catalogue).',
    fields: [
      { key: 'max_per_km2', label: 'Most craters', kind: 'number', unit: '/km²' },
      { key: 'radius_km', label: 'Within', kind: 'number', unit: 'km' },
      { key: 'min_diam_km', label: 'Counting from', kind: 'number', unit: 'km', hint: 'Smallest crater diameter counted.' },
    ],
  },
  rock_abundance: {
    title: 'Rocks',
    icon: 'rock',
    summary: 'No boulder dataset exists yet: this filter reports “unknown”.',
    fields: [],
  },
  comms_hours: {
    title: 'Direct-to-Earth time',
    icon: 'earth',
    summary: 'Enough time with the Earth above the horizon.',
    fields: [
      { key: 'min_hours', label: 'At least', kind: 'number', unit: 'h', optional: true },
      { key: 'min_fraction', label: 'Or a share of', kind: 'number', unit: '0–1', optional: true },
    ],
  },
  max_blackout: {
    title: 'Longest blackout',
    icon: 'clock',
    summary: 'The longest time without the Earth in view.',
    fields: [{ key: 'max_hours', label: 'Longest silence', kind: 'number', unit: 'h' }],
  },
  radiation: {
    title: 'Radiation',
    icon: 'radiation',
    summary: 'Mission dose at the site.',
    fields: [
      { key: 'max_dose', label: 'Most dose', kind: 'number' },
      {
        key: 'unit',
        label: 'Unit',
        kind: 'select',
        options: [
          { value: 'mSv', label: 'mSv' },
          { value: 'mGy', label: 'mGy' },
        ],
      },
    ],
  },
}

/** The threshold object for the API, or an error message. Dotted keys are nested; `toApi` converts units. */
export function buildThreshold(spec: FieldSpec[], values: Record<string, string>): Record<string, unknown> | string {
  const out: Record<string, unknown> = {}
  const put = (key: string, v: unknown) => {
    const parts = key.split('.')
    let o = out
    for (const p of parts.slice(0, -1)) o = (o[p] ??= {}) as Record<string, unknown>
    o[parts[parts.length - 1]] = v
  }
  for (const f of spec) {
    const v = (values[f.key] ?? '').trim()
    if (!v) {
      if (f.optional) continue
      return `${f.label} is required`
    }
    if (f.kind === 'number') {
      const n = Number(v.replace(',', '.'))
      if (!Number.isFinite(n)) return `${f.label} must be a number`
      put(f.key, f.toApi ? f.toApi(n) : n)
    } else put(f.key, v)
  }
  return out
}
