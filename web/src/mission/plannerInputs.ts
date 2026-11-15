/**
 * The Mission planner inputs panel's categories and inputs (mission-planner-ui-spec.md section 4), replacing the
 * role of `panels/missionFilters.ts` for this panel (that file and `MissionPanel.tsx` stay in the repo, unused).
 *
 * Stage B: every input is sent to `POST /api/v1/suitability/search` as a hard limit (a criterion of the API's
 * catalogue, `api/app/logic/suitability.py`, or one of its three request-level parameters); "unavailable" inputs
 * show the data-gap reason. Thresholds have no defaults (CLAUDE.md) except the region radius and
 * `comms_min_fraction` (team parameter, section 1 of the spec): a category contributes to the request only once the
 * planner switches it on, and within it a field left empty is simply inactive (not sent), per section 3.3.
 */

import type { CriterionInput, SuitabilityCategory } from '../api/types'
import { SCORED_CATEGORIES } from './score'

// ---------------------------------------------------------------- cell size and radius (section 3.2 rules)
export const CELL_OPTIONS_KM = [0.24, 0.48, 0.96, 1.92, 3.84, 7.68] as const
const MAX_CELLS_AUTO = 40_000
export const MAX_CELLS_API = 360_000

export function cellsSide(radiusKm: number, cellKm: number): number {
  return Math.ceil((2 * radiusKm) / cellKm)
}

/** The smallest cell option whose grid stays within the auto budget (ceil(2 × radius / cell)² ≤ 40 000). */
export function autoCellKm(radiusKm: number): number {
  for (const c of CELL_OPTIONS_KM) {
    const n = cellsSide(radiusKm, c)
    if (n * n <= MAX_CELLS_AUTO) return c
  }
  return CELL_OPTIONS_KM[CELL_OPTIONS_KM.length - 1]
}

/** Above the API's own limit (360 000 cells): the option is disabled, with "Too many cells for this radius". */
export function cellTooMany(radiusKm: number, cellKm: number): boolean {
  return cellsSide(radiusKm, cellKm) ** 2 > MAX_CELLS_API
}

/** LOLA slope resolution at the centre: 320 m south of 80° S, 960 m elsewhere. A cell option finer than this adds
 * no information there ("(finer than the data here)"). */
export function dataResolutionKm(lat: number): number {
  return lat <= -80 ? 0.32 : 0.96
}

/** Radius slider maximum for a chosen cell size: min(100, floor(sqrt(360 000) × cell / 2)). */
export function maxRadiusForCell(cellKm: number): number {
  return Math.min(100, Math.floor((Math.sqrt(MAX_CELLS_API) * cellKm) / 2))
}

export function resolveCellKm(mode: 'auto' | number, radiusKm: number): number {
  return mode === 'auto' ? autoCellKm(radiusKm) : mode
}


export interface PlannerFieldBase {
  id: string
  label: string
  tip: string
}

/** One number of the detailed battery model (the flat fields of POST /api/v1/power level 3). `percent`: typed in
 * percent, sent as a 0-1 fraction. */
export interface BatteryParam {
  key: string
  label: string
  unit?: string
  min: number
  max?: number
  minExclusive?: boolean
  required: boolean
  percent?: boolean
}

export const BATTERY_PARAMS: BatteryParam[] = [
  { key: 'panel_area_m2', label: 'Panel area', unit: 'm²', min: 0, minExclusive: true, required: true },
  { key: 'cell_efficiency', label: 'Cell efficiency', unit: '0-1', min: 0, max: 1, minExclusive: true, required: true },
  { key: 'derating', label: 'Derating', unit: '0-1', min: 0, max: 1, minExclusive: true, required: true },
  { key: 'battery_capacity_wh', label: 'Battery capacity', unit: 'Wh', min: 0, minExclusive: true, required: true },
  { key: 'battery_initial_soc', label: 'State of charge at landing', unit: '%', min: 0, max: 100, required: true, percent: true },
  { key: 'battery_min_soc', label: 'Lowest allowed state of charge', unit: '%', min: 0, max: 100, required: true, percent: true },
  { key: 'load_w', label: 'Day load', unit: 'W', min: 0, required: true },
  { key: 'night_load_w', label: 'Night load (optional)', unit: 'W', min: 0, required: false },
  { key: 'charge_efficiency', label: 'Charge efficiency', unit: '0-1', min: 0, max: 1, minExclusive: true, required: true },
  { key: 'discharge_efficiency', label: 'Discharge efficiency', unit: '0-1', min: 0, max: 1, minExclusive: true, required: true },
]

export type PlannerField =
  /** "Near or far side": the switch both enables the input and reveals the select; off = not sent. */
  | (PlannerFieldBase & { kind: 'side' })
  /** `key`: a criterion id of the API catalogue, or one of the request-level parameters (REQUEST_KEYS).
   * `replacedByBatteryModel`: hidden and not sent while the detailed battery model is on. */
  | (PlannerFieldBase & {
      kind: 'number'
      key: string
      unit?: string
      min?: number
      max?: number
      minExclusive?: boolean
      replacedByBatteryModel?: boolean
    })
  | (PlannerFieldBase & { kind: 'range'; criterion: string; loLabel: string; hiLabel: string; unit?: string; min?: number; max?: number })
  /** A field-level switch inside an "on" category: sends the flag criterion when on, nothing when off. */
  | (PlannerFieldBase & { kind: 'switch'; criterion: string })
  | (PlannerFieldBase & { kind: 'past-landings' })
  /** Detailed battery model: a switch revealing BATTERY_PARAMS; sends `battery_model` with `params`. */
  | (PlannerFieldBase & { kind: 'battery-model' })
  /** Near a named feature: an IAU name (searched) and a distance. */
  | (PlannerFieldBase & { kind: 'feature' })
  | (PlannerFieldBase & { kind: 'unavailable'; reason: string })

export interface PlannerCategory {
  /** The API's category id (SuitabilityRequest.categories). */
  id: SuitabilityCategory
  title: string
  /** What the category adds to the score (null: no score). */
  scoreNote: string | null
  /** Whether this category needs its own on/off switch in the heading (every one does except Search area, whose
   * single input is itself the switch). */
  hasSwitch: boolean
  fields: PlannerField[]
}

export const PLANNER_CATEGORIES: PlannerCategory[] = [
  {
    id: 'search',
    title: 'Search area',
    scoreNote: null,
    hasSwitch: false,
    fields: [
      {
        id: 'side',
        kind: 'side',
        label: 'Near or far side',
        tip: 'Off: the search can include the boundary between the near and far side. On: keeps only the side chosen (near: longitude within 90° of the sub-Earth meridian). At the south pole the two sides meet, so this is a coarse screen; the Earth contact inputs compute real visibility for the mission dates.',
      },
    ],
  },
  {
    id: 'power',
    title: 'Power and sunlight',
    scoreNote: 'share of the mission window with any part of the Sun visible',
    hasSwitch: true,
    fields: [
      {
        id: 'battery_autonomy',
        kind: 'number',
        key: 'battery_autonomy_h',
        label: 'Battery autonomy',
        unit: 'h',
        min: 0,
        replacedByBatteryModel: true,
        tip: 'How many hours the battery keeps the lander alive with no Sun. No stretch of darkness during the mission may be longer.',
      },
      {
        id: 'recharge_time',
        kind: 'number',
        key: 'recharge_h',
        label: 'Recharge time',
        unit: 'h',
        min: 0,
        replacedByBatteryModel: true,
        tip: 'Hours of continuous sunlight needed to recharge the battery. Every sunlit stretch must be at least this long: the first one after landing and each one between two nights (a stretch cut by the end of the mission is not checked).',
      },
      {
        id: 'avoid_psr',
        kind: 'switch',
        criterion: 'avoid_psr',
        label: 'Avoid permanently shadowed ground',
        tip: 'Leaves out any cell that contains ground the Sun never reaches (PGDA permanent shadow map, 240 m pixels).',
      },
      {
        id: 'battery_model',
        kind: 'battery-model',
        label: 'Detailed battery model',
        tip: 'Simulates the battery hour by hour with your panel and loads (the same model as the Power panel, level 3). When on, it replaces battery autonomy and recharge time.',
      },
    ],
  },
  {
    id: 'earth',
    title: 'Earth contact',
    scoreNote: 'share of the window with Earth contact',
    hasSwitch: true,
    fields: [
      {
        id: 'max_blackout',
        kind: 'number',
        key: 'blackout_h',
        label: 'Longest blackout',
        unit: 'h',
        min: 0,
        tip: 'The longest time without direct radio contact with Earth that the mission accepts (data storage, operations).',
      },
      {
        id: 'comms_fraction',
        kind: 'number',
        key: 'comms_min_fraction',
        label: 'Earth disc needed for contact',
        unit: '%',
        min: 0,
        max: 100,
        minExclusive: true,
        tip: "How much of the Earth's disc must be above the horizon to count as contact.",
      },
    ],
  },
  {
    id: 'topography',
    title: 'Topography and landing safety',
    scoreNote: 'margin to the slope limit (and to the crater cover limit when set)',
    hasSwitch: true,
    fields: [
      {
        id: 'max_slope',
        kind: 'number',
        key: 'max_slope_deg',
        label: 'Maximum slope',
        unit: '°',
        min: 0,
        max: 90,
        tip: 'Steepest ground the lander can stand on. A cell fails if any part of it is steeper (LOLA slope: 320 m south of 80° S, 960 m elsewhere).',
      },
      {
        id: 'landing_radius',
        kind: 'number',
        key: 'landing_radius_km',
        label: 'Landing ellipse radius',
        unit: 'km',
        min: 0,
        max: 20,
        minExclusive: true,
        tip: 'Radius of the area where the lander may come down. A spot is kept only if no failing cell lies within this distance.',
      },
      {
        id: 'crater_cover',
        kind: 'number',
        key: 'crater_cover_pct',
        label: 'Crater cover in the landing area',
        unit: '%',
        min: 0,
        max: 100,
        tip: 'Share of the landing ellipse (or of the cell, without an ellipse) that lies inside craters at least twice the cell size (Robbins 2018 catalogue).',
      },
      {
        id: 'rim_margin',
        kind: 'number',
        key: 'rim_margin_radii',
        label: 'Margin from crater rims',
        unit: 'radii',
        min: 0,
        max: 5,
        tip: 'Keep at least this many crater radii away from the rim of every crater at least twice the cell size, inside or outside it. Rims are steep, and the rocks thrown out by the impact lie mostly within about one radius beyond the rim.',
      },
      { id: 'roughness', kind: 'unavailable', label: 'Roughness', tip: '', reason: 'The LOLA roughness map in the data has no confirmed units, so it is not used.' },
      { id: 'rocks', kind: 'unavailable', label: 'Rocks', tip: '', reason: 'No open boulder map covers the pole (LROC counts exist for single sites only).' },
    ],
  },
  {
    id: 'landing',
    title: 'Landing conditions',
    scoreNote: null,
    hasSwitch: true,
    fields: [
      {
        id: 'sun_el_at_landing',
        kind: 'range',
        criterion: 'sun_el_at_landing_deg',
        loLabel: 'Lowest',
        hiLabel: 'Highest',
        unit: '°',
        min: -90,
        max: 90,
        label: 'Sun height at landing',
        tip: 'Elevation of the Sun at touchdown. Descent cameras need light, but a very low Sun casts long shadows that hide hazards.',
      },
      {
        id: 'earth_at_landing',
        kind: 'switch',
        criterion: 'earth_at_landing',
        label: 'Earth in view at landing',
        tip: 'The Earth must be in contact at touchdown, for live telemetry.',
      },
    ],
  },
  {
    id: 'science',
    title: 'Science and resources',
    scoreNote: 'closeness to the targets set',
    hasSwitch: true,
    fields: [
      {
        id: 'near_psr',
        kind: 'number',
        key: 'psr_distance_km',
        label: 'Near permanent shadow',
        unit: 'km',
        min: 0,
        max: 100,
        tip: 'Within this distance of permanently shadowed ground, where water ice may be trapped.',
      },
      {
        id: 'hydrogen',
        kind: 'number',
        key: 'hydrogen_ppm',
        label: 'Hydrogen',
        unit: 'ppm',
        min: 0,
        tip: 'Hydrogen in the top metre of soil (Lunar Prospector). Each value covers about 45 km, so it marks regions, not single spots.',
      },
      { id: 'near_feature', kind: 'feature', label: 'Near a named feature', tip: 'Within this distance of a named feature (IAU names).' },
      {
        id: 'past_landings',
        kind: 'past-landings',
        label: 'Past landings',
        tip: 'Keep clear of, or stay close to, earlier landing and impact sites in the region (shown with the Past landings switch).',
      },
    ],
  },
  {
    id: 'radiation',
    title: 'Radiation',
    scoreNote: 'margin to the limit',
    hasSwitch: true,
    fields: [
      {
        id: 'max_dose',
        kind: 'number',
        key: 'dose_mgy',
        label: 'Maximum dose',
        unit: 'mGy',
        min: 0,
        tip: 'Cosmic-ray dose over the mission (LRO CRaTER, silicon), lower where the terrain hides more of the sky. Solar storms are not included.',
      },
      { id: 'thermal', kind: 'unavailable', label: 'Thermal', tip: '', reason: 'The thermal model runs on one spot: open a site, then the Power panel.' },
      { id: 'solar_storms', kind: 'unavailable', label: 'Solar storms', tip: '', reason: 'No forecast exists for a future window.' },
    ],
  },
  {
    id: 'schedule',
    title: 'Schedule',
    scoreNote: null,
    hasSwitch: true,
    fields: [
      {
        id: 'robust_delay',
        kind: 'number',
        key: 'robust_delay_h',
        label: 'Robust to a landing delay',
        unit: 'h',
        min: 0,
        max: 720,
        minExclusive: true,
        tip: 'The site must still meet every mission-window input if the landing slips by this many hours.',
      },
    ],
  },
]

/** Inputs sent as request fields, not criteria (the API's REQUEST_PARAMETERS). */
export const REQUEST_KEYS = new Set(['landing_radius_km', 'robust_delay_h', 'comms_min_fraction'])
/** Criteria evaluated over the mission window (stage "window" of the API's catalogue). */
export const WINDOW_CRITERIA = new Set(['battery_autonomy_h', 'recharge_h', 'battery_model', 'blackout_h', 'sun_el_at_landing_deg', 'earth_at_landing'])

/** Criterion id -> label, for the funnel, the unknown list and the site details. */
export const CRITERION_LABEL: Record<string, string> = {
  side: 'Near or far side',
  battery_autonomy_h: 'Battery autonomy',
  recharge_h: 'Recharge time',
  avoid_psr: 'Avoid permanently shadowed ground',
  battery_model: 'Detailed battery model',
  blackout_h: 'Longest blackout',
  max_slope_deg: 'Maximum slope',
  crater_cover_pct: 'Crater cover in the landing area',
  rim_margin_radii: 'Margin from crater rims',
  sun_el_at_landing_deg: 'Sun height at landing',
  earth_at_landing: 'Earth in view at landing',
  psr_distance_km: 'Near permanent shadow',
  hydrogen_ppm: 'Hydrogen',
  target_distance_km: 'Near a named feature',
  past_landings: 'Past landings',
  dose_mgy: 'Maximum dose',
  landing_radius_km: 'Landing ellipse radius',
  robust_delay_h: 'Robust to a landing delay',
  bound: 'Ephemeris bound',
}

/** Category id -> title. */
export const CATEGORY_TITLE: Record<string, string> = Object.fromEntries(PLANNER_CATEGORIES.map((c) => [c.id, c.title]))

/** Flat per-field text values, keyed by the field's own `id` (plain fields) or `${id}:lo` / `${id}:hi` / `${id}:km` /
 * `${id}:name` / `battery_model:${param}`. Switch state (side on/off, flag switches, the battery model) lives in
 * `PlannerState.switches` and `.selects` (state/areas.ts) — kept apart so a blank number field can stay "inactive"
 * independently of any switch. */
export type PlannerValues = Record<string, string>
export type PlannerSwitches = Record<string, boolean>
export type PlannerSelects = Record<string, string>

export const DEFAULT_PLANNER_SWITCHES: PlannerSwitches = {}
export const DEFAULT_PLANNER_SELECTS: PlannerSelects = { past_landings: 'away' }
/** The one input with a real default (section 1 of the spec: the team parameter `comms_min_fraction` = 0.5). */
export const DEFAULT_PLANNER_VALUES: PlannerValues = { comms_fraction: '50' }

export interface SuitabilityInputs {
  /** Categories switched on (`search` when the side switch is on), in catalogue order. */
  categories: SuitabilityCategory[]
  criteria: CriterionInput[]
  landing_radius_km?: number
  robust_delay_h?: number
  /** Whether the answer depends on the mission window samples (a window criterion, the delay, or the Power or
   * Earth score, which is a share of the window): then a preview (60 samples) differs from the full run. */
  window: boolean
  /** Categories that add a layer to the score, catalogue order (the API's rules, mission-planner-ui-spec.md 6.2). */
  scored: string[]
}

/** Parses and range-checks a typed number; the message on failure is the whole sentence shown to the planner. */
function parseNumber(label: string, raw: string, min?: number, max?: number, unit?: string, minExclusive = false): number | string {
  const n = Number(raw.trim().replace(',', '.'))
  if (!Number.isFinite(n)) return `${label}: must be a number`
  const u = unit ? ` ${unit}` : ''
  if (minExclusive && min != null && n <= min) return `${label}: must be more than ${min}${u}${max != null ? ` and at most ${max}${u}` : ''}`
  if ((min != null && n < min) || (max != null && n > max)) return `${label}: must be between ${min ?? '−∞'} and ${max ?? '∞'}${u}`
  return n
}

/**
 * The suitability request's inputs from the categories switched on and the values typed, or an error message for
 * the planner. Empty inputs are inactive (not sent); "unavailable" rows never contribute.
 */
export function buildSuitability(
  categoriesOn: Record<string, boolean>,
  sideOn: boolean,
  switches: PlannerSwitches,
  selects: PlannerSelects,
  values: PlannerValues,
): SuitabilityInputs | string {
  const categories: SuitabilityCategory[] = []
  const criteria: CriterionInput[] = []
  const out: SuitabilityInputs = { categories, criteria, window: false, scored: [] }
  const batteryModel = !!switches.battery_model

  for (const cat of PLANNER_CATEGORIES) {
    if (cat.id === 'search') {
      if (sideOn) {
        categories.push('search')
        criteria.push({ id: 'side', choice: selects.side_dir === 'far' ? 'far' : 'near' })
      }
      continue
    }
    if (!categoriesOn[cat.id]) continue
    categories.push(cat.id)
    for (const f of cat.fields) {
      if (f.kind === 'unavailable' || f.kind === 'side') continue
      if (f.kind === 'switch') {
        if (switches[f.id]) criteria.push({ id: f.criterion })
        continue
      }
      if (f.kind === 'number') {
        if (f.replacedByBatteryModel && batteryModel) continue
        const raw = (values[f.id] ?? '').trim()
        if (!raw) continue
        const v = parseNumber(f.label, raw, f.min, f.max, f.unit, f.minExclusive)
        if (typeof v === 'string') return v
        // comms_min_fraction is sent whatever the category (commsMinFractionOf below); here it is only checked
        if (f.key === 'comms_min_fraction') continue
        if (f.key === 'landing_radius_km') out.landing_radius_km = v
        else if (f.key === 'robust_delay_h') out.robust_delay_h = v
        else criteria.push({ id: f.key, limit: v })
        continue
      }
      if (f.kind === 'range') {
        const lo = (values[`${f.id}:lo`] ?? '').trim()
        const hi = (values[`${f.id}:hi`] ?? '').trim()
        if (!lo && !hi) continue
        const c: CriterionInput = { id: f.criterion }
        if (lo) {
          const v = parseNumber(`${f.label} (${f.loLabel.toLowerCase()})`, lo, f.min, f.max, f.unit)
          if (typeof v === 'string') return v
          c.min = v
        }
        if (hi) {
          const v = parseNumber(`${f.label} (${f.hiLabel.toLowerCase()})`, hi, f.min, f.max, f.unit)
          if (typeof v === 'string') return v
          if (c.min != null && v < c.min) return `${f.label}: the ${f.hiLabel.toLowerCase()} value must not be below the ${f.loLabel.toLowerCase()} one.`
          c.max = v
        }
        criteria.push(c)
        continue
      }
      if (f.kind === 'past-landings') {
        const raw = (values[`${f.id}:km`] ?? '').trim()
        if (!raw) continue
        const v = parseNumber(f.label, raw, 0, 2000, 'km')
        if (typeof v === 'string') return v
        criteria.push({ id: 'past_landings', choice: selects.past_landings === 'near' ? 'near' : 'away', limit: v })
        continue
      }
      if (f.kind === 'feature') {
        const raw = (values[`${f.id}:km`] ?? '').trim()
        const name = (values[`${f.id}:name`] ?? '').trim()
        if (!raw) continue
        const v = parseNumber(f.label, raw, 0, 2000, 'km')
        if (typeof v === 'string') return v
        if (!name) return `${f.label}: choose a feature name`
        criteria.push({ id: 'target_distance_km', limit: v, params: { feature: name } })
        continue
      }
      if (f.kind === 'battery-model') {
        if (!batteryModel) continue
        const params: Record<string, number> = {}
        for (const p of BATTERY_PARAMS) {
          const raw = (values[`battery_model:${p.key}`] ?? '').trim()
          if (!raw) {
            if (p.required) return `${f.label}: ${p.label.toLowerCase()} is needed`
            continue
          }
          const v = parseNumber(`${f.label}, ${p.label.toLowerCase()}`, raw, p.min, p.max, p.unit, p.minExclusive)
          if (typeof v === 'string') return v
          params[p.key] = p.percent ? v / 100 : v
        }
        criteria.push({ id: 'battery_model', params })
      }
    }
  }

  const ids = new Set(criteria.map((c) => c.id))
  out.window = criteria.some((c) => WINDOW_CRITERIA.has(c.id)) || out.robust_delay_h != null || categories.includes('power') || categories.includes('earth')
  const scoredIf: Record<string, boolean> = {
    power: categories.includes('power'),
    earth: categories.includes('earth'),
    topography: ids.has('max_slope_deg') || ids.has('crater_cover_pct'),
    science:
      ids.has('psr_distance_km') || ids.has('target_distance_km') || ids.has('hydrogen_ppm') || criteria.some((c) => c.id === 'past_landings' && c.choice === 'near'),
    radiation: ids.has('dose_mgy'),
  }
  out.scored = SCORED_CATEGORIES.filter((c) => scoredIf[c])
  return out
}

/** `comms_min_fraction` (request-level, 0-1): typed as a percent in "Earth disc needed for contact", with the
 * team's default of 50 % (section 1 of the spec) when left blank or invalid — it is read whether or not Earth
 * contact is switched on, since the engine's own notion of "contact" always needs it. */
export function commsMinFractionOf(values: PlannerValues): number {
  const raw = (values.comms_fraction ?? '').trim()
  const n = raw ? Number(raw.replace(',', '.')) : 50
  return (Number.isFinite(n) && n > 0 && n <= 100 ? n : 50) / 100
}
