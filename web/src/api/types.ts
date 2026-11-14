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

// --------------------------------------------------------------------------- pending (docs/endpoints.md)
export type HorizonKind = 'terrain' | 'smooth_sphere'

export interface BodyState {
  az_deg: number
  el_deg: number
  visible_fraction: number
  angular_radius_deg: number
  distance_km: number
}

export interface Transition {
  kind: 'set' | 'rise'
  at: string
  in_hours: number
}

/** GET /api/v1/sites/{id}/state (SW-1) */
export interface SiteState {
  t: string
  sun: BodyState
  earth: BodyState
  eclipse: number
  irradiance_w_m2: number
  power_w_m2: number
  next_sun_transition: Transition | null
  next_earth_transition: Transition | null
  horizon_kind: HorizonKind
  mast_used_m?: number
}

export interface TimeRange {
  start: string
  end: string
}

/** GET /api/v1/sites/{id}/series (SW-1) */
export interface SiteSeries {
  t: string[]
  sun_az: number[]
  sun_el: number[]
  sun_fraction: number[]
  earth_az: number[]
  earth_el: number[]
  earth_fraction: number[]
  power_w_m2: number[]
  metrics: Record<string, number | boolean>
  sunlit_ranges: TimeRange[]
  comms_ranges: TimeRange[]
  horizon_kind: HorizonKind
}

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
