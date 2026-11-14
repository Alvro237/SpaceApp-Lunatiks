/**
 * The mission filters of the area search (POST /api/v1/areas/search), grouped as the planner thinks of them
 * (A search area … I science). Each filter maps to request fields with their units; none has a default value
 * (CLAUDE.md: a threshold needs a cited source or the planner's decision), so switching one on asks for its numbers.
 *
 * Filters the data cannot answer are listed too, switched off for good, with the reason: the planner sees what was
 * left out and why instead of a silent gap.
 */
export type MissionIcon = 'pin' | 'slope' | 'crater' | 'rock' | 'mountain' | 'sun' | 'bolt' | 'clock' | 'earth' | 'thermo' | 'radiation' | 'calendar' | 'habitat' | 'science'

export interface MissionField {
  /** request field under `filters` */
  key: string
  label: string
  unit?: string
  kind: 'number' | 'select'
  options?: { value: string; label: string }[]
  optional?: boolean
  hint?: string
  min?: number
  max?: number
}

export interface MissionFilter {
  id: string
  title: string
  icon: MissionIcon
  /** behind the ⓘ: what it checks and from which data */
  tip: string
  fields: MissionField[]
  /** a filter without fields sends this when switched on */
  flag?: { key: string; value: boolean | string }
  /** needs the mission window (start and duration from the timeline) */
  window?: boolean
  /** why the area search cannot apply it (the row is shown switched off) */
  unavailable?: string
}

export interface MissionGroup {
  id: string
  letter: string
  title: string
  filters: MissionFilter[]
}

const share = (label: string, hint: string, key: string): MissionField => ({ key, label, unit: '0–1', kind: 'number', min: 0, max: 1, hint })

export const MISSION_GROUPS: MissionGroup[] = [
  {
    id: 'zone',
    letter: 'A',
    title: 'Search area',
    filters: [
      {
        id: 'side',
        title: 'Near or far side',
        icon: 'pin',
        tip: 'Near side: within 90° of longitude of the sub-Earth meridian (0° E). Near the pole both sides meet.',
        fields: [{ key: 'side', label: 'Side', kind: 'select', options: [{ value: 'near', label: 'Near' }, { value: 'far', label: 'Far' }] }],
      },
      {
        id: 'away_from_landings_km',
        title: 'Away from past landings',
        icon: 'pin',
        tip: 'At least this far from every measured landing point in the NASA NSSDCA list.',
        fields: [{ key: 'away_from_landings_km', label: 'At least', unit: 'km', kind: 'number', min: 0 }],
      },
    ],
  },
  {
    id: 'terrain',
    letter: 'B',
    title: 'Terrain and landing',
    filters: [
      {
        id: 'max_slope_deg',
        title: 'Maximum slope',
        icon: 'slope',
        tip: 'Steepest LOLA slope anywhere in the cell (320 m grid south of 80° S, 960 m elsewhere).',
        fields: [{ key: 'max_slope_deg', label: 'Steepest slope', unit: '°', kind: 'number', min: 0, max: 90 }],
      },
      {
        id: 'elevation',
        title: 'Elevation range',
        icon: 'mountain',
        tip: 'Ground height above the 1737.4 km reference sphere (LOLA). Fill one or both.',
        fields: [
          { key: 'min_elevation_m', label: 'Lowest', unit: 'm', kind: 'number', optional: true },
          { key: 'max_elevation_m', label: 'Highest', unit: 'm', kind: 'number', optional: true },
        ],
      },
      {
        id: 'max_crater_density_per_km2',
        title: 'Crater density',
        icon: 'crater',
        tip: 'Craters per km² around each cell (Robbins 2018 catalogue).',
        fields: [
          { key: 'max_crater_density_per_km2', label: 'Most craters', unit: '/km²', kind: 'number', min: 0 },
          { key: 'crater_radius_km', label: 'Counted within', unit: 'km', kind: 'number', min: 0, max: 50 },
          { key: 'crater_min_diam_km', label: 'Counting from', unit: 'km', kind: 'number', min: 0, hint: 'Smallest crater diameter counted.' },
        ],
      },
      {
        id: 'min_rim_distance_km',
        title: 'Away from crater rims',
        icon: 'crater',
        tip: 'Distance to the rim (the catalogue circle) of every crater from a given size (Robbins 2018).',
        fields: [
          { key: 'min_rim_distance_km', label: 'At least', unit: 'km', kind: 'number', min: 0, max: 50 },
          { key: 'rim_min_diam_km', label: 'Craters from', unit: 'km', kind: 'number', min: 0, hint: 'Smallest crater whose rim counts.' },
        ],
      },
      {
        id: 'max_permanent_shadow',
        title: 'Outside permanent shadow',
        icon: 'mountain',
        tip: 'Share of the cell in permanent shadow at most (PGDA 69, 960 m). 0 keeps only cells with no shadow at all.',
        fields: [share('Shadow at most', 'Share of the cell in permanent shadow.', 'max_permanent_shadow')],
      },
      {
        id: 'sun_el_at_landing',
        title: 'Sun height at landing',
        icon: 'sun',
        window: true,
        tip: 'Solar elevation at the start of the window, at each sample (ray-traced horizon).',
        fields: [
          { key: 'min_sun_el_at_landing_deg', label: 'Lowest', unit: '°', kind: 'number', optional: true, min: -90, max: 90 },
          { key: 'max_sun_el_at_landing_deg', label: 'Highest', unit: '°', kind: 'number', optional: true, min: -90, max: 90 },
        ],
      },
      {
        id: 'earth_visible_at_landing',
        title: 'Earth in view at landing',
        icon: 'earth',
        window: true,
        tip: 'The Earth is in contact (the share of its disc set in the mission options) at the start of the window.',
        fields: [],
        flag: { key: 'earth_visible_at_landing', value: true },
      },
      { id: 'roughness', title: 'Roughness', icon: 'slope', tip: '', fields: [], unavailable: 'The LOLA roughness map in the data has no confirmed units, so it is not used.' },
      { id: 'rocks', title: 'Rocks', icon: 'rock', tip: '', fields: [], unavailable: 'No open boulder map covers the pole (LROC counts exist for single sites only).' },
    ],
  },
  {
    id: 'light',
    letter: 'C',
    title: 'Light and power',
    filters: [
      {
        id: 'min_long_term_sun',
        title: 'Long-term sunlight',
        icon: 'sun',
        tip: 'Mean share of the solar disc visible over 18.6 years (PGDA 69, south of 65° S).',
        fields: [share('At least', 'Share of time, 0 to 1.', 'min_long_term_sun')],
      },
      {
        id: 'min_sunlit_fraction',
        title: 'Sunlight during the mission',
        icon: 'sun',
        window: true,
        tip: 'Share of the mission window with some Sun visible over the ray-traced horizon.',
        fields: [share('Lit at least', 'Share of the window, 0 to 1.', 'min_sunlit_fraction')],
      },
      {
        id: 'min_light_left_h',
        title: 'Light left after landing',
        icon: 'clock',
        window: true,
        tip: 'Hours of continuous sunlight from the landing instant.',
        fields: [{ key: 'min_light_left_h', label: 'At least', unit: 'h', kind: 'number', min: 0 }],
      },
      {
        id: 'min_mean_power_w_m2',
        title: 'Mean solar power',
        icon: 'bolt',
        window: true,
        tip: 'Mean power on 1 m² of panel over the window (panel orientation from the mission options).',
        fields: [{ key: 'min_mean_power_w_m2', label: 'At least', unit: 'W/m²', kind: 'number', min: 0 }],
      },
      {
        id: 'max_dark_h',
        title: 'Longest darkness',
        icon: 'clock',
        window: true,
        tip: 'Longest stretch of the window without any Sun (terrain shadow or eclipse).',
        fields: [{ key: 'max_dark_h', label: 'At most', unit: 'h', kind: 'number', min: 0 }],
      },
      { id: 'battery', title: 'Battery lasts', icon: 'bolt', tip: '', fields: [], unavailable: 'Sized on one spot: open an area with Study, then the Power panel.' },
    ],
  },
  {
    id: 'earth',
    letter: 'D',
    title: 'Earth contact',
    filters: [
      {
        id: 'min_long_term_earth',
        title: 'Long-term Earth view',
        icon: 'earth',
        tip: 'Share of time with any of the Earth visible over 18.6 years (PGDA 69, south of 65° S).',
        fields: [share('At least', 'Share of time, 0 to 1.', 'min_long_term_earth')],
      },
      {
        id: 'min_comms_fraction',
        title: 'Direct-to-Earth time',
        icon: 'earth',
        window: true,
        tip: 'Share of the window with the Earth in contact over the ray-traced horizon.',
        fields: [share('At least', 'Share of the window, 0 to 1.', 'min_comms_fraction')],
      },
      {
        id: 'max_blackout_h',
        title: 'Longest blackout',
        icon: 'clock',
        window: true,
        tip: 'Longest stretch of the window without the Earth in contact.',
        fields: [{ key: 'max_blackout_h', label: 'At most', unit: 'h', kind: 'number', min: 0 }],
      },
      {
        id: 'min_contact_left_h',
        title: 'Contact left after landing',
        icon: 'clock',
        window: true,
        tip: 'Hours of continuous Earth contact from the landing instant.',
        fields: [{ key: 'min_contact_left_h', label: 'At least', unit: 'h', kind: 'number', min: 0 }],
      },
      {
        id: 'min_both_fraction',
        title: 'Sun and Earth together',
        icon: 'sun',
        window: true,
        tip: 'Share of the window with the Sun visible and the Earth in contact at the same time.',
        fields: [share('At least', 'Share of the window, 0 to 1.', 'min_both_fraction')],
      },
      { id: 'link_margin', title: 'Link margin', icon: 'earth', tip: '', fields: [], unavailable: 'Needs a radio link budget (antenna, power, frequency), not part of the data.' },
    ],
  },
  {
    id: 'thermal',
    letter: 'E',
    title: 'Temperature',
    filters: [
      { id: 'temperature', title: 'Hottest and coldest', icon: 'thermo', tip: '', fields: [], unavailable: 'The thermal model runs on one spot: Study an area, then the Power panel.' },
    ],
  },
  {
    id: 'radiation',
    letter: 'F',
    title: 'Radiation',
    filters: [
      {
        id: 'max_dose_mgy',
        title: 'Radiation dose',
        icon: 'radiation',
        tip: 'Cosmic-ray dose over the window (LRO CRaTER mean, silicon) scaled by the open sky over the terrain.',
        fields: [{ key: 'max_dose_mgy', label: 'At most', unit: 'mGy', kind: 'number', min: 0 }],
      },
      {
        id: 'max_sky_sr',
        title: 'Terrain shielding',
        icon: 'mountain',
        tip: 'Open sky at most (PGDA 69): less sky means more of the cosmic rays blocked by the terrain. A flat plain sees 2π sr.',
        fields: [{ key: 'max_sky_sr', label: 'Open sky at most', unit: 'sr', kind: 'number', min: 0, max: 6.2832 }],
      },
      { id: 'storm_risk', title: 'Solar storm risk', icon: 'radiation', tip: '', fields: [], unavailable: 'No forecast of solar particle events exists for a future window.' },
    ],
  },
  {
    id: 'window',
    letter: 'G',
    title: 'Mission window',
    filters: [
      {
        id: 'robust_delay_h',
        title: 'Robust to a delay',
        icon: 'calendar',
        window: true,
        tip: 'The window filters must also pass if the landing slips by this many hours (same duration).',
        fields: [{ key: 'robust_delay_h', label: 'Delay', unit: 'h', kind: 'number', min: 0 }],
      },
    ],
  },
  {
    id: 'colony',
    letter: 'H',
    title: 'Colony',
    filters: [
      { id: 'colony', title: 'Colony survives', icon: 'habitat', tip: '', fields: [], unavailable: 'Sized on one spot: Study an area, then Colony in the Power panel.' },
    ],
  },
  {
    id: 'science',
    letter: 'I',
    title: 'Science',
    filters: [
      {
        id: 'max_psr_distance_km',
        title: 'Near permanent shadow',
        icon: 'science',
        tip: 'Within this distance of a permanently shadowed pixel (PGDA 69: at least half of a 960 m pixel in shadow), where water ice may be.',
        fields: [{ key: 'max_psr_distance_km', label: 'Within', unit: 'km', kind: 'number', min: 0, max: 100 }],
      },
      {
        id: 'min_hydrogen_ppm',
        title: 'Hydrogen',
        icon: 'science',
        tip: 'Hydrogen in the top metre, ppm by weight (Lunar Prospector neutron spectrometer, Feldman et al. 2001). 0.5° bins and a footprint of about 45 km: it marks regions, not single cells.',
        fields: [{ key: 'min_hydrogen_ppm', label: 'At least', unit: 'ppm', kind: 'number' }],
      },
    ],
  },
]

export const ALL_FILTERS: MissionFilter[] = MISSION_GROUPS.flatMap((g) => g.filters)

/** The `filters` object of the request from what is switched on and typed, or an error message for the planner. */
export function buildFilters(
  enabled: Record<string, boolean>,
  values: Record<string, Record<string, string>>,
): { filters: Record<string, number | boolean | string>; window: boolean } | string {
  const filters: Record<string, number | boolean | string> = {}
  let window = false
  for (const f of ALL_FILTERS) {
    if (!enabled[f.id] || f.unavailable) continue
    if (f.flag) filters[f.flag.key] = f.flag.value
    let filled = 0
    for (const field of f.fields) {
      const raw = (values[f.id]?.[field.key] ?? '').trim()
      if (!raw) {
        if (field.optional) continue
        return `${f.title}: ${field.label.toLowerCase()} is required`
      }
      if (field.kind === 'select') {
        filters[field.key] = raw
      } else {
        const n = Number(raw.replace(',', '.'))
        if (!Number.isFinite(n)) return `${f.title}: ${field.label.toLowerCase()} must be a number`
        if ((field.min != null && n < field.min) || (field.max != null && n > field.max)) {
          return `${f.title}: ${field.label.toLowerCase()} must be between ${field.min ?? '−∞'} and ${field.max ?? '∞'}${field.unit ? ` ${field.unit}` : ''}`
        }
        filters[field.key] = n
      }
      filled++
    }
    if (f.fields.length > 0 && filled === 0) return `${f.title}: fill at least one value`
    if (f.window) window = true
  }
  return { filters, window }
}

/** Display names of the API's funnel ids. */
export const FUNNEL_LABEL: Record<string, string> = {
  side: 'Near or far side',
  away_from_landings_km: 'Away from past landings',
  max_slope_deg: 'Maximum slope',
  elevation_m: 'Elevation range',
  max_permanent_shadow: 'Outside permanent shadow',
  min_rim_distance_km: 'Away from crater rims',
  max_crater_density_per_km2: 'Crater density',
  min_long_term_sun: 'Long-term sunlight',
  min_long_term_earth: 'Long-term Earth view',
  max_sky_sr: 'Terrain shielding',
  max_dose_mgy: 'Radiation dose',
  max_psr_distance_km: 'Near permanent shadow',
  min_hydrogen_ppm: 'Hydrogen',
  landing_radius_km: 'Landing radius',
  min_sunlit_fraction: 'Sunlight during the mission',
  max_dark_h: 'Longest darkness',
  min_comms_fraction: 'Direct-to-Earth time',
  max_blackout_h: 'Longest blackout',
  min_sun_el_at_landing_deg: 'Sun height at landing (lowest)',
  max_sun_el_at_landing_deg: 'Sun height at landing (highest)',
  earth_visible_at_landing: 'Earth in view at landing',
  min_mean_power_w_m2: 'Mean solar power',
  min_light_left_h: 'Light left after landing',
  min_contact_left_h: 'Contact left after landing',
  min_both_fraction: 'Sun and Earth together',
  robust_delay_h: 'Robust to a delay',
}
