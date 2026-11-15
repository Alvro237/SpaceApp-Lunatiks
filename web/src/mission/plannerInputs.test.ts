import { describe, expect, it } from 'vitest'
import {
  BATTERY_PARAMS,
  CELL_OPTIONS_KM,
  PLANNER_CATEGORIES,
  autoCellKm,
  buildSuitability,
  cellTooMany,
  cellsSide,
  commsMinFractionOf,
  maxRadiusForCell,
} from './plannerInputs'

/** buildSuitability with only what a case needs. */
const build = (
  on: Record<string, boolean>,
  values: Record<string, string> = {},
  opts: { side?: boolean; switches?: Record<string, boolean>; selects?: Record<string, string> } = {},
) => buildSuitability(on, opts.side ?? false, opts.switches ?? {}, opts.selects ?? {}, values)

const ok = (r: ReturnType<typeof build>) => {
  if (typeof r === 'string') throw new Error(r)
  return r
}

describe('planner inputs: build the /suitability/search request', () => {
  it('sends nothing with every category off', () => {
    expect(build({})).toEqual({ categories: [], criteria: [], window: false, scored: [] })
  })

  it('a category on with every input empty is sent with no criterion (it still scores: Power, Earth)', () => {
    const r = ok(build({ power: true }))
    expect(r.categories).toEqual(['power'])
    expect(r.criteria).toEqual([])
    expect(r.scored).toEqual(['power'])
    expect(r.window).toBe(true)
  })

  it('an input of a category switched off is not sent', () => {
    expect(ok(build({}, { battery_autonomy: '48', max_slope: '8' })).criteria).toEqual([])
  })

  it('every number input maps to its criterion with `limit`', () => {
    const r = ok(
      build(
        { power: true, earth: true, topography: true, science: true, radiation: true },
        {
          battery_autonomy: '48',
          recharge_time: '12',
          max_blackout: '24',
          max_slope: '10',
          crater_cover: '20',
          rim_margin: '1,5',
          near_psr: '5',
          hydrogen: '100',
          max_dose: '30',
        },
      ),
    )
    expect(r.criteria).toEqual([
      { id: 'battery_autonomy_h', limit: 48 },
      { id: 'recharge_h', limit: 12 },
      { id: 'blackout_h', limit: 24 },
      { id: 'max_slope_deg', limit: 10 },
      { id: 'crater_cover_pct', limit: 20 },
      { id: 'rim_margin_radii', limit: 1.5 },
      { id: 'psr_distance_km', limit: 5 },
      { id: 'hydrogen_ppm', limit: 100 },
      { id: 'dose_mgy', limit: 30 },
    ])
    expect(r.scored).toEqual(['power', 'earth', 'topography', 'science', 'radiation'])
  })

  it('switches send flag criteria; the side switch adds the "search" category and the side choice', () => {
    const r = ok(build({ power: true, landing: true }, {}, { side: true, switches: { avoid_psr: true, earth_at_landing: true }, selects: { side_dir: 'far' } }))
    expect(r.categories).toEqual(['search', 'power', 'landing'])
    expect(r.criteria).toEqual([{ id: 'side', choice: 'far' }, { id: 'avoid_psr' }, { id: 'earth_at_landing' }])
    expect(ok(build({}, {}, { side: false, selects: { side_dir: 'far' } })).categories).toEqual([])
  })

  it('Sun height at landing is one range criterion with min, max or both', () => {
    expect(ok(build({ landing: true }, { 'sun_el_at_landing:lo': '5' })).criteria).toEqual([{ id: 'sun_el_at_landing_deg', min: 5 }])
    expect(ok(build({ landing: true }, { 'sun_el_at_landing:lo': '-2', 'sun_el_at_landing:hi': '12' })).criteria).toEqual([
      { id: 'sun_el_at_landing_deg', min: -2, max: 12 },
    ])
    expect(build({ landing: true }, { 'sun_el_at_landing:lo': '10', 'sun_el_at_landing:hi': '5' })).toMatch(/highest value must not be below the lowest/)
  })

  it('request-level inputs: landing ellipse radius, robust delay; Earth disc in percent becomes a fraction', () => {
    const r = ok(build({ topography: true, schedule: true }, { landing_radius: '0.5', robust_delay: '24' }))
    expect(r.criteria).toEqual([])
    expect(r.landing_radius_km).toBe(0.5)
    expect(r.robust_delay_h).toBe(24)
    expect(r.window).toBe(true)
    // only while their category is on
    expect(ok(build({}, { landing_radius: '0.5', robust_delay: '24' })).landing_radius_km).toBeUndefined()
    expect(build({ topography: true }, { landing_radius: '0' })).toMatch(/more than 0/)
    expect(commsMinFractionOf({})).toBeCloseTo(0.5, 9)
    expect(commsMinFractionOf({ comms_fraction: '80' })).toBeCloseTo(0.8, 9)
    expect(build({ earth: true }, { comms_fraction: '150' })).toMatch(/Earth disc needed for contact/)
  })

  it('Past landings: "Stay away from" and "Go near" send the choice and the distance', () => {
    expect(ok(build({ science: true }, { 'past_landings:km': '10' }, { selects: { past_landings: 'away' } })).criteria).toEqual([
      { id: 'past_landings', choice: 'away', limit: 10 },
    ])
    const near = ok(build({ science: true }, { 'past_landings:km': '25' }, { selects: { past_landings: 'near' } }))
    expect(near.criteria).toEqual([{ id: 'past_landings', choice: 'near', limit: 25 }])
    expect(near.scored).toEqual(['science']) // "go near" is a distance target: it scores
  })

  it('Near a named feature sends the exact name in params; a distance without a name is an error', () => {
    expect(ok(build({ science: true }, { 'near_feature:name': 'Shackleton', 'near_feature:km': '30' })).criteria).toEqual([
      { id: 'target_distance_km', limit: 30, params: { feature: 'Shackleton' } },
    ])
    expect(build({ science: true }, { 'near_feature:km': '30' })).toMatch(/choose a feature name/)
    expect(ok(build({ science: true }, { 'near_feature:name': 'Shackleton' })).criteria).toEqual([])
  })

  const BATTERY: Record<string, string> = {
    'battery_model:panel_area_m2': '2',
    'battery_model:cell_efficiency': '0.3',
    'battery_model:derating': '0.85',
    'battery_model:battery_capacity_wh': '2000',
    'battery_model:battery_initial_soc': '100',
    'battery_model:battery_min_soc': '20',
    'battery_model:load_w': '50',
    'battery_model:charge_efficiency': '0.95',
    'battery_model:discharge_efficiency': '0.95',
  }

  it('the detailed battery model sends its params (state of charge from % to 0-1) and replaces autonomy and recharge', () => {
    const values = { ...BATTERY, battery_autonomy: '48', recharge_time: '10' }
    const r = ok(build({ power: true }, values, { switches: { battery_model: true } }))
    expect(r.criteria).toEqual([
      {
        id: 'battery_model',
        params: {
          panel_area_m2: 2,
          cell_efficiency: 0.3,
          derating: 0.85,
          battery_capacity_wh: 2000,
          battery_initial_soc: 1,
          battery_min_soc: 0.2,
          load_w: 50,
          charge_efficiency: 0.95,
          discharge_efficiency: 0.95,
        },
      },
    ])
    expect(r.criteria.some((c) => c.id === 'battery_autonomy_h' || c.id === 'recharge_h')).toBe(false)
    // the optional night load is sent when typed
    const night = ok(build({ power: true }, { ...BATTERY, 'battery_model:night_load_w': '80' }, { switches: { battery_model: true } }))
    expect(night.criteria[0].params?.night_load_w).toBe(80)
    // switched off: autonomy and recharge are back
    expect(ok(build({ power: true }, values)).criteria.map((c) => c.id)).toEqual(['battery_autonomy_h', 'recharge_h'])
  })

  it('the battery model asks for every required field and checks their ranges', () => {
    const missing = { ...BATTERY }
    delete missing['battery_model:load_w']
    expect(build({ power: true }, missing, { switches: { battery_model: true } })).toMatch(/day load is needed/)
    expect(build({ power: true }, { ...BATTERY, 'battery_model:cell_efficiency': '0' }, { switches: { battery_model: true } })).toMatch(/more than 0/)
    expect(build({ power: true }, { ...BATTERY, 'battery_model:battery_min_soc': '120' }, { switches: { battery_model: true } })).toMatch(/between 0 and 100/)
    expect(BATTERY_PARAMS.filter((p) => !p.required).map((p) => p.key)).toEqual(['night_load_w'])
  })

  it('topography, science and radiation score only once a limit that measures them is set', () => {
    expect(ok(build({ topography: true, science: true, radiation: true }, { rim_margin: '1' })).scored).toEqual([])
    expect(ok(build({ topography: true }, { crater_cover: '10' })).scored).toEqual(['topography'])
    expect(ok(build({ science: true }, { 'past_landings:km': '10' }, { selects: { past_landings: 'away' } })).scored).toEqual([])
  })

  it('a number out of range is an error', () => {
    expect(build({ topography: true }, { max_slope: '120' })).toMatch(/between 0 and 90/)
    expect(build({ topography: true }, { rim_margin: '6' })).toMatch(/between 0 and 5/)
  })

  it('no input is left without a mapping: only data-gap rows are inactive', () => {
    const kinds = PLANNER_CATEGORIES.flatMap((c) => c.fields.map((f) => f.kind))
    expect(kinds).not.toContain('stage-b')
    const gaps = PLANNER_CATEGORIES.flatMap((c) => c.fields.filter((f) => f.kind === 'unavailable').map((f) => f.id))
    expect(gaps).toEqual(['roughness', 'rocks', 'thermal', 'solar_storms'])
    expect(PLANNER_CATEGORIES.map((c) => c.id)).toEqual(['search', 'power', 'earth', 'topography', 'landing', 'science', 'radiation', 'schedule'])
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
