/**
 * The places compared with Multiselect, each evaluated over the same window with the browser engine (the same
 * tables and masks as the rest of the navigator). Shared by the comparison panel and the timeline, which shows one
 * strip per place. At most MAX_COMPARE places at hourly steps, so the work is small.
 */
import { useMemo } from 'react'
import { type Selection, useApp } from '../state/store'
import { type WindowSeries, evaluateWindow, useEphemeris, useMasks, useParams, useSiteNames } from '../time/hooks'
import { type ModelInfo, placeModel } from '../time/place'

export interface ComparedPlace {
  /** 1-based number, as on the map. */
  num: number
  sel: Selection
  info: ModelInfo
  win: WindowSeries | null
}

/** True when Multiselect is on and at least two places are picked (the comparison is showing). */
export const useComparing = () => useApp((s) => s.compareMode && s.compare.length >= 2)

export function useComparePlaces(): ComparedPlace[] {
  const compare = useApp((s) => s.compare)
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const mastM = useApp((s) => s.mastM)
  const params = useParams()
  const eph = useEphemeris().data
  const masks = useMasks().data
  const names = useSiteNames()

  return useMemo(() => {
    if (!masks) return []
    return compare
      .map((sel, i) => {
        const info = placeModel(masks, sel, mastM, names)
        if (!info) return null
        const win = eph ? evaluateWindow(eph.table, info.model, startMs, durationH, 60, params) : null
        return { num: i + 1, sel, info, win }
      })
      .filter((p): p is ComparedPlace => p !== null)
  }, [masks, compare, mastM, names, eph, startMs, durationH, params])
}
