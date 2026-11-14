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
  level: 1 | 2 | 3
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
