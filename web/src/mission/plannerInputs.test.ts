import { describe, expect, it } from 'vitest'
import {
  CELL_OPTIONS_KM,
  PLANNER_CATEGORIES,
  autoCellKm,
  buildPlannerFilters,
  cellTooMany,
  cellsSide,
  commsMinFractionOf,
  maxRadiusForCell,
} from './plannerInputs'

describe('planner inputs: build the /areas/search filters', () => {
  it('sends nothing with every category off', () => {
    expect(buildPlannerFilters({}, false, {}, {}, {})).toEqual({ filters: {}, window: false })
  })

  it('an input left empty in an on category is inactive: not sent', () => {
    const r = buildPlannerFilters({ power: true }, false, {}, {}, {})
    expect(r).toEqual({ filters: {}, window: false })
  })

  it('a filled number in an on category is sent under its API field, and marks the window', () => {
    const r = buildPlannerFilters({ power: true }, false, {}, {}, { battery_autonomy: '48' })
    expect(r).toEqual({ filters: { max_dark_h: 48 }, window: true })
  })

  it('"Avoid permanently shadowed ground" sends max_permanent_shadow: 0', () => {
    const r = buildPlannerFilters({ power: true }, false, { avoid_psr: true }, {}, {})
    expect(r).toEqual({ filters: { max_permanent_shadow: 0 }, window: false })
  })

  it('"Near or far side" is off by default and sent only when switched on', () => {
    expect(buildPlannerFilters({}, false, {}, { side_dir: 'near' }, {})).toEqual({ filters: {}, window: false })
    expect(buildPlannerFilters({}, true, {}, { side_dir: 'far' }, {})).toEqual({ filters: { side: 'far' }, window: false })
  })

  it('"Earth disc needed for contact" is a request-level parameter, not a filter', () => {
    const r = buildPlannerFilters({ earth: true }, false, {}, {}, { comms_fraction: '50', max_blackout: '10' })
    expect(r).toEqual({ filters: { max_blackout_h: 10 }, window: true })
    // the team's default (section 1 of the spec), read whether or not the category is on
    expect(commsMinFractionOf({})).toBeCloseTo(0.5, 9)
    expect(commsMinFractionOf({ comms_fraction: '50' })).toBeCloseTo(0.5, 9)
    expect(commsMinFractionOf({ comms_fraction: '80' })).toBeCloseTo(0.8, 9)
  })

  it('Sun height at landing fills one or both ends, both mark the window', () => {
    const r = buildPlannerFilters({ landing: true }, false, {}, {}, { 'sun_el_at_landing:lo': '5' })
    expect(r).toEqual({ filters: { min_sun_el_at_landing_deg: 5 }, window: true })
    const both = buildPlannerFilters({ landing: true }, false, {}, {}, { 'sun_el_at_landing:lo': '-2', 'sun_el_at_landing:hi': '12' })
    expect(both).toEqual({ filters: { min_sun_el_at_landing_deg: -2, max_sun_el_at_landing_deg: 12 }, window: true })
  })

  it('Sun height at landing refuses a highest value below the lowest one', () => {
    const r = buildPlannerFilters({ landing: true }, false, {}, {}, { 'sun_el_at_landing:lo': '10', 'sun_el_at_landing:hi': '5' })
    expect(typeof r).toBe('string')
    expect(r).toMatch(/highest value must not be below the lowest/)
  })

  it('Earth in view at landing sends the flag only when on', () => {
    const r = buildPlannerFilters({ landing: true }, false, { earth_at_landing: true }, {}, {})
    expect(r).toEqual({ filters: { earth_visible_at_landing: true }, window: true })
  })

  it('Past landings: "stay away" sends away_from_landings_km; "go near" is Stage B (nothing sent)', () => {
    const away = buildPlannerFilters({ science: true }, false, {}, { past_landings: 'away' }, { 'past_landings:km': '10' })
    expect(away).toEqual({ filters: { away_from_landings_km: 10 }, window: false })
    const near = buildPlannerFilters({ science: true }, false, {}, { past_landings: 'near' }, { 'past_landings:km': '10' })
    expect(near).toEqual({ filters: {}, window: false })
  })

  it('a number out of range is an error', () => {
    expect(buildPlannerFilters({ topography: true }, false, {}, {}, { max_slope: '120' })).toMatch(/between 0 and 90/)
  })

  it('every Stage A field of section 4.2 maps to a field in its category (stage-b and unavailable rows never build a filter)', () => {
    const stageAIds = PLANNER_CATEGORIES.flatMap((c) => c.fields.filter((f) => f.kind !== 'stage-b' && f.kind !== 'unavailable' && f.kind !== 'sub-switch').map((f) => f.id))
    expect(stageAIds).toEqual(
      expect.arrayContaining(['side', 'battery_autonomy', 'avoid_psr', 'max_blackout', 'comms_fraction', 'max_slope', 'landing_radius', 'sun_el_at_landing', 'earth_at_landing', 'near_psr', 'hydrogen', 'past_landings', 'max_dose', 'robust_delay']),
    )
  })
})

describe('cell size and radius (section 3.2)', () => {
  it('Auto picks the smallest cell within the 40 000-cell budget', () => {
    expect(autoCellKm(20)).toBe(0.24)
    expect(cellsSide(20, 0.24)).toBe(167)
    expect(167 * 167).toBe(27_889)
    expect(autoCellKm(100)).toBe(1.92)
    expect(cellsSide(100, 0.96) ** 2).toBeGreaterThan(40_000)
    expect(cellsSide(100, 1.92)).toBe(105)
  })

  it('an option above the API limit (360 000 cells) is too many', () => {
    expect(cellTooMany(100, CELL_OPTIONS_KM[0])).toBe(true)
    expect(cellTooMany(20, 0.24)).toBe(false)
  })

  it('the radius slider maximum follows the chosen cell', () => {
    expect(maxRadiusForCell(0.96)).toBe(100)
    expect(maxRadiusForCell(0.24)).toBeLessThan(maxRadiusForCell(0.96))
  })
})
