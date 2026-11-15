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
  /** filter id -> on */
  enabled: Record<string, boolean>
  /** filter id -> field key -> typed text */
  values: Record<string, Record<string, string>>
  result: AreaSearchResponse | null
  raster: AreaRaster | null
  /** Paint the answer on the map. */
  show: boolean
  /** Area picked in the list. */
  focus: number | null
  /** Where the map should look (a fly-to request: the region after a search, an area from the list). */
  goTo: { lat: number; lon: number; km: number; seq: number } | null
  set: (p: Partial<Omit<AreasState, 'set' | 'setValue' | 'toggle' | 'setResult' | 'look'>>) => void
  look: (lat: number, lon: number, km: number) => void
  setValue: (fid: string, key: string, v: string) => void
  toggle: (fid: string) => void
  setResult: (r: AreaSearchResponse | null) => void
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
  radiusKm: 30,
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
  show: true,
  focus: null,
  goTo: null,
  set: (p) => set(p),
  look: (lat, lon, km) => set((s) => ({ goTo: { lat, lon, km, seq: (s.goTo?.seq ?? 0) + 1 } })),
  setValue: (fid, key, v) => set((s) => ({ values: { ...s.values, [fid]: { ...s.values[fid], [key]: v } } })),
  toggle: (fid) => set((s) => ({ enabled: { ...s.enabled, [fid]: !s.enabled[fid] } })),
  setResult: (r) => set({ result: r, raster: r ? rasterOf(r) : null, focus: null, show: true }),
}))
