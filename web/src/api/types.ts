/**
 * API types. Endpoints already on `main` come from the client generated from /openapi.json (schema.gen.ts,
 * `npm run gen:api`): a contract change there breaks `npm run typecheck`. Endpoints still being built in
 * parallel are typed by hand below from docs/endpoints.md (and, for /power, from the open branch
 * feat/mech-power); regenerate and move each one to the generated section when its pull request is merged.
 */
import type { components } from './schema.gen'

type S = components['schemas']

// --------------------------------------------------------------------------- generated (merged endpoints)
export type SiteSummary = S['SiteSummary']
export type SiteList = S['SiteList']
export type SiteDetail = S['SiteDetail']

export interface Health {
  status: string
  version: string
  sites: number
  ephemeris_coverage_utc: [string, string][]
  grids: string[]
  craters: number
  constraints: string[]
}

export interface ConstraintsMeta {
  /** constraint id → docstring with the threshold shape */
  hard_filters: Record<string, string>
  soft_score_default_weights: Record<string, number>
}

export type DatasetsMeta = Record<string, unknown>

// --------------------------------------------------------------------------- SW-1 (generated, branch seryitron-branchito)
// Contract: docs/sw1-output-format.md. Angles are `az`/`el` inside `sun`/`earth`, `eclipse` is a word, and there
// is no power here: power belongs to POST /api/v1/power (MECH) only.
export type HorizonKind = 'terrain' | 'smooth_sphere'
export type BodyState = S['BodyState']
export type Transition = S['Transition']
export type EclipseState = S['StateResponse']['eclipse']
export type TerrainReference = S['TerrainReference']
/** GET /sites/{id}/state, or /points/state (same shape plus `terrain_reference`). */
export type SiteState = S['StateResponse'] & { terrain_reference?: TerrainReference | null }
/** GET /sites/{id}/series, or /points/series (same shape plus `terrain_reference`). */
export type SiteSeries = S['SeriesResponse'] & { terrain_reference?: TerrainReference | null }
/** GET /sites/{id}/horizon */
export type SiteHorizon = S['HorizonResponse']

/** Any time range; SW-1 ranges also carry duration_h and the two window flags. */
export interface TimeRange {
  start: string
  end: string
}

// --------------------------------------------------------------------------- pending (docs/endpoints.md)

export interface ConstraintResult {
  id: string
  passed: boolean | null
  value?: number | null
  threshold?: Record<string, unknown>
  margin?: number | null
  basis: string
  fraction?: number | null
  ranges?: TimeRange[]
  note?: string | null
}

/** POST /api/v1/candidates/search (SW-2) */
export interface CandidateSearchRequest {
  start: string
  duration_h: number
  mast_m: number
  panel: string
  comms_min_fraction: number
  scope: 'catalogue' | 'zones'
  hard_filters: Record<string, Record<string, unknown>>
  weights: Record<string, number>
  unknown_passes: boolean
}

export interface Candidate {
  site_id: string | null
  name?: string
  lat: number
  lon: number
  viable: boolean
  results: ConstraintResult[]
  score?: number | null
  parts?: Record<string, number>
  weights?: Record<string, number>
  horizon_kind?: HorizonKind
}

export interface CandidateSearchResponse {
  candidates: Candidate[]
  counts?: Record<string, number>
  eliminated_by?: Record<string, number>
}

/** POST /api/v1/power (MECH, branch feat/mech-power; contract in docs/api-guide-mech.md). Flat fields. */
export interface PowerRequest {
  site_id?: string
  lat?: number
  lon?: number
  start: string
  duration_h: number
  step_min: number
  mast_m: number
  panel: 'tracking' | 'vertical' | 'horizontal'
  level: 1 | 2 | 3 | 4
  /** manual coordinates: trace the skyline over LOLA terrain (default on the API: smooth sphere) */
  horizon?: 'terrain' | 'smooth_sphere'
  // level 2
  panel_area_m2?: number
  cell_efficiency?: number
  derating?: number
  // level 3
  load_w?: number
  night_load_w?: number
  battery_capacity_wh?: number
  battery_initial_soc?: number
  battery_min_soc?: number
  charge_efficiency?: number
  discharge_efficiency?: number
  // level 4 (colony analysis; the battery fields above without load_w)
  critical_load_w?: number
  deferrable_load_w?: number
  comms_load_w?: number
  comms_critical?: boolean
  shed_soc?: number
  max_charge_w?: number
  max_discharge_w?: number
  habitat?: HabitatIn
  regolith?: RegolithIn
  include_sizing?: boolean
}

/** Level 4 habitat (two-node thermal model). Temperatures in kelvin on the wire. */
export interface HabitatIn {
  crew_count: number
  t_set_k: number
  t_min_k: number
  ua_w_k: number
  area_m2: number
  skin_absorptivity: number
  skin_emissivity: number
  structure_mass_kg: number
  structure_specific_heat_j_kgk: number
  air_volume_m3: number
  air_pressure_pa: number
  metabolic_w_per_crew?: number
}

export interface RegolithIn {
  albedo: number
  emissivity: number
  conductivity_w_mk: number
  density_kg_m3: number
  heat_capacity_j_kgk: number
  geothermal_flux_w_m2: number
}

export type ColonyStatus = 'survives_independently' | 'survives_window_declining' | 'failure_after_x_days'

export interface EnergyBreakdown {
  generated_wh: number
  critical_served_wh: number
  heater_served_wh: number
  comms_served_wh: number
  deferrable_served_wh: number
  critical_unserved_wh: number
  noncritical_unserved_wh: number
  shed_wh: number
  curtailed_wh: number
  charge_losses_wh: number
  discharge_losses_wh: number
  battery_change_wh: number
}

export interface PowerResponse {
  site_id: string | null
  lat: number
  lon: number
  horizon_kind: HorizonKind
  mast_m_used: number
  start: string
  duration_h: number
  step_min: number
  assumptions: string[]
  t: string[]
  level: number
  panel: string
  // level 1
  sun_fraction: number[]
  sun_el_deg: number[]
  sunlit_ranges: TimeRange[]
  longest_dark_h: number
  sunlit_fraction: number
  obscuration: number[]
  eclipse_ranges: TimeRange[]
  mean_power_w_m2: number
  // level 2 (null below)
  irradiance_w_m2: number[] | null
  power_w: number[] | null
  mean_power_w: number | null
  energy_wh: number | null
  peak_power_w: number | null
  eclipse_energy_loss_wh: number | null
  // level 3 (null below)
  net_power_w: number[] | null
  battery_soc: number[] | null
  min_soc: number | null
  survives: boolean | null
  first_depletion_at: string | null
  energy_margin_wh: number | null
  load_profile_w: number[] | null
  final_soc: number | null
  depleted_ranges: TimeRange[] | null
  unserved_energy_wh: number | null
  curtailed_energy_wh: number | null
  usable_capacity_wh: number | null
  longest_dark_energy_wh: number | null
  // level 4 (null below)
  colony_status: ColonyStatus | null
  failure_after_days: number | null
  failure_at: string | null
  synodic_months: number | null
  month_soc_change: number[] | null
  critical_load_profile_w: number[] | null
  heater_w: number[] | null
  cooling_demand_w: number[] | null
  interior_k: number[] | null
  skin_k: number[] | null
  ground_k: number[] | null
  autonomy_h: (number | null)[] | null
  sunrise_margin_wh: (number | null)[] | null
  shed_ranges: TimeRange[] | null
  degraded_days: number | null
  interior_below_min_ranges: TimeRange[] | null
  energy_breakdown: EnergyBreakdown | null
  metabolic_heat_w: number | null
  habitat_heat_capacity_j_k: number | null
  unheated_equilibrium_k: number | null
  cold_soak_h: number | null
  min_battery_capacity_wh: number | null
  min_panel_area_m2: number | null
}

/** POST /api/v1/radiation (MECH, branch feat/mech-power): galactic cosmic rays from LRO CRaTER. */
export interface RadiationRequest {
  site_id?: string
  lat?: number
  lon?: number
  start: string
  duration_h: number
  step_min?: number
  mast_m?: number
  quality_factor?: number
  horizon?: 'terrain' | 'smooth_sphere'
}

export interface DoseRange {
  low: number
  mean: number
  high: number
}

export interface RadiationResponse {
  site_id: string | null
  lat: number
  lon: number
  horizon_kind: string
  start: string
  duration_h: number
  basis: string
  assumptions: string[]
  sky_solid_angle_sr: number | null
  sky_source: string
  shielding_factor: number | null
  mission_gcr_dose_mgy_si: DoseRange | null
  mission_effective_dose_msv: DoseRange | null
  career_limit_msv: number
  fraction_of_career_limit: number | null
  risk: { index: number; share_of_career_limit: number; index_with_worst_storm: number | null; worst_storm_msv: number | null; scale: string } | null
  dataset: { name: string; url: string; first: string; last: string }
}

/** GET /api/v1/craters (AERO-1, requested by the frontend plan) */
export interface Crater {
  lat: number
  lon: number
  diam_km: number
}
export interface CraterList {
  count: number
  craters: Crater[]
}

/** GET /api/v1/points/horizon: skyline of any point, ray-traced over the LOLA elevation grids where they cover it. */
export interface PointHorizon {
  lat: number
  lon: number
  ground_m: number
  ground_source: 'lola_grid' | 'reference_sphere'
  mast_m: number
  horizon_kind: HorizonKind
  near_grid: string | null
  near_cell_m: number | null
  terrain_range_km: number | null
  method: string
  validation: string
  az_step_deg: number
  az: number[]
  elevation_deg: number[]
  max_deg: number
  min_deg: number
  mean_deg: number
}

/** POST /api/v1/areas/search (SW-1, mission mode): which cells of a bounded region pass every filter switched on. */
export interface AreaSearchRequest {
  region: { center_lat: number; center_lon: number; radius_km: number }
  filters: Record<string, number | boolean | string>
  cell_km: number
  landing_radius_km?: number
  start?: string
  duration_h?: number
  step_min?: number
  mast_m: number
  panel: 'tracking' | 'vertical' | 'horizontal'
  comms_min_fraction: number
  horizon_az_step_deg: number
  horizon_radius_km: number
  max_window_samples: number
  unknown_passes: boolean
}

export interface AreaFilterCount {
  id: string
  stage: 'static' | 'landing_radius' | 'window'
  cells_in: number
  cells_out: number
  cells_unknown: number
}

export interface FoundArea {
  id: number
  cells: number
  area_km2: number
  centroid_lat: number
  centroid_lon: number
  best_lat: number
  best_lon: number
  best_score: number
  mean_score: number
  sites: string[]
}

export interface AreaSearchResponse {
  grid: { projection: string; x_left_m: number; y_top_m: number; cell_m: number; nx: number; ny: number }
  codes_b64: string
  score_b64: string
  counts: Record<'outside' | 'failed_static' | 'failed_window' | 'viable' | 'unknown', number>
  funnel: AreaFilterCount[]
  areas: FoundArea[]
  window: { samples: number; finest_tile_km: number; coarsest_tile_km: number; horizon_az_step_deg: number; horizon_radius_km: number } | null
  seconds: number
  assumptions: string[]
}
