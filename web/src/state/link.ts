/**
 * State of the radio-link section (AERO-2): the form the user fills (networks, level, budget, own antennas) and the
 * timeline option that shows the Earth row. `useLinkResult` builds the POST /api/v1/link request from this form and
 * the app's place and window, and runs it; the panel and the timeline both call it, so they share one cached answer.
 *
 * The answer updates by itself: every valid change of the form (after a short pause while typing) asks again, and the
 * previous answer stays on screen, marked busy, until the new one arrives. At the budget level, while the budget is
 * incomplete, the geometry is asked instead, so the timeline keeps its Link row and the panel says what is missing.
 */
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { useLink } from '../api/hooks'
import { DEFAULT_FORM, type LinkForm, buildLinkRequestWithFallback } from '../panels/linkModel'
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

export function useLinkRequest() {
  const selection = useApp((s) => s.selection)
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const commsMinFraction = useApp((s) => s.commsMinFraction)
  const { networks, level, direction, band, freq, eirp, rateKbps, ebn0, margin, losses, gt, custom } = useLinkStore()
  const form = useMemo<LinkForm>(
    () => ({ networks, level, direction, band, freq, eirp, rateKbps, ebn0, margin, losses, gt, custom }),
    [networks, level, direction, band, freq, eirp, rateKbps, ebn0, margin, losses, gt, custom],
  )
  const settled = useDebounced(form, 350)
  const request = useMemo(
    () => buildLinkRequestWithFallback(selection, { startIso: isoMinute(startMs), durationH, commsMinFraction }, settled),
    [selection, startMs, durationH, commsMinFraction, settled],
  )
  // the form being typed is ahead of the request being asked
  return { ...request, typing: settled !== form }
}

/** The radio link for the chosen place and window; `problem` says what the form still needs. */
export function useLinkResult() {
  const { body, problem, typing } = useLinkRequest()
  const query = useLink(body)
  return { ...query, body, problem, updating: typing || query.isFetching }
}
