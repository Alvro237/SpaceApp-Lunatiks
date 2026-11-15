/**
 * State of the radio-link section (AERO-2): the form the user fills (networks, level, budget, own antennas) and the
 * timeline option that shows the Earth row. `useLinkResult` builds the POST /api/v1/link request from this form and
 * the app's place and window, and runs it; the panel and the timeline both call it, so they share one cached answer.
 *
 * The answer updates by itself: every valid change of the form (after a short pause while typing) asks again, and the
 * previous answer stays on screen, marked busy, until the new one arrives. At the budget level, while the budget is
 * incomplete, the geometry is asked instead, so the timeline keeps its Link row and the panel says what is missing.
 */
import { keepPreviousData, useQueries } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { api, isMissing } from '../api/client'
import { useLink } from '../api/hooks'
import type { ComparedPlace } from '../compare/useComparePlaces'
import { DEFAULT_FORM, type LinkForm, type LinkSummary, buildLinkRequestWithFallback, summarize } from '../panels/linkModel'
import { isoMinute } from '../time/clock'
import { useApp } from './store'

interface LinkState extends LinkForm {
  /** Timeline: also draw the "Earth up" row (the site sees the Earth), next to the Link row. Off by default. */
  showEarthRow: boolean
  set: (patch: Partial<LinkForm & { showEarthRow: boolean }>) => void
}

export const useLinkStore = create<LinkState>()((set) => ({
  ...DEFAULT_FORM,
  showEarthRow: false,
  set: (patch) => set(patch),
}))

/** The value after it has stopped changing for `ms` (so typing a number asks the API once, not once per key). */
function useDebounced<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setShown(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return shown
}

/** The form once it has settled, and the window it applies to: what every request of the link is built from. */
function useSettledLink() {
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const commsMinFraction = useApp((s) => s.commsMinFraction)
  const { networks, level, direction, band, freq, eirp, rateKbps, ebn0, margin, losses, gt, custom } = useLinkStore()
  const form = useMemo<LinkForm>(
    () => ({ networks, level, direction, band, freq, eirp, rateKbps, ebn0, margin, losses, gt, custom }),
    [networks, level, direction, band, freq, eirp, rateKbps, ebn0, margin, losses, gt, custom],
  )
  const settled = useDebounced(form, 350)
  const win = useMemo(() => ({ startIso: isoMinute(startMs), durationH, commsMinFraction }), [startMs, durationH, commsMinFraction])
  // the form being typed is ahead of the request being asked
  return { settled, win, typing: settled !== form }
}

export function useLinkRequest() {
  const selection = useApp((s) => s.selection)
  const { settled, win, typing } = useSettledLink()
  const request = useMemo(() => buildLinkRequestWithFallback(selection, win, settled), [selection, win, settled])
  return { ...request, typing }
}

/** The radio link for the chosen place and window; `problem` says what the form still needs. */
export function useLinkResult() {
  const { body, problem, typing } = useLinkRequest()
  const query = useLink(body)
  return { ...query, body, problem, updating: typing || query.isFetching }
}

/** What the form still needs, whatever the place (null when it is complete). For the settings shown in the comparison. */
export function useLinkProblem(): string | null {
  const { settled, win } = useSettledLink()
  return useMemo(() => buildLinkRequestWithFallback({ kind: 'site', id: 'any' }, win, settled).problem, [win, settled])
}

/**
 * The radio link of every compared place, asked with the same form and window (the answers are cached under the same
 * key as the single-place one). A place is `null` until its answer is there, and also while the budget is incomplete:
 * the comparison shows only real link.
 */
export function useComparedLinks(places: ComparedPlace[]): Record<number, LinkSummary | null> {
  const { settled, win } = useSettledLink()
  const requests = useMemo(() => places.map((p) => ({ num: p.num, ...buildLinkRequestWithFallback(p.sel, win, settled) })), [places, win, settled])
  const results = useQueries({
    queries: requests.map((r) => ({
      queryKey: ['link', r.body],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.link(r.body!, signal),
      enabled: !!r.body,
      retry: (count: number, e: unknown) => !isMissing(e) && count < 1,
      staleTime: 60_000,
      placeholderData: keepPreviousData,
    })),
  })
  // a few small summaries per render: cheaper than keeping a variable-length dependency list in step
  const out: Record<number, LinkSummary | null> = {}
  requests.forEach((r, i) => {
    const data = results[i]?.data
    out[r.num] = data && !r.problem ? summarize(data) : null
  })
  return out
}