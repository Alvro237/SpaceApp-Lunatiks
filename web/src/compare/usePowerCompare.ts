/**
 * POST /api/v1/power for every compared place, with the inputs applied in the parameters panel and the same window,
 * mast and panel as the rest of the navigator. One request per place, cached by body, so changing one parameter
 * asks again and an unchanged place is not asked twice.
 */
import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api, isMissing } from '../api/client'
import type { PowerResponse } from '../api/types'
import { buildPowerRequest } from '../panels/powerRequest'
import { useApp } from '../state/store'
import { useApplied } from './applied'
import type { ComparedPlace } from './useComparePlaces'

export interface PowerAnswer {
  /** null while nothing is applied or an input is missing. */
  data: PowerResponse | null
  loading: boolean
  /** Why there is no answer: a missing input (before any request), or the API's message. */
  error: string | null
}

const retry = (count: number, e: unknown) => !isMissing(e) && count < 1
const message = (e: unknown) => (isMissing(e) ? 'This endpoint is not deployed on the API in use.' : (e as Error).message)

export function usePowerCompare(places: ComparedPlace[]): PowerAnswer[] {
  const applied = useApplied((s) => s.power)
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const mastM = useApp((s) => s.mastM)
  const panel = useApp((s) => s.panel)

  const bodies = useMemo(
    () =>
      places.map((p) => {
        if (!applied) return { body: null, error: null }
        try {
          return { body: buildPowerRequest({ ...applied, panel, startMs, durationH, mastM }, p.sel), error: null }
        } catch (e) {
          return { body: null, error: (e as Error).message }
        }
      }),
    [places, applied, panel, startMs, durationH, mastM],
  )

  const qs = useQueries({
    queries: bodies.map((b) => ({
      queryKey: ['compare-power', b.body],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.power(b.body!, signal),
      enabled: !!b.body,
      retry,
      staleTime: 5 * 60_000,
    })),
  })

  return bodies.map((b, i): PowerAnswer => {
    const q = qs[i]
    if (!applied) return { data: null, loading: false, error: null }
    if (b.error) return { data: null, loading: false, error: b.error }
    return { data: q?.data ?? null, loading: !!q?.isFetching && !q.data, error: q?.error ? message(q.error) : null }
  })
}
