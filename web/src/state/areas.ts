/**
 * Mission mode: the suitability search (POST /api/v1/suitability/search; the planner panel, Stage B) and the older
 * area search (POST /api/v1/areas/search; `panels/MissionPanel.tsx`, kept but unmounted). Kept in a store, not in the panel, so the filters
 * survive closing the flyout and the map can paint the answer.
 *
 * Thresholds have no defaults (CLAUDE.md: a threshold needs a cited source or the planner's decision): a filter is
 * on only when the planner switches it on and types its values. The region and the resolution have defaults
 * because they set where and how finely the search looks, not what passes.
 */
import { create } from 'zustand'
import type { AreaSearchResponse, SuitabilityRequest, SuitabilityResponse } from '../api/types'
import { reweight } from '../mission/score'
import { DEFAULT_PLANNER_SELECTS, DEFAULT_PLANNER_SWITCHES, DEFAULT_PLANNER_VALUES, type PlannerSelects, type PlannerSwitches, type PlannerValues } from '../mission/plannerInputs'

export interface AreaRaster {
  xLeftM: number
  yTopM: number
  cellM: number
  nx: number
  ny: number
  /** per cell, row 0 = top: 0 outside, 1 fails a static filter or the landing radius, 2 fails a window filter, 3 viable,
   * 4 unknown, 5 ruled out by the ephemeris bound (suitability search only) */
  codes: Uint8Array
  /** per cell: score 1..255 for viable cells, 0 elsewhere */
  score: Uint8Array
  /** per cell (suitability search): index in the answer's `layers` of the category that costs the most score, 255 none */
  limiting?: Uint8Array
}

export const CODE = { outside: 0, failStatic: 1, failWindow: 2, viable: 3, unknown: 4, failBound: 5 } as const

interface AreasState {
  /** Centre of the search disc; null until the planner picks one (map click in mission mode, or a place). */
  center: { lat: number; lon: number } | null
  radiusKm: number
  cellKm: number
  landingRadiusKm: string
  samples: number
  azStepDeg: number
  horizonKm: number
  unknownPasses: boolean
  /** filter id -> on (`panels/MissionPanel.tsx`, kept but unmounted) */
  enabled: Record<string, boolean>
  /** filter id -> field key -> typed text (`panels/MissionPanel.tsx`, kept but unmounted) */
  values: Record<string, Record<string, string>>
  /** Answer of the old area search (`panels/MissionPanel.tsx`, unmounted). */
  result: AreaSearchResponse | null
  /** Answer of the suitability search (the planner panel). */
  suit: SuitabilityResponse | null
  /** The request that produced `suit`. */
  suitRequest: SuitabilityRequest | null
  /** The answer's utility layers, decoded (uint8 0..250, 255 = no data), in the answer's order. */
  suitLayers: Uint8Array[]
  /** The planner's priority order of the scored categories, most important first (mission-planner-ui-spec.md 4.2
   * "Priorities"); categories not listed follow in catalogue order. Re-weights the map at once, sent as `priority`
   * with the next request. */
  priority: string[]
  /** Normalised weight per category of the map as painted now (ROC over `priority`). */
  weights: Record<string, number>
  /** Bumped to re-run the search at once with the current priorities (re-ranks the sites). */
  rerankSeq: number
  raster: AreaRaster | null
  /** Whether `result` came from a preview (`max_window_samples: 60`) or the full run (300): the planner panel's
   * footer text (3.4). Undefined with no window input active, where the preview already is the full answer. */
  isPreview: boolean
  /** Paint the answer on the map. */
  show: boolean
  /** Stage A colours of the viable cells (4.3): 1 continuous (red-yellow-green), 4 colour-blind (viridis). */
  areaMode: 1 | 4
  /** Area picked in the list. */
  focus: number | null
  /** Area ids ticked for comparison (the "Study" button toggles its own row, not a navigation to Study mode:
   * section user request 2026-11-15 — it stays here, not in a component, so a new search clears it with the
   * rest of the result). */
  compareSelected: number[]
  /** Where the map should look (a fly-to request: the region after a search, an area from the list). */
  goTo: { lat: number; lon: number; km: number; seq: number } | null

  // ---------------------------------------------------------------- Mission planner panel (mission-planner-ui-spec.md)
  cellMode: 'auto' | number
  advancedOpen: boolean
  /** category id -> on (3.3); "search_area" has no entry, its one input is its own switch. */
  categoriesOn: Record<string, boolean>
  sideOn: boolean
  plannerSwitches: PlannerSwitches
  plannerSelects: PlannerSelects
  plannerValues: PlannerValues
  showLandings: boolean
  /** "Pick on the Moon" armed a one-shot pick (3.8): the next click sets the centre, same as any click in mission
   * mode; this only drives the crosshair cursor and clears itself once a click lands or Escape is pressed. */
  pickArmed: boolean

  set: (p: Partial<Omit<AreasState, 'set' | 'setValue' | 'toggle' | 'setResult' | 'look' | 'setSuit' | 'setPriority'>>) => void
  setSuit: (r: SuitabilityResponse | null, isPreview?: boolean, req?: SuitabilityRequest) => void
  setPriority: (order: string[]) => void
  look: (lat: number, lon: number, km: number) => void
  setValue: (fid: string, key: string, v: string) => void
  toggle: (fid: string) => void
  setResult: (r: AreaSearchResponse | null, isPreview?: boolean) => void
  setPlannerValue: (key: string, v: string) => void
  toggleCategory: (id: string) => void
  toggleSwitch: (id: string) => void
  setSelect: (key: string, v: string) => void
  toggleCompareSelected: (id: number) => void
}

function decode(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export function rasterOf(r: AreaSearchResponse): AreaRaster {
  return {
    xLeftM: r.grid.x_left_m,
    yTopM: r.grid.y_top_m,
    cellM: r.grid.cell_m,
    nx: r.grid.nx,
    ny: r.grid.ny,
    codes: decode(r.codes_b64),
    score: decode(r.score_b64),
  }
}

/** The raster of a suitability answer, its score re-weighted by the planner's priority order (bit-identical to the
 * server's `score_b64` when the order is the one sent). */
function suitRaster(r: SuitabilityResponse, layers: Uint8Array[], priority: string[]): { raster: AreaRaster; weights: Record<string, number> } {
  const codes = decode(r.codes_b64)
  const w = reweight(
    codes,
    layers,
    r.layers.map((l) => l.category),
    priority,
  )
  return {
    raster: { xLeftM: r.grid.x_left_m, yTopM: r.grid.y_top_m, cellM: r.grid.cell_m, nx: r.grid.nx, ny: r.grid.ny, codes, score: w.score, limiting: w.limiting },
    weights: w.weights,
  }
}

export const useAreas = create<AreasState>((set, get) => ({
  center: null,
  // the person's decision (2026-11-15, spec section 1): 20 km, not today's 30 km
  radiusKm: 20,
  cellKm: 0.96,
  landingRadiusKm: '',
  samples: 200,
  azStepDeg: 0.5,
  horizonKm: 150,
  unknownPasses: false,
  enabled: {},
  values: {},
  result: null,
  suit: null,
  suitRequest: null,
  suitLayers: [],
  priority: [],
  weights: {},
  rerankSeq: 0,
  raster: null,
  isPreview: false,
  show: true,
  areaMode: 1,
  focus: null,
  compareSelected: [],
  goTo: null,
  cellMode: 'auto',
  advancedOpen: false,
  categoriesOn: {},
  sideOn: false,
  plannerSwitches: { ...DEFAULT_PLANNER_SWITCHES },
  plannerSelects: { ...DEFAULT_PLANNER_SELECTS },
  plannerValues: { ...DEFAULT_PLANNER_VALUES },
  showLandings: false,
  pickArmed: false,
  set: (p) => set(p),
  look: (lat, lon, km) => set((s) => ({ goTo: { lat, lon, km, seq: (s.goTo?.seq ?? 0) + 1 } })),
  setValue: (fid, key, v) => set((s) => ({ values: { ...s.values, [fid]: { ...s.values[fid], [key]: v } } })),
  toggle: (fid) => set((s) => ({ enabled: { ...s.enabled, [fid]: !s.enabled[fid] } })),
  setResult: (r, isPreview = false) => set({ result: r, raster: r ? rasterOf(r) : null, focus: null, compareSelected: [], show: true, isPreview }),
  setSuit: (r, isPreview = false, req) => {
    if (!r) {
      set({ suit: null, suitRequest: null, suitLayers: [], raster: null, weights: {}, focus: null, compareSelected: [], isPreview: false })
      return
    }
    const layers = r.layers.map((l) => decode(l.utility_b64))
    const { raster, weights } = suitRaster(r, layers, get().priority)
    set({ suit: r, suitRequest: req ?? null, suitLayers: layers, raster, weights, focus: null, compareSelected: [], show: true, isPreview })
  },
  setPriority: (order) => {
    const s = get()
    if (!s.suit) {
      set({ priority: order })
      return
    }
    const { raster, weights } = suitRaster(s.suit, s.suitLayers, order)
    set({ priority: order, raster, weights })
  },
  setPlannerValue: (key, v) => set((s) => ({ plannerValues: { ...s.plannerValues, [key]: v } })),
  toggleCategory: (id) => set((s) => ({ categoriesOn: { ...s.categoriesOn, [id]: !s.categoriesOn[id] } })),
  toggleSwitch: (id) => set((s) => ({ plannerSwitches: { ...s.plannerSwitches, [id]: !s.plannerSwitches[id] } })),
  setSelect: (key, v) => set((s) => ({ plannerSelects: { ...s.plannerSelects, [key]: v } })),
  toggleCompareSelected: (id) =>
    set((s) => ({ compareSelected: s.compareSelected.includes(id) ? s.compareSelected.filter((x) => x !== id) : [...s.compareSelected, id] })),
}))
