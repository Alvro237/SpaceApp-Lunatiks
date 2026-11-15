/**
 * HTTP client of the FastAPI backend. Same origin by default (the Vite dev proxy forwards /api and /health);
 * set VITE_API_URL for a deployed API.
 *
 * Endpoints that are still being built answer 404 with FastAPI's generic body {"detail": "Not Found"}. That is
 * reported as `EndpointMissing`, distinct from a 404 for an unknown id, so the views can say "not deployed yet"
 * and fall back to the browser engine where the plan allows it.
 */
import type {
  AreaSearchRequest,
  AreaSearchResponse,
  CandidateSearchRequest,
  CandidateSearchResponse,
  ConstraintsMeta,
  CraterList,
  DatasetsMeta,
  Health,
  LinkRequest,
  LinkResponse,
  PowerRequest,
  PointHorizon,
  PowerResponse,
  RadiationRequest,
  RadiationResponse,
  SiteDetail,
  SiteList,
  SiteSeries,
  SiteState,
} from './types'

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number | null
  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** The route does not exist on this server yet. */
export class EndpointMissing extends ApiError {
  constructor(path: string) {
    super(`${path} is not deployed on this API yet`, 404)
    this.name = 'EndpointMissing'
  }
}

export const isMissing = (e: unknown): e is EndpointMissing => e instanceof EndpointMissing

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError('The API did not answer', null)
  }
  if (res.ok) return (await res.json()) as T
  let detail: unknown = res.statusText
  try {
    detail = (await res.json())?.detail ?? detail
  } catch {
    /* not JSON */
  }
  if (res.status === 404 && detail === 'Not Found') throw new EndpointMissing(path.split('?')[0])
  if (res.status === 405) throw new EndpointMissing(path.split('?')[0])
  const message = Array.isArray(detail)
    ? detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg}`).join('; ')
    : String(detail)
  throw new ApiError(message, res.status)
}

const q = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString()

/** SW-1 query parameters. No `panel`: the panel orientation only matters to POST /power (MECH). */
export interface StateParams {
  t: string
  mast_m: number
  comms_min_fraction: number
}

export interface SeriesParams {
  start: string
  duration_h: number
  step_min: number
  mast_m: number
  comms_min_fraction: number
}

export const api = {
  health: (signal?: AbortSignal) => request<Health>('GET', '/health', undefined, signal),
  sites: (signal?: AbortSignal) => request<SiteList>('GET', '/api/v1/sites', undefined, signal),
  site: (id: string, signal?: AbortSignal) => request<SiteDetail>('GET', `/api/v1/sites/${encodeURIComponent(id)}`, undefined, signal),
  datasets: (signal?: AbortSignal) => request<DatasetsMeta>('GET', '/api/v1/meta/datasets', undefined, signal),
  constraints: (signal?: AbortSignal) => request<ConstraintsMeta>('GET', '/api/v1/meta/constraints', undefined, signal),

  siteState: (id: string, p: StateParams, signal?: AbortSignal) =>
    request<SiteState>('GET', `/api/v1/sites/${encodeURIComponent(id)}/state?${q({ ...p })}`, undefined, signal),
  // Manual coordinates ask for the skyline ray-traced over LOLA terrain, the same one the browser engine uses.
  pointHorizon: (lat: number, lon: number, mast_m: number, signal?: AbortSignal) =>
    request<PointHorizon>('GET', `/api/v1/points/horizon?${q({ lat, lon, mast_m })}`, undefined, signal),
  pointState: (lat: number, lon: number, p: StateParams, signal?: AbortSignal) =>
    request<SiteState>('GET', `/api/v1/points/state?${q({ lat, lon, ...p, horizon: 'terrain' })}`, undefined, signal),
  siteSeries: (id: string, p: SeriesParams, signal?: AbortSignal) =>
    request<SiteSeries>('GET', `/api/v1/sites/${encodeURIComponent(id)}/series?${q({ ...p })}`, undefined, signal),
  pointSeries: (lat: number, lon: number, p: SeriesParams, signal?: AbortSignal) =>
    request<SiteSeries>('GET', `/api/v1/points/series?${q({ lat, lon, ...p, horizon: 'terrain' })}`, undefined, signal),

  searchCandidates: (body: CandidateSearchRequest) =>
    request<CandidateSearchResponse>('POST', '/api/v1/candidates/search', body),
  areaSearch: (body: AreaSearchRequest, signal?: AbortSignal) =>
    request<AreaSearchResponse>('POST', '/api/v1/areas/search', body, signal),
  power: (body: PowerRequest, signal?: AbortSignal) => request<PowerResponse>('POST', '/api/v1/power', body, signal),
  link: (body: LinkRequest, signal?: AbortSignal) => request<LinkResponse>('POST', '/api/v1/link', body, signal),
  radiation: (body: RadiationRequest, signal?: AbortSignal) => request<RadiationResponse>('POST', '/api/v1/radiation', body, signal),
  craters: (bbox: [number, number, number, number], minDiamKm: number, signal?: AbortSignal) =>
    request<CraterList>('GET', `/api/v1/craters?${q({ bbox: bbox.join(','), min_diam_km: minDiamKm })}`, undefined, signal),
}
