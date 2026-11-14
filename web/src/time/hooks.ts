/**
 * React hooks over the browser engine: the static tables, a site model for the selection, the live state at
 * the active instant (throttled to ~10 updates per second during playback) and the series over the window.
 */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { type Selection, useApp } from '../state/store'
import { usePointHorizon, useSites } from '../api/hooks'
import { type ModelInfo, placeModel } from './place'
import {
  type AnalysisParams,
  type Metrics,
  type Sample,
  type SiteModel,
  type Transition,
  computeMetrics,
  evaluateAt,
  hasComms,
  isSunlit,
  nextTransition,
  timeGrid,
  visibilityRanges,
} from './engine'
import { loadEphemeris, loadHorizonMasks } from './staticData'

const forever = { staleTime: Infinity, gcTime: Infinity, retry: 1 }

export const useEphemeris = () => useQuery({ queryKey: ['static', 'ephemeris'], queryFn: loadEphemeris, ...forever })
export const useMasks = () => useQuery({ queryKey: ['static', 'masks'], queryFn: loadHorizonMasks, ...forever })

export type { ModelInfo } from './place'

/** Site model for the selection (see place.ts). */
export function useSiteModel(sel: Selection, mastM: number): ModelInfo | null {
  const masks = useMasks().data
  const names = useSiteNames()
  const ph = usePointHorizon(sel, mastM).data
  const traced = useMemo(
    () => (ph ? { kind: ph.horizon_kind, values: ph.elevation_deg, groundM: ph.ground_m, cellM: ph.near_cell_m } : null),
    [ph],
  )
  return useMemo(() => (masks ? placeModel(masks, sel, mastM, names, traced) : null), [masks, sel, mastM, names, traced])
}

/** Display names from the API catalogue (the static copy has the same ones). */
export function useSiteNames(): Map<string, string> {
  const sites = useSites().data
  return useMemo(() => new Map(sites?.sites.map((s) => [s.id, s.name]) ?? []), [sites])
}

/** The active instant, re-read at most every `ms` while playing (panels update ~10 times per second). */
export function useThrottledTime(ms = 100): number {
  const [shown, setShown] = useState(() => useApp.getState().tMs)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    // Subscribe outside React so playback (a new time every frame) does not re-render every panel.
    const unsubscribe = useApp.subscribe((s) => {
      if (!s.playing) {
        if (timer) clearTimeout(timer)
        timer = null
        setShown(s.tMs)
        return
      }
      timer ??= setTimeout(() => {
        timer = null
        setShown(useApp.getState().tMs)
      }, ms)
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [ms])
  return shown
}

export interface LiveState {
  sample: Sample
  nextSun: Transition | null
  nextEarth: Transition | null
}

export function useLiveState(info: ModelInfo | null, tMs: number, params: AnalysisParams): LiveState | null | 'out-of-range' {
  const eph = useEphemeris().data
  const playing = useApp((s) => s.playing)
  // Transitions need a scan of up to 45 days: recompute them only when paused or every 6 simulated hours.
  const coarseT = playing ? Math.floor(tMs / 21_600_000) * 21_600_000 : tMs
  const transitions = useMemo(() => {
    if (!eph || !info || !eph.table.covers(coarseT)) return null
    return {
      sun: nextTransition(eph.table, info.model, coarseT, 'sun', params),
      earth: nextTransition(eph.table, info.model, coarseT, 'earth', params),
    }
  }, [eph, info, coarseT, params])
  return useMemo(() => {
    if (!eph || !info) return null
    if (!eph.table.covers(tMs)) return 'out-of-range'
    const sample = evaluateAt(eph.table, info.model, tMs, params)
    const shift = (tr: Transition | null | undefined) => (tr && tr.atMs > tMs ? { ...tr, inMs: tr.atMs - tMs } : null)
    return { sample, nextSun: shift(transitions?.sun), nextEarth: shift(transitions?.earth) }
  }, [eph, info, tMs, params, transitions])
}

export interface WindowSeries {
  t: number[]
  samples: Sample[]
  metrics: Metrics
  sunlit: [number, number][]
  comms: [number, number][]
}

export function evaluateWindow(
  table: Parameters<typeof evaluateAt>[0],
  model: SiteModel,
  startMs: number,
  durationH: number,
  stepMin: number,
  params: AnalysisParams,
): WindowSeries | null {
  const t = timeGrid(startMs, durationH, stepMin).filter((x) => table.covers(x))
  if (t.length < 2) return null
  const samples = t.map((x) => evaluateAt(table, model, x, params))
  return {
    t,
    samples,
    metrics: computeMetrics(samples, params),
    sunlit: visibilityRanges(t, samples.map(isSunlit)),
    comms: visibilityRanges(t, samples.map((s) => hasComms(s, params))),
  }
}

/** Series over the analysis window, browser engine. Step chosen to keep ≤ 2 000 samples. */
export function useWindowSeries(info: ModelInfo | null, startMs: number, durationH: number, params: AnalysisParams): WindowSeries | null {
  const eph = useEphemeris().data
  return useMemo(() => {
    if (!eph || !info) return null
    const stepMin = Math.max(10, Math.ceil((durationH * 60) / 2000 / 10) * 10)
    return evaluateWindow(eph.table, info.model, startMs, durationH, stepMin, params)
  }, [eph, info, startMs, durationH, params])
}

/** Stable params object from the store. */
export function useParams(): AnalysisParams {
  const panel = useApp((s) => s.panel)
  const commsMinFraction = useApp((s) => s.commsMinFraction)
  return useMemo(() => ({ panel, commsMinFraction }), [panel, commsMinFraction])
}
