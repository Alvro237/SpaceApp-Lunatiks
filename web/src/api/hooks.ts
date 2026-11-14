/** TanStack Query hooks over the API client. Catalogue and metadata are cached for the session. */
import { useMutation, useQuery } from '@tanstack/react-query'
import { type SeriesParams, type StateParams, api, isMissing } from './client'
import type { CandidateSearchRequest, PowerRequest, RadiationRequest } from './types'
import type { Selection } from '../state/store'

const forever = { staleTime: Infinity, gcTime: Infinity }
/** Do not retry a route that does not exist; retry network errors once. */
const retry = (count: number, e: unknown) => !isMissing(e) && count < 1

export const useSites = () => useQuery({ queryKey: ['sites'], queryFn: ({ signal }) => api.sites(signal), ...forever, retry })
export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: ({ signal }) => api.health(signal), retry })
export const useDatasets = () => useQuery({ queryKey: ['datasets'], queryFn: ({ signal }) => api.datasets(signal), ...forever, retry })
export const useConstraints = () =>
  useQuery({ queryKey: ['constraints'], queryFn: ({ signal }) => api.constraints(signal), ...forever, retry })

export function useApiState(sel: Selection, p: StateParams, enabled: boolean) {
  return useQuery({
    queryKey: ['state', sel, p],
    queryFn: ({ signal }) => (sel.kind === 'site' ? api.siteState(sel.id, p, signal) : api.pointState(sel.lat, sel.lon, p, signal)),
    enabled,
    retry,
    staleTime: 60_000,
  })
}

export function useApiSeries(sel: Selection, p: SeriesParams, enabled: boolean) {
  return useQuery({
    queryKey: ['series', sel, p],
    queryFn: ({ signal }) => (sel.kind === 'site' ? api.siteSeries(sel.id, p, signal) : api.pointSeries(sel.lat, sel.lon, p, signal)),
    enabled,
    retry,
    staleTime: 60_000,
  })
}

export const useCandidateSearch = () => useMutation({ mutationFn: (body: CandidateSearchRequest) => api.searchCandidates(body) })
export const usePower = () => useMutation({ mutationFn: (body: PowerRequest) => api.power(body) })

export function useRadiation(body: RadiationRequest | null) {
  return useQuery({
    queryKey: ['radiation', body],
    queryFn: ({ signal }) => api.radiation(body!, signal),
    enabled: !!body,
    retry,
    staleTime: Infinity,
  })
}

export function useCraters(bbox: [number, number, number, number] | null, minDiamKm: number) {
  return useQuery({
    queryKey: ['craters', bbox, minDiamKm],
    queryFn: ({ signal }) => api.craters(bbox!, minDiamKm, signal),
    enabled: !!bbox,
    retry,
    staleTime: Infinity,
  })
}
