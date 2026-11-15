import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAreas } from '../state/areas'
import { useLinkStore } from '../state/link'
import { defaultScene, useApp } from '../state/store'
import { FULL_SAMPLES, PREVIEW_SAMPLES, usePlannerSearch } from './usePlannerSearch'

function pendingFetch() {
  const calls: { body: Record<string, unknown>; signal: AbortSignal; resolve: (v: unknown) => void }[] = []
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    return new Promise((resolve) => {
      calls.push({ body: JSON.parse(String(init?.body)), signal: init!.signal as AbortSignal, resolve })
    })
  })
  return { calls, fetchMock }
}

const ANSWER = {
  grid: { projection: 'south polar stereographic', x_left_m: 0, y_top_m: 1000, cell_m: 960, nx: 1, ny: 1 },
  codes_b64: btoa(String.fromCharCode(3)),
  score_b64: btoa(String.fromCharCode(200)),
  limiting_b64: btoa(String.fromCharCode(0)),
  layers: [{ category: 'power', label: 'Power and sunlight', measure: 'share sunlit', weight: 1, utility_b64: btoa(String.fromCharCode(196)) }],
  weights: { power: 1 },
  counts: { outside: 0, failed_static: 0, failed_window: 0, viable: 1, unknown: 0, failed_bound: 0 },
  funnel: [],
  bound: null,
  window: { samples: 60, finest_tile_km: 1, coarsest_tile_km: 1, horizon_az_step_deg: 0.5, horizon_radius_km: 150 },
  sites: [],
  sites_dropped: 0,
  seconds: 0.4,
  assumptions: [],
}

beforeEach(() => {
  vi.useFakeTimers()
  useApp.setState(defaultScene())
  useAreas.setState({
    center: { lat: -84.79, lon: 29.2 },
    radiusKm: 20,
    cellMode: 'auto',
    landingRadiusKm: '',
    categoriesOn: { power: true },
    sideOn: false,
    plannerSwitches: {},
    plannerSelects: {},
    plannerValues: { battery_autonomy: '10' },
    result: null,
    suit: null,
    suitRequest: null,
    suitLayers: [],
    priority: [],
    weights: {},
    rerankSeq: 0,
    raster: null,
    isPreview: false,
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('usePlannerSearch', () => {
  it('a burst of changes sends one preview 500 ms after the last one', async () => {
    const { calls, fetchMock } = pendingFetch()
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => usePlannerSearch())
    act(() => {
      useAreas.getState().setPlannerValue('battery_autonomy', '20')
      vi.advanceTimersByTime(200)
      useAreas.getState().setPlannerValue('battery_autonomy', '30')
      vi.advanceTimersByTime(200)
      useAreas.getState().setPlannerValue('battery_autonomy', '48')
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].body.max_window_samples).toBe(PREVIEW_SAMPLES)
    expect(calls[0].body.categories).toEqual(['power'])
    expect(calls[0].body.criteria).toEqual([{ id: 'battery_autonomy_h', limit: 48 }])
    expect(calls[0].body.priority).toEqual(['power'])
    // no Earth category: no radio link settings, and the share of the Earth's disc is no longer sent at all
    expect(calls[0].body.comms_min_fraction).toBeUndefined()
    expect(calls[0].body.link).toBeUndefined()
    expect(calls[0].body.top_k).toBe(10)
    expect(calls[0].body.region).toEqual({ center_lat: -84.79, center_lon: 29.2, radius_km: 20 })
  })

  it('posts to /api/v1/suitability/search and stores the answer, the request with it', async () => {
    const { calls, fetchMock } = pendingFetch()
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => usePlannerSearch())
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/v1\/suitability\/search$/)
    calls[0].resolve(new Response(JSON.stringify(ANSWER), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await act(async () => {
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(useAreas.getState().suit).not.toBeNull())
    expect(useAreas.getState().isPreview).toBe(true)
    expect(useAreas.getState().raster?.score[0]).toBe(Math.floor((196 / 250) * 255 + 0.5))
    expect(useAreas.getState().suitRequest?.max_window_samples).toBe(PREVIEW_SAMPLES)
  })

  it('Earth contact sends the radio link settings (networks, direction, own antennas) instead of a disc share', async () => {
    const { calls, fetchMock } = pendingFetch()
    vi.stubGlobal('fetch', fetchMock)
    useLinkStore.setState({ networks: ['dsn', 'jaxa'], direction: 'uplink_low_power', custom: [] })
    useAreas.setState({ categoriesOn: { earth: true }, plannerValues: { link_min_daily: '4' } })
    renderHook(() => usePlannerSearch())
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].body.link).toEqual({ networks: ['dsn', 'jaxa'], custom_stations: [], direction: 'uplink_low_power' })
    expect(calls[0].body.criteria).toEqual([{ id: 'link_min_daily_h', limit: 4 }])
    expect(calls[0].body.comms_min_fraction).toBeUndefined()
    useLinkStore.setState({ networks: ['dsn', 'estrack', 'jaxa'], direction: 'downlink', custom: [] })
  })

  it('an own antenna left half-filled blocks the search and says so', () => {
    const { calls, fetchMock } = pendingFetch()
    vi.stubGlobal('fetch', fetchMock)
    useLinkStore.setState({ custom: [{ key: 1, lat: '40', lon: '', height: '', minEl: '', diameter: '', gt: '' }] })
    useAreas.setState({ categoriesOn: { earth: true } })
    const { result } = renderHook(() => usePlannerSearch())
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(calls).toHaveLength(0)
    expect(result.current.error).toMatch(/Antenna 1/)
    useLinkStore.setState({ custom: [] })
  })

  it('reordering the priorities sends no request; the next request carries the order', async () => {
    const { calls, fetchMock } = pendingFetch()
    vi.stubGlobal('fetch', fetchMock)
    useAreas.setState({ categoriesOn: { power: true, earth: true } })
    renderHook(() => usePlannerSearch())
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].body.priority).toEqual(['power', 'earth'])
    act(() => {
      useAreas.getState().setPriority(['earth', 'power'])
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(calls).toHaveLength(1)
    act(() => {
      useAreas.getState().setPlannerValue('battery_autonomy', '24')
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(calls).toHaveLength(2)
    expect(calls[1].body.priority).toEqual(['earth', 'power'])
  })

  it('an invalid input sends nothing and is reported', () => {
    const { calls, fetchMock } = pendingFetch()
    vi.stubGlobal('fetch', fetchMock)
    useAreas.setState({ plannerValues: { battery_autonomy: 'abc' } })
    const { result } = renderHook(() => usePlannerSearch())
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(calls).toHaveLength(0)
    expect(result.current.error).toMatch(/Battery autonomy: must be a number/)
  })

  it('a newer change aborts the request in flight', async () => {
    const { calls, fetchMock } = pendingFetch()
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => usePlannerSearch())
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].signal.aborted).toBe(false)
    act(() => {
      useAreas.getState().setPlannerValue('battery_autonomy', '60')
    })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(calls).toHaveLength(2)
    expect(calls[0].signal.aborted).toBe(true)
  })

  it('Simulate sends max_window_samples: 300', async () => {
    const { calls, fetchMock } = pendingFetch()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => usePlannerSearch())
    act(() => {
      vi.advanceTimersByTime(500)
    })
    calls[0].resolve(new Response(JSON.stringify(ANSWER), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await act(async () => {
      result.current.simulate()
    })
    expect(calls).toHaveLength(2)
    expect(calls[1].body.max_window_samples).toBe(FULL_SAMPLES)
  })
})
