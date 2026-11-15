import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAreas } from '../state/areas'
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

const AREA_ANSWER = {
  grid: { projection: 'south polar stereographic', x_left_m: 0, y_top_m: 1000, cell_m: 960, nx: 1, ny: 1 },
  codes_b64: btoa(String.fromCharCode(3)),
  score_b64: btoa(String.fromCharCode(200)),
  counts: { outside: 0, failed_static: 0, failed_window: 0, viable: 1, unknown: 0 },
  funnel: [],
  areas: [],
  window: { samples: 60, finest_tile_km: 1, coarsest_tile_km: 1, horizon_az_step_deg: 0.5, horizon_radius_km: 150 },
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
    expect((calls[0].body.filters as Record<string, unknown>).max_dark_h).toBe(48)
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
    calls[0].resolve(new Response(JSON.stringify(AREA_ANSWER), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await act(async () => {
      result.current.simulate()
    })
    expect(calls).toHaveLength(2)
    expect(calls[1].body.max_window_samples).toBe(FULL_SAMPLES)
  })
})
