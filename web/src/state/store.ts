/**
 * Application state (Zustand): mode, view, active instant, playback, colour layer, selected place, mission
 * parameters and the comparison list. Everything a URL needs to reproduce a scenario is serialised by url.ts.
 */
import { create } from 'zustand'
import type { PanelModel } from '../time/engine'
import { MS_PER_HOUR } from '../time/engine'
import { type SpeedId, snapMinute } from '../time/clock'
import { usePanels } from './panels'

export type Selection = { kind: 'site'; id: string } | { kind: 'point'; lat: number; lon: number }

export type Mode = 'study' | 'mission'
export type ViewMode = '2d' | '3d'
/** The whole Moon as a globe, or the polar DEM map. */
export type Scale = 'globe' | 'map'
export type LayerId = 'none' | 'photo' | 'elevation' | 'slope' | 'sun_illumination' | 'earth_visibility' | 'permanent_shadow'
export type Lighting = 'sun' | 'relief'

export const MASTS_M = [0, 2, 5, 10] as const

/** How places are drawn on the map and globe (three mock-ups to choose from). */
export type MarkerStyle = 'pin' | 'crater' | 'cross'

export type BlockView = 'moon' | 'ground'

/** Site screening by the browser engine over the analysis window; null = not used. */
export interface Screen {
  minSunPct: number | null
  minEarthPct: number | null
  maxSlopeDeg: number | null
}

export const NO_SCREEN: Screen = { minSunPct: null, minEarthPct: null, maxSlopeDeg: null }
export const screenActive = (s: Screen) => s.minSunPct !== null || s.minEarthPct !== null || s.maxSlopeDeg !== null
export const MAX_COMPARE = 4


export interface Scene {
  mode: Mode
  scale: Scale
  view: ViewMode
  selection: Selection
  /** Active instant, Unix ms (UTC). */
  tMs: number
  /** Start of the analysis window (timeline, metrics), Unix ms. */
  startMs: number
  durationH: number
  mastM: number
  panel: PanelModel
  commsMinFraction: number
  layer: LayerId
  lighting: Lighting
  /** Draw Robbins (2018) crater rims of at least 3 km on the map. */
  craters: boolean
  /** Places compared live (same instant and window for all), in the order they were picked. */
  compare: Selection[]
}

/** View preferences that are not part of a shared scenario. */
export interface Prefs {
  markerStyle: MarkerStyle
  /** Text typed in the site search; the map shows the sites that match it. */
  siteQuery: string
  screen: Screen
  /** Educational mode: the same places and times drawn as a world of cubes. */
  blocks: boolean
  /** In Educational mode: the whole Moon, or the ground around the chosen place. */
  blockView: BlockView
}

/** The last place removed with a right click, so the removal can be undone. */
export interface Removed {
  sel: Selection
  name: string
  /** Position it had in the comparison, or -1. */
  compareIndex: number
  wasCurrent: boolean
  seq: number
}

export interface AppState extends Scene, Prefs {
  /** Multiselect: while on, every place the user picks is also added to the comparison. */
  compareMode: boolean
  /** Places selected before the current one, most recent last (what a removal falls back to). */
  history: Selection[]
  lastRemoved: Removed | null
  /** Where the map should open when entered from the globe (a navigation target, not a selection). */
  mapEntry: { lat: number; lon: number; seq: number } | null
  enterMap: (lat?: number, lon?: number) => void
  playing: boolean
  speed: SpeedId
  /** Map viewport request: bumped when the user picks a place so the camera flies there. */
  focusSeq: number
  set: (patch: Partial<Scene & Prefs>) => void
  select: (s: Selection) => void
  setTime: (tMs: number) => void
  setStart: (startMs: number) => void
  setPlaying: (p: boolean) => void
  setSpeed: (s: SpeedId) => void
  setCompareMode: (on: boolean) => void
  addCompare: (s?: Selection) => void
  removeCompare: (i: number) => void
  clearCompare: () => void
  /** Take a place off the map (right click): out of the comparison, and if it was the selection, back to the
   * previous place. */
  removePlace: (s: Selection, name: string) => void
  undoRemove: () => void
}

/** The current hour, so a first visit opens on "now" (inside the 2025-2035 tables). */
const nowHour = () => Math.floor(Date.now() / MS_PER_HOUR) * MS_PER_HOUR

export function defaultScene(now = nowHour()): Scene {
  return {
    mode: 'study',
    scale: 'globe',
    view: '2d',
    selection: { kind: 'site', id: 'im-2' },
    tMs: now,
    startMs: now,
    durationH: 24 * 30,
    mastM: 2,
    panel: 'vertical',
    commsMinFraction: 0.5,
    layer: 'photo',
    lighting: 'sun',
    craters: false,
    compare: [],
  }
}

export const sameSelection = (a: Selection, b: Selection) =>
  a.kind === 'site' && b.kind === 'site'
    ? a.id === b.id
    : a.kind === 'point' && b.kind === 'point' && a.lat === b.lat && a.lon === b.lon

export const useApp = create<AppState>()((set, get) => ({
  ...defaultScene(),
  playing: false,
  speed: '6h',
  focusSeq: 0,
  compareMode: false,
  history: [],
  lastRemoved: null,
  markerStyle: 'pin',
  siteQuery: '',
  screen: NO_SCREEN,
  blocks: false,
  blockView: 'moon',
  mapEntry: null,
  enterMap: (lat, lon) =>
    set((s) => ({
      scale: 'map',
      mapEntry: lat === undefined || lon === undefined ? null : { lat, lon, seq: (s.mapEntry?.seq ?? 0) + 1 },
    })),
  set: (patch) => set(patch),
  select: (selection) => {
    set((s) => ({
      selection,
      focusSeq: s.focusSeq + 1,
      history: sameSelection(s.selection, selection) ? s.history : [...s.history.filter((h) => !sameSelection(h, selection)), s.selection].slice(-10),
    }))
    if (get().compareMode) get().addCompare(selection)
  },
  setTime: (tMs) => {
    const { startMs, durationH } = get()
    const end = startMs + durationH * MS_PER_HOUR
    // The analysis window follows the cursor when playback or a jump leaves it.
    if (tMs < startMs || tMs > end) set({ tMs, startMs: snapMinute(tMs) })
    else set({ tMs })
  },
  setStart: (startMs) => set({ startMs: snapMinute(startMs), tMs: snapMinute(startMs) }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setCompareMode: (compareMode) => {
    // Multiselect on: the current place is the first one picked, and the single-place sections step aside.
    // Off: back to one place, and the comparison is cleared so the map shows one place again.
    set({ compareMode, compare: compareMode ? (get().compare.length ? get().compare : [get().selection]) : [] })
    usePanels.getState().setSection(null)
  },
  addCompare: (sel) =>
    set((s) => {
      const item = sel ?? s.selection
      if (s.compare.some((c) => sameSelection(c, item))) return s
      return { compare: [...s.compare, item].slice(-MAX_COMPARE) }
    }),
  removeCompare: (i) => set((s) => ({ compare: s.compare.filter((_, k) => k !== i) })),
  clearCompare: () => set({ compare: [] }),
  removePlace: (sel, name) => {
    const s = get()
    const compareIndex = s.compare.findIndex((c) => sameSelection(c, sel))
    const wasCurrent = sameSelection(s.selection, sel)
    if (compareIndex < 0 && !wasCurrent) return
    const compare = s.compare.filter((c) => !sameSelection(c, sel))
    const history = s.history.filter((h) => !sameSelection(h, sel))
    let selection = s.selection
    if (wasCurrent) {
      // the last place still compared, else the place picked before, else the default site
      selection = compare[compare.length - 1] ?? history[history.length - 1] ?? defaultScene().selection
    }
    set({
      compare,
      selection,
      history: wasCurrent ? history.filter((h) => !sameSelection(h, selection)) : history,
      lastRemoved: { sel, name, compareIndex, wasCurrent, seq: (s.lastRemoved?.seq ?? 0) + 1 },
    })
  },
  undoRemove: () => {
    const s = get()
    const r = s.lastRemoved
    if (!r) return
    const compare = [...s.compare]
    if (r.compareIndex >= 0 && !compare.some((c) => sameSelection(c, r.sel))) compare.splice(Math.min(r.compareIndex, compare.length), 0, r.sel)
    set({
      compare: compare.slice(0, MAX_COMPARE),
      selection: r.wasCurrent ? r.sel : s.selection,
      history: r.wasCurrent ? [...s.history, s.selection].slice(-10) : s.history,
      lastRemoved: null,
    })
  },
}))

/** The part of the state that defines a shareable scenario. */
export function sceneOf(s: AppState): Scene {
  const { mode, scale, view, selection, tMs, startMs, durationH, mastM, panel, commsMinFraction, layer, lighting, craters, compare } = s
  return { mode, scale, view, selection, tMs, startMs, durationH, mastM, panel, commsMinFraction, layer, lighting, craters, compare }
}
