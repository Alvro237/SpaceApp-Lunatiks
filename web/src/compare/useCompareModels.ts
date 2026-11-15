/**
 * POST /api/v1/power and POST /api/v1/link for every compared place, with the inputs applied in the comparison's
 * parameters panel and the same window, mast and panel as the rest of the navigator. One request per place and
 * model, cached by body, so changing one parameter asks again and an unchanged place is not asked twice.
 */
import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { api, isMissing } from '../api/client'
import type { LinkResponse, PowerResponse } from '../api/types'
import { buildLinkRequest } from '../panels/linkRequest'
import { buildPowerRequest } from '../panels/powerRequest'
import { useApp } from '../state/store'
import { type AppliedLink, type AppliedPower, useApplied } from './applied'
import type { ComparedPlace } from './useComparePlaces'

export interface ModelAnswer<T> {
  /** null while the model is not applied or an input is missing. */
  data: T | null
  loading: boolean
  /** Why there is no answer: a missing input (before any request), or the API's message. */
  error: string | null
}
export interface PlaceModels {
  power: ModelAnswer<PowerResponse>
  link: ModelAnswer<LinkResponse>
}

const idle = { data: null, loading: false, error: null }
const retry = (count: number, e: unknown) => !isMissing(e) && count < 1
const message = (e: unknown) => (isMissing(e) ? 'This endpoint is not deployed on the API in use.' : (e as Error).message)

export function useCompareModels(places: ComparedPlace[]): { models: PlaceModels[]; inputError: { power: string | null; link: string | null } } {
  const applied = useApplied()
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const mastM = useApp((s) => s.mastM)
  const panel = useApp((s) => s.panel)
  const commsMinFraction = useApp((s) => s.commsMinFraction)

  const bodies = useMemo(() => {
    const power = (a: AppliedPower | null, sel: ComparedPlace['sel']) => {
      if (!a) return { body: null, error: null }
      try {
        return { body: buildPowerRequest({ ...a, panel, startMs, durationH, mastM }, sel), error: null }
      } catch (e) {
        return { body: null, error: (e as Error).message }
      }
    }
    const link = (a: AppliedLink | null, sel: ComparedPlace['sel']) => {
      if (!a) return { body: null, error: null }
      try {
        return { body: buildLinkRequest({ ...a, commsMinFraction, startMs, durationH, mastM }, sel), error: null }
      } catch (e) {
        return { body: null, error: (e as Error).message }
      }
    }
    return places.map((p) => ({ power: power(applied.power, p.sel), link: link(applied.link, p.sel) }))
  }, [places, applied.power, applied.link, panel, startMs, durationH, mastM, commsMinFraction])

  const powerQs = useQueries({
    queries: bodies.map((b) => ({
      queryKey: ['compare-power', b.power.body],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.power(b.power.body!, signal),
      enabled: !!b.power.body,
      retry,
      staleTime: 5 * 60_000,
    })),
  })
  const linkQs = useQueries({
    queries: bodies.map((b) => ({
      queryKey: ['compare-link', b.link.body],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.link(b.link.body!, signal),
      enabled: !!b.link.body,
      retry,
      staleTime: 5 * 60_000,
    })),
  })

  const models = bodies.map((b, i): PlaceModels => {
    const pq = powerQs[i]
    const lq = linkQs[i]
    return {
      power: !applied.power
        ? idle
        : b.power.error
          ? { data: null, loading: false, error: b.power.error }
          : { data: pq?.data ?? null, loading: !!pq?.isFetching && !pq.data, error: pq?.error ? message(pq.error) : null },
      link: !applied.link
        ? idle
        : b.link.error
          ? { data: null, loading: false, error: b.link.error }
          : { data: lq?.data ?? null, loading: !!lq?.isFetching && !lq.data, error: lq?.error ? message(lq.error) : null },
    }
  })
  return { models, inputError: { power: bodies[0]?.power.error ?? null, link: bodies[0]?.link.error ?? null } }
}
