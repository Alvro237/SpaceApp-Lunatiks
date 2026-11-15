/**
 * Mission mode: the area search (POST /api/v1/areas/search). Kept in a store, not in the panel, so the filters
 * survive closing the flyout and the map can paint the answer.
 *
 * Thresholds have no defaults (CLAUDE.md: a threshold needs a cited source or the planner's decision): a filter is
 * on only when the planner switches it on and types its values. The region and the resolution have defaults
 * because they set where and how finely the search looks, not what passes.
 */
import { create } from 'zustand'
import type { AreaSearchResponse } from '../api/types'
import { DEFAULT_PLANNER_SELECTS, DEFAULT_PLANNER_SWITCHES, DEFAULT_PLANNER_VALUES, type PlannerSelects, type PlannerSwitches, type PlannerValues } from '../mission/plannerInputs'

export interface AreaRaster {
  xLeftM: number
  yTopM: number
  cellM: number
  nx: number
  ny: number
  /** per cell, row 0 = top: 0 outside, 1 fails a static filter or the landing radius, 2 fails a window filter, 3 viable, 4 unknown */
  codes: Uint8Array
  /** per cell: score 1..255 for viable cells, 0 elsewhere */
  score: Uint8Array
}

export const CODE = { outside: 0, failStatic: 1, failWindow: 2, viable: 3, unknown: 4 } as const

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
  result: AreaSearchResponse | null
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

  set: (p: Partial<Omit<AreasState, 'set' | 'setValue' | 'toggle' | 'setResult' | 'look'>>) => void
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

export const useAreas = create<AreasState>((set) => ({
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
  setPlannerValue: (key, v) => set((s) => ({ plannerValues: { ...s.plannerValues, [key]: v } })),
  toggleCategory: (id) => set((s) => ({ categoriesOn: { ...s.categoriesOn, [id]: !s.categoriesOn[id] } })),
  toggleSwitch: (id) => set((s) => ({ plannerSwitches: { ...s.plannerSwitches, [id]: !s.plannerSwitches[id] } })),
  setSelect: (key, v) => set((s) => ({ plannerSelects: { ...s.plannerSelects, [key]: v } })),
  toggleCompareSelected: (id) =>
    set((s) => ({ compareSelected: s.compareSelected.includes(id) ? s.compareSelected.filter((x) => x !== id) : [...s.compareSelected, id] })),
}))
