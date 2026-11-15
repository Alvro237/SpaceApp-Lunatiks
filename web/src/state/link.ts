/**
 * State of the radio-link section (AERO-2): the form the user fills (networks, level, budget, own antennas) and the
 * timeline option that shows the Earth row. `useLinkResult` builds the POST /api/v1/link request from this form and
 * the app's place and window, and runs it; the panel and the timeline both call it, so they share one cached answer.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import { useLink } from '../api/hooks'
import { DEFAULT_FORM, type LinkForm, buildLinkRequest } from '../panels/linkModel'
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

export function useLinkRequest() {
  const selection = useApp((s) => s.selection)
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const commsMinFraction = useApp((s) => s.commsMinFraction)
  const form = useLinkStore()
  const { networks, level, direction, band, freq, eirp, rateKbps, ebn0, margin, losses, gt, custom } = form
  return useMemo(
    () =>
      buildLinkRequest(
        selection,
        { startIso: isoMinute(startMs), durationH, commsMinFraction },
        { networks, level, direction, band, freq, eirp, rateKbps, ebn0, margin, losses, gt, custom },
      ),
    [selection, startMs, durationH, commsMinFraction, networks, level, direction, band, freq, eirp, rateKbps, ebn0, margin, losses, gt, custom],
  )
}

/** The radio link for the chosen place and window; `problem` says what the form still needs. */
export function useLinkResult() {
  const { body, problem } = useLinkRequest()
  const query = useLink(body)
  return { ...query, body, problem }
}
