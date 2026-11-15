/**
 * Live preview and Simulate (mission-planner-ui-spec.md section 3.4): every change to an input that parses and
 * validates schedules a preview request 500 ms after the last keystroke (`max_window_samples: 60`); a newer
 * change aborts the one in flight. With no window input active the preview already is the full answer. Simulate
 * sends the same request with `max_window_samples: 300` (today's default).
 */
import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { AreaSearchRequest } from '../api/types'
import { useAreas } from '../state/areas'
import { useApp } from '../state/store'
import { isoMinute } from '../time/clock'
import { buildPlannerFilters, commsMinFractionOf, resolveCellKm } from './plannerInputs'

export const PREVIEW_SAMPLES = 60
export const FULL_SAMPLES = 300
const DEBOUNCE_MS = 500

export interface PlannerSearch {
  /** A request is in flight. */
  pending: boolean
  /** A build or network error, for the footer. */
  error: string | null
  /** Whether the active filters need the mission window (so a preview differs from the full answer). */
  hasWindow: boolean
  /** The last answer came from a preview (60 samples), not the full run. */
  isPreview: boolean
  seconds: number | null
  /** Send the same request at full detail (300 samples). */
  simulate: () => void
}

export function usePlannerSearch(): PlannerSearch {
  const a = useAreas()
  const { startMs, durationH, mastM, panel } = useApp()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const built = buildPlannerFilters(a.categoriesOn, a.sideOn, a.plannerSwitches, a.plannerSelects, a.plannerValues)
  const buildError = typeof built === 'string' ? built : null
  const cellKm = resolveCellKm(a.cellMode, a.radiusKm)
  const hasFilters = typeof built !== 'string' && Object.keys(built.filters).length > 0
  const hasWindow = typeof built !== 'string' && built.window

  const run = (samples: number, isPreview: boolean) => {
    if (!a.center || typeof built === 'string' || !hasFilters) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPending(true)
    setError(null)
    const landing = a.landingRadiusKm.trim() ? Number(a.landingRadiusKm.replace(',', '.')) : undefined
    const body: AreaSearchRequest = {
      region: { center_lat: a.center.lat, center_lon: a.center.lon, radius_km: a.radiusKm },
      filters: built.filters,
      cell_km: cellKm,
      ...(landing != null && Number.isFinite(landing) ? { landing_radius_km: landing } : {}),
      start: isoMinute(startMs),
      duration_h: durationH,
      mast_m: mastM,
      panel,
      comms_min_fraction: commsMinFractionOf(a.plannerValues),
      horizon_az_step_deg: a.azStepDeg,
      horizon_radius_km: a.horizonKm,
      max_window_samples: samples,
      unknown_passes: a.unknownPasses,
    }
    api
      .areaSearch(body, controller.signal)
      .then((r) => {
        a.setResult(r, isPreview)
        setPending(false)
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return
        setPending(false)
        setError(e instanceof Error ? e.message : String(e))
      })
  }

  // Everything that should start a fresh preview, as one comparable value.
  const sig = JSON.stringify([a.center, a.radiusKm, cellKm, a.landingRadiusKm, built, startMs, durationH, mastM, panel])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!a.center || buildError || !hasFilters) return
    timerRef.current = setTimeout(() => run(hasWindow ? PREVIEW_SAMPLES : FULL_SAMPLES, hasWindow), DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // the signature alone decides whether a new preview is due
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  useEffect(() => () => abortRef.current?.abort(), [])

  return {
    pending,
    error: error ?? buildError,
    hasWindow,
    isPreview: a.isPreview,
    seconds: a.result?.seconds ?? null,
    simulate: () => run(FULL_SAMPLES, false),
  }
}
