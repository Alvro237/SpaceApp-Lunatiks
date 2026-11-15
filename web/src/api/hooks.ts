/** TanStack Query hooks over the API client. Catalogue and metadata are cached for the session. */
import { useMutation, useQuery } from '@tanstack/react-query'
import { type SeriesParams, type StateParams, api, isMissing } from './client'
import type { AreaSearchRequest, CandidateSearchRequest, PowerRequest, RadiationRequest } from './types'
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

/** Ray-traced skyline at coordinates — a manual point, or a catalogue site without a stored mask (pass null
 * when the place needs no trace). One call per place and mast; kept for the session. */
export function usePointHorizon(coords: { lat: number; lon: number } | null, mastM: number) {
  return useQuery({
    queryKey: ['point-horizon', coords?.lat ?? null, coords?.lon ?? null, mastM],
    queryFn: ({ signal }) => (coords ? api.pointHorizon(coords.lat, coords.lon, mastM, signal) : Promise.reject(new Error('no coordinates to trace'))),
    enabled: coords !== null,
    retry,
    staleTime: Infinity,
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
/** Mission mode: paint a region (seconds when window filters trace horizons; repeated asks come from the API's cache). */
export const useAreaSearch = () => useMutation({ mutationFn: (body: AreaSearchRequest) => api.areaSearch(body) })
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
