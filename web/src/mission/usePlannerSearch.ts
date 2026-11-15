/**
 * Live preview and Simulate (mission-planner-ui-spec.md section 3.4) over `POST /api/v1/suitability/search`: every
 * change to an input that parses and validates schedules a preview request 500 ms after the last keystroke
 * (`max_window_samples: 60`); a newer change aborts the one in flight. With nothing depending on the mission window
 * the preview already is the full answer. Simulate sends the same request with `max_window_samples: 300`.
 *
 * Reordering the priorities does not start a request (the map is re-weighted in the browser from the answer's
 * layers); the order is sent as `priority` with the next one, or at once with "Re-rank the sites" (`rerankSeq`).
 */
import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { SuitabilityLinkInput, SuitabilityRequest } from '../api/types'
import { buildPlannerLink } from '../panels/linkModel'
import { useLinkStore } from '../state/link'
import { useAreas } from '../state/areas'
import { useApp } from '../state/store'
import { isoMinute } from '../time/clock'
import { type SuitabilityInputs, buildSuitability, needsLink, resolveCellKm } from './plannerInputs'
import { priorityOrder } from './score'

export const PREVIEW_SAMPLES = 60
export const FULL_SAMPLES = 300
const DEBOUNCE_MS = 500
/** Proposed landing sites and their least spacing (the API's defaults; display choices, not physical thresholds). */
export const TOP_K = 10
export const MIN_SEPARATION_KM = 10

export interface PlannerSearch {
  /** A request is in flight. */
  pending: boolean
  /** A build or network error, for the footer. */
  error: string | null
  /** Whether the answer depends on the mission window (so a preview differs from the full answer). */
  hasWindow: boolean
  /** The last answer came from a preview (60 samples), not the full run. */
  isPreview: boolean
  seconds: number | null
  /** Send the same request at full detail (300 samples). */
  simulate: () => void
}

export interface RequestContext {
  center: { lat: number; lon: number }
  radiusKm: number
  cellKm: number
  startMs: number
  durationH: number
  mastM: number
  panel: 'tracking' | 'vertical' | 'horizontal'
  /** Radio link settings, when the search uses contact (the Earth category or a criterion of it is on). */
  link: SuitabilityLinkInput | null
  azStepDeg: number
  horizonKm: number
  unknownPasses: boolean
  priority: string[]
}

/** The request body from the built inputs and the rest of the planner's state. */
export function suitabilityRequest(built: SuitabilityInputs, ctx: RequestContext, samples: number): SuitabilityRequest {
  const priority = priorityOrder(ctx.priority, built.scored)
  return {
    region: { center_lat: ctx.center.lat, center_lon: ctx.center.lon, radius_km: ctx.radiusKm },
    start: isoMinute(ctx.startMs),
    duration_h: ctx.durationH,
    categories: built.categories,
    criteria: built.criteria,
    ...(priority.length > 0 ? { priority } : {}),
    cell_km: ctx.cellKm,
    ...(built.landing_radius_km != null ? { landing_radius_km: built.landing_radius_km } : {}),
    ...(built.robust_delay_h != null ? { robust_delay_h: built.robust_delay_h } : {}),
    mast_m: ctx.mastM,
    panel: ctx.panel,
    ...(ctx.link ? { link: ctx.link } : {}),
    horizon_az_step_deg: ctx.azStepDeg,
    horizon_radius_km: ctx.horizonKm,
    max_window_samples: samples,
    unknown_passes: ctx.unknownPasses,
    top_k: TOP_K,
    min_separation_km: MIN_SEPARATION_KM,
  }
}

export function usePlannerSearch(): PlannerSearch {
  const a = useAreas()
  const { startMs, durationH, mastM, panel } = useApp()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const built = buildSuitability(a.categoriesOn, a.sideOn, a.plannerSwitches, a.plannerSelects, a.plannerValues)
  // the radio link settings (shared with the Link panel): only what contact needs, geometry. The budget is not asked here.
  const networks = useLinkStore((s) => s.networks)
  const direction = useLinkStore((s) => s.direction)
  const custom = useLinkStore((s) => s.custom)
  const linkBuilt = typeof built !== 'string' && needsLink(built) ? buildPlannerLink({ ...useLinkStore.getState(), networks, direction, custom }) : null
  const buildError = typeof built === 'string' ? built : (linkBuilt?.problem ?? null)
  const cellKm = resolveCellKm(a.cellMode, a.radiusKm)
  const ready = typeof built !== 'string' && built.categories.length > 0
  const hasWindow = typeof built !== 'string' && built.window

  const run = (samples: number, isPreview: boolean) => {
    // read the latest state: a timer may fire after renders that did not rebuild this closure's view of it
    const s = useAreas.getState()
    if (!s.center || typeof built === 'string' || !ready) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPending(true)
    setError(null)
    const body = suitabilityRequest(
      built,
      {
        center: s.center,
        radiusKm: s.radiusKm,
        cellKm,
        startMs,
        durationH,
        mastM,
        panel,
        link: linkBuilt?.link ?? null,
        azStepDeg: s.azStepDeg,
        horizonKm: s.horizonKm,
        unknownPasses: s.unknownPasses,
        priority: s.priority,
      },
      samples,
    )
    api
      .suitabilitySearch(body, controller.signal)
      .then((r) => {
        useAreas.getState().setSuit(r, isPreview, body)
        setPending(false)
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return
        setPending(false)
        setError(e instanceof Error ? e.message : String(e))
      })
  }

  // Everything that should start a fresh preview, as one comparable value (not the priority order: see the top).
  const sig = JSON.stringify([a.center, a.radiusKm, cellKm, built, linkBuilt?.link ?? null, startMs, durationH, mastM, panel, a.rerankSeq])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!a.center || buildError || !ready) return
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
    seconds: a.suit?.seconds ?? null,
    simulate: () => run(FULL_SAMPLES, false),
  }
}
