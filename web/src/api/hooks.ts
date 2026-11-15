/** TanStack Query hooks over the API client. Catalogue and metadata are cached for the session. */
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { type SeriesParams, type StateParams, api, isMissing } from './client'
import type { AreaSearchRequest, CandidateSearchRequest, LinkRequest, PowerRequest, RadiationRequest } from './types'
import type { Selection } from '../state/store'

const forever = { staleTime: Infinity, gcTime: Infinity }
/** Do not retry a route that does not exist; retry network errors once. */
const retry = (count: number, e: unknown) => !isMissing(e) && count < 1

export const useSites = () => useQuery({ queryKey: ['sites'], queryFn: ({ signal }) => api.sites(signal), ...forever, retry })
export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: ({ signal }) => api.health(signal), retry })
export const useDatasets = () => useQuery({ queryKey: ['datasets'], queryFn: ({ signal }) => api.datasets(signal), ...forever, retry })
export const useConstraints = () =>
  useQuery({ queryKey: ['constraints'], queryFn: ({ signal }) => api.constraints(signal), ...forever, retry })

/** Sun and Earth now at the place; nothing is asked for while no place is chosen. */
export function useApiState(sel: Selection | null, p: StateParams, enabled: boolean) {
  return useQuery({
    queryKey: ['state', sel, p],
    queryFn: ({ signal }) => (sel!.kind === 'site' ? api.siteState(sel!.id, p, signal) : api.pointState(sel!.lat, sel!.lon, p, signal)),
    enabled: enabled && !!sel,
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

/** Series over the window at the place; nothing is asked for while no place is chosen. */
export function useApiSeries(sel: Selection | null, p: SeriesParams, enabled: boolean) {
  return useQuery({
    queryKey: ['series', sel, p],
    queryFn: ({ signal }) => (sel!.kind === 'site' ? api.siteSeries(sel!.id, p, signal) : api.pointSeries(sel!.lat, sel!.lon, p, signal)),
    enabled: enabled && !!sel,
    retry,
    staleTime: 60_000,
  })
}

export const useCandidateSearch = () => useMutation({ mutationFn: (body: CandidateSearchRequest) => api.searchCandidates(body) })
/** Mission mode: paint a region (seconds when window filters trace horizons; repeated asks come from the API's cache). */
export const useAreaSearch = () => useMutation({ mutationFn: (body: AreaSearchRequest) => api.areaSearch(body) })
export const usePower = () => useMutation({ mutationFn: (body: PowerRequest) => api.power(body) })

/** Networks and antennas of the radio link (AERO-2), fixed data: asked once. */
export const useLinkStations = () => useQuery({ queryKey: ['link-stations'], queryFn: ({ signal }) => api.linkStations(signal), ...forever, retry })

/** Radio link over the window; nothing is asked for while the request is incomplete (null). */
export function useLink(body: LinkRequest | null) {
  return useQuery({
    queryKey: ['link', body],
    queryFn: ({ signal }) => api.link(body!, signal),
    enabled: !!body,
    retry,
    staleTime: 60_000,
    // keep the last answer on screen while the next one is computed, so the panel and the timeline do not blink
    placeholderData: keepPreviousData,
  })
}

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
