import { describe, expect, it } from 'vitest'
import { ALL_FILTERS, FUNNEL_LABEL, buildFilters } from './missionFilters'

describe('mission filters', () => {
  it('send only what is switched on and typed, in the API fields', () => {
    const r = buildFilters(
      { max_slope_deg: true, elevation: true, side: true, min_long_term_sun: false },
      { max_slope_deg: { max_slope_deg: '8,5' }, elevation: { max_elevation_m: '-1200' }, side: { side: 'near' }, min_long_term_sun: { min_long_term_sun: '0.4' } },
    )
    expect(r).toEqual({ filters: { max_slope_deg: 8.5, max_elevation_m: -1200, side: 'near' }, window: false })
  })

  it('a switch without numbers is an error, never a default', () => {
    expect(buildFilters({ max_slope_deg: true }, {})).toBe('Maximum slope: steepest slope is required')
    expect(buildFilters({ elevation: true }, {})).toBe('Elevation range: fill at least one value')
    expect(buildFilters({ min_sunlit_fraction: true }, { min_sunlit_fraction: { min_sunlit_fraction: '1.5' } })).toMatch(/between 0 and 1/)
  })

  it('flags and window filters are marked for the request', () => {
    expect(buildFilters({ earth_visible_at_landing: true }, {})).toEqual({ filters: { earth_visible_at_landing: true }, window: true })
  })

  it('filters the data cannot answer are never sent', () => {
    const na = ALL_FILTERS.filter((f) => f.unavailable)
    expect(na.map((f) => f.id)).toEqual(expect.arrayContaining(['rocks', 'roughness', 'link_margin', 'temperature', 'colony']))
    expect(buildFilters(Object.fromEntries(na.map((f) => [f.id, true])), {})).toEqual({ filters: {}, window: false })
  })

  it('every field the panel sends has a name in the funnel table', () => {
    const keys = ALL_FILTERS.flatMap((f) => [...f.fields.map((x) => x.key), ...(f.flag ? [f.flag.key] : [])])
    const helpers = new Set(['crater_radius_km', 'crater_min_diam_km', 'rim_min_diam_km', 'min_elevation_m', 'max_elevation_m'])
    for (const k of keys.filter((k) => !helpers.has(k))) expect(FUNNEL_LABEL[k], k).toBeTruthy()
  })
})
