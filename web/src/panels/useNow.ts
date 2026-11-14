/**
 * Sun and Earth at the active instant for the selected place, from one of two sources:
 *   - the API (GET /sites/{id}/state or /points/state) when the endpoint answers and playback is paused;
 *   - the browser engine (same tables, same masks, same method) during playback, ~10 updates per second,
 *     and whenever the endpoint is not deployed yet.
 * The panels always say which source they show.
 */
import { createContext, createElement, type ReactNode, useContext, useMemo } from 'react'
import { useApiState } from '../api/hooks'
import type { BodyState, HorizonKind, SiteState } from '../api/types'
import { useApp } from '../state/store'
import { isoMinute } from '../time/clock'
import type { BodySample } from '../time/engine'
import { type ModelInfo, type WindowSeries, useLiveState, useParams, useSiteModel, useThrottledTime, useWindowSeries } from '../time/hooks'

export interface BodyView {
  az: number
  el: number
  fraction: number
  radiusDeg: number
  distKm: number
}

export interface NowView {
  source: 'api' | 'browser'
  tMs: number
  sun: BodyView
  earth: BodyView
  eclipse: number
  irradiance: number
  power: number
  nextSun: { kind: 'set' | 'rise'; atMs: number; inMs: number } | null
  nextEarth: { kind: 'set' | 'rise'; atMs: number; inMs: number } | null
  horizonKind: HorizonKind
  mastUsedM: number
}

const fromApiBody = (b: BodyState): BodyView => ({
  az: b.az_deg,
  el: b.el_deg,
  fraction: b.visible_fraction,
  radiusDeg: b.angular_radius_deg,
  distKm: b.distance_km,
})
const fromSample = (b: BodySample): BodyView => ({ az: b.az, el: b.el, fraction: b.fraction, radiusDeg: b.radiusDeg, distKm: b.distKm })

function fromApi(s: SiteState, tMs: number, info: ModelInfo | null): NowView {
  const tr = (x: SiteState['next_sun_transition']) => (x ? { kind: x.kind, atMs: Date.parse(x.at), inMs: x.in_hours * 3_600_000 } : null)
  return {
    source: 'api',
    tMs,
    sun: fromApiBody(s.sun),
    earth: fromApiBody(s.earth),
    eclipse: s.eclipse,
    irradiance: s.irradiance_w_m2,
    power: s.power_w_m2,
    nextSun: tr(s.next_sun_transition),
    nextEarth: tr(s.next_earth_transition),
    horizonKind: s.horizon_kind,
    mastUsedM: s.mast_used_m ?? info?.mastUsedM ?? 0,
  }
}

function useNowCompute() {
  const selection = useApp((s) => s.selection)
  const mastM = useApp((s) => s.mastM)
  const playing = useApp((s) => s.playing)
  const params = useParams()
  const info = useSiteModel(selection, mastM)
  const tMs = useThrottledTime()
  const live = useLiveState(info, tMs, params)
  const apiParams = useMemo(
    () => ({ t: isoMinute(tMs), mast_m: mastM, panel: params.panel, comms_min_fraction: params.commsMinFraction }),
    [tMs, mastM, params],
  )
  const api = useApiState(selection, apiParams, !playing)

  const view: NowView | null = useMemo(() => {
    if (!playing && api.data) return fromApi(api.data, tMs, info)
    if (!live || live === 'out-of-range' || !info) return null
    return {
      source: 'browser',
      tMs,
      sun: fromSample(live.sample.sun),
      earth: fromSample(live.sample.earth),
      eclipse: live.sample.eclipse,
      irradiance: live.sample.irradiance,
      power: live.sample.power,
      nextSun: live.nextSun,
      nextEarth: live.nextEarth,
      horizonKind: info.model.horizon.kind,
      mastUsedM: info.mastUsedM,
    }
  }, [playing, api.data, live, info, tMs])

  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const series = useWindowSeries(info, startMs, durationH, params)

  return { view, info, series, outOfRange: live === 'out-of-range', apiError: api.error, apiLoading: api.isFetching }
}

export interface NowContextValue {
  view: NowView | null
  info: ModelInfo | null
  /** Browser-engine series over the analysis window (shared by the timeline, power and link panels). */
  series: WindowSeries | null
  outOfRange: boolean
  apiError: unknown
  apiLoading: boolean
}

const NowContext = createContext<NowContextValue | null>(null)

/** Computes the state of the selected place once for every panel below it. */
export function NowProvider({ children }: { children: ReactNode }) {
  return createElement(NowContext.Provider, { value: useNowCompute() }, children)
}

export function useNow(): NowContextValue {
  const v = useContext(NowContext)
  if (!v) throw new Error('useNow must be used inside <NowProvider>')
  return v
}
