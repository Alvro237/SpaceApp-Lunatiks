/**
 * The Mission planner inputs panel's categories and inputs (mission-planner-ui-spec.md section 4), replacing the
 * role of `panels/missionFilters.ts` for this panel (that file and `MissionPanel.tsx` stay in the repo, unused).
 *
 * Stage A sends every "A" input to the existing `POST /api/v1/areas/search`; "B" inputs are shown, disabled, with
 * "Comes with the suitability search" (Stage B, a later task); "unavailable" inputs show the data-gap reason.
 * Thresholds have no defaults (CLAUDE.md) except the region radius and `comms_min_fraction` (team parameter,
 * section 1 of the spec): a category contributes to the request only once the planner switches it on, and within
 * it a field left empty is simply inactive (not sent), per section 3.3.
 */

export const STAGE_B_REASON = 'Comes with the suitability search'

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

export type PlannerField =
  /** "Near or far side": the switch both enables the input and reveals the select; off = not sent. */
  | (PlannerFieldBase & { kind: 'side' })
  | (PlannerFieldBase & { kind: 'number'; key: string; unit?: string; min?: number; max?: number; placeholder?: string })
  | (PlannerFieldBase & { kind: 'range'; loKey: string; hiKey: string; loLabel: string; hiLabel: string; unit?: string; min?: number; max?: number })
  /** A field-level switch inside an "on" category: sends `flagKey = flagValue` when on, nothing when off. */
  | (PlannerFieldBase & { kind: 'switch'; flagKey: string; flagValue: boolean | number })
  | (PlannerFieldBase & { kind: 'past-landings' })
  | (PlannerFieldBase & { kind: 'sub-switch' }) // Stage B: detailed battery model
  | (PlannerFieldBase & { kind: 'stage-b' })
  | (PlannerFieldBase & { kind: 'unavailable'; reason: string })

export interface PlannerCategory {
  id: string
  title: string
  /** What the category adds to the colours in Stage A (null: no score). */
  scoreNote: string | null
  /** Whether this category needs its own on/off switch in the heading (every one does except Search area, whose
   * single input is itself the switch). */
  hasSwitch: boolean
  fields: PlannerField[]
}

export const PLANNER_CATEGORIES: PlannerCategory[] = [
  {
    id: 'search_area',
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
        key: 'max_dark_h',
        label: 'Battery autonomy',
        unit: 'h',
        min: 0,
        tip: 'How many hours the battery keeps the lander alive with no Sun. No stretch of darkness during the mission may be longer.',
      },
      {
        id: 'recharge_time',
        kind: 'stage-b',
        label: 'Recharge time',
        tip: 'Hours of continuous sunlight needed to recharge the battery. Every sunlit stretch must be at least this long: the first one after landing and each one between two nights (a stretch cut by the end of the mission is not checked).',
      },
      {
        id: 'avoid_psr',
        kind: 'switch',
        flagKey: 'max_permanent_shadow',
        flagValue: 0,
        label: 'Avoid permanently shadowed ground',
        tip: 'Leaves out any cell that contains ground the Sun never reaches (PGDA permanent shadow map, 240 m pixels).',
      },
      {
        id: 'battery_model',
        kind: 'sub-switch',
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
        key: 'max_blackout_h',
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
        tip: "How much of the Earth's disc must be above the horizon to count as contact.",
      },
    ],
  },
  {
    id: 'topography',
    title: 'Topography and landing safety',
    scoreNote: 'Stage B: margin to the slope limit',
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
        tip: 'Radius of the area where the lander may come down. A spot is kept only if no failing cell lies within this distance.',
      },
      {
        id: 'crater_cover',
        kind: 'stage-b',
        label: 'Crater cover in the landing area',
        tip: 'Share of the landing ellipse (or of the cell, without an ellipse) that lies inside craters larger than the cell (Robbins 2018 catalogue).',
      },
      {
        id: 'rim_margin',
        kind: 'stage-b',
        label: 'Margin from crater rims',
        tip: 'Keep at least this many crater radii away from the rim of every crater larger than the cell, inside or outside it. Rims are steep, and the rocks thrown out by the impact lie mostly within about one radius beyond the rim.',
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
        loKey: 'min_sun_el_at_landing_deg',
        hiKey: 'max_sun_el_at_landing_deg',
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
        flagKey: 'earth_visible_at_landing',
        flagValue: true,
        label: 'Earth in view at landing',
        tip: 'The Earth must be in contact at touchdown, for live telemetry.',
      },
    ],
  },
  {
    id: 'science',
    title: 'Science and resources',
    scoreNote: 'Stage B: closeness to the targets set',
    hasSwitch: true,
    fields: [
      {
        id: 'near_psr',
        kind: 'number',
        key: 'max_psr_distance_km',
        label: 'Near permanent shadow',
        unit: 'km',
        min: 0,
        max: 100,
        tip: 'Within this distance of permanently shadowed ground, where water ice may be trapped.',
      },
      {
        id: 'hydrogen',
        kind: 'number',
        key: 'min_hydrogen_ppm',
        label: 'Hydrogen',
        unit: 'ppm',
        min: 0,
        tip: 'Hydrogen in the top metre of soil (Lunar Prospector). Each value covers about 45 km, so it marks regions, not single spots.',
      },
      { id: 'near_feature', kind: 'stage-b', label: 'Near a named feature', tip: 'Within this distance of a named feature (IAU names).' },
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
    scoreNote: 'Stage B: margin to the limit',
    hasSwitch: true,
    fields: [
      {
        id: 'max_dose',
        kind: 'number',
        key: 'max_dose_mgy',
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
        tip: 'The site must still meet every mission-window input if the landing slips by this many hours.',
      },
    ],
  },
]

/** The window-filter field keys: an input that uses any of them needs the mission window (start and duration). */
const WINDOW_KEYS = new Set(['max_dark_h', 'max_blackout_h', 'min_sun_el_at_landing_deg', 'max_sun_el_at_landing_deg', 'earth_visible_at_landing', 'robust_delay_h'])

/** Flat per-field text values, keyed by the field's own `id` (plain fields) or `${id}:lo` / `${id}:hi` / `${id}:dir`
 * (range and past-landings). Switch state (side on/off, flag switches, past-landings direction) lives in
 * `PlannerState.switches` and `.selects` (state/areas.ts) — kept apart so a blank number field can stay "inactive"
 * independently of any switch. */
export type PlannerValues = Record<string, string>
export type PlannerSwitches = Record<string, boolean>
export type PlannerSelects = Record<string, string>

export const DEFAULT_PLANNER_SWITCHES: PlannerSwitches = {}
export const DEFAULT_PLANNER_SELECTS: PlannerSelects = { past_landings: 'away' }
/** The one input with a real default (section 1 of the spec: the team parameter `comms_min_fraction` = 0.5). */
export const DEFAULT_PLANNER_VALUES: PlannerValues = { comms_fraction: '50' }

export interface BuildResult {
  filters: Record<string, number | boolean | string>
  window: boolean
}

/** Parses and range-checks a typed number; the message on failure is the whole sentence shown to the planner
 * (no further label is prepended by the caller). */
function parseNumber(label: string, raw: string, min?: number, max?: number, unit?: string): number | string {
  const n = Number(raw.trim().replace(',', '.'))
  if (!Number.isFinite(n)) return `${label}: must be a number`
  if ((min != null && n < min) || (max != null && n > max)) return `${label}: must be between ${min ?? '−∞'} and ${max ?? '∞'}${unit ? ` ${unit}` : ''}`
  return n
}

/**
 * The `filters` object Stage A sends to `/areas/search`, from the categories switched on and the values typed, or
 * an error message for the planner. Stage A ids ("stage-b", "sub-switch", "unavailable") never contribute.
 */
export function buildPlannerFilters(
  categoriesOn: Record<string, boolean>,
  sideOn: boolean,
  switches: PlannerSwitches,
  selects: PlannerSelects,
  values: PlannerValues,
): BuildResult | string {
  const filters: Record<string, number | boolean | string> = {}
  let window = false

  if (sideOn) filters.side = selects.side_dir === 'far' ? 'far' : 'near'

  for (const cat of PLANNER_CATEGORIES) {
    if (cat.id === 'search_area') continue
    if (cat.hasSwitch && !categoriesOn[cat.id]) continue
    for (const f of cat.fields) {
      if (f.kind === 'stage-b' || f.kind === 'sub-switch' || f.kind === 'unavailable') continue
      if (f.kind === 'switch') {
        if (switches[f.id]) {
          filters[f.flagKey] = f.flagValue
          if (WINDOW_KEYS.has(f.flagKey)) window = true
        }
        continue
      }
      if (f.kind === 'number') {
        // comms_min_fraction is a request-level parameter (commsMinFractionOf below), not a filter
        if (f.key === 'comms_min_fraction') continue
        const raw = (values[f.id] ?? '').trim()
        if (!raw) continue
        const v = parseNumber(f.label, raw, f.min, f.max, f.unit)
        if (typeof v === 'string') return v
        filters[f.key] = v
        if (WINDOW_KEYS.has(f.key)) window = true
        continue
      }
      if (f.kind === 'range') {
        const lo = (values[`${f.id}:lo`] ?? '').trim()
        const hi = (values[`${f.id}:hi`] ?? '').trim()
        if (lo) {
          const v = parseNumber(`${f.label} (${f.loLabel.toLowerCase()})`, lo, f.min, f.max, f.unit)
          if (typeof v === 'string') return v
          filters[f.loKey] = v
          window = true
        }
        if (hi) {
          const v = parseNumber(`${f.label} (${f.hiLabel.toLowerCase()})`, hi, f.min, f.max, f.unit)
          if (typeof v === 'string') return v
          filters[f.hiKey] = v
          window = true
        }
        continue
      }
      if (f.kind === 'past-landings') {
        const raw = (values[`${f.id}:km`] ?? '').trim()
        if (!raw) continue
        const dir = selects.past_landings ?? 'away'
        if (dir === 'near') continue // Stage B: "go near" has no Stage A field
        const v = parseNumber(f.label, raw, 0, undefined, 'km')
        if (typeof v === 'string') return v
        filters.away_from_landings_km = v
      }
    }
  }
  return { filters, window }
}

/** `comms_min_fraction` (request-level, 0-1): typed as a percent in "Earth disc needed for contact", with the
 * team's default of 50 % (section 1 of the spec) when left blank — it is read whether or not Earth contact is
 * switched on, since the engine's own notion of "contact" always needs it. */
export function commsMinFractionOf(values: PlannerValues): number {
  const raw = (values.comms_fraction ?? '').trim()
  const n = raw ? Number(raw.replace(',', '.')) : 50
  return (Number.isFinite(n) ? n : 50) / 100
}
