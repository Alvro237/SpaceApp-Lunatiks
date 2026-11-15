import { describe, expect, it } from 'vitest'
import { buildLinkRequest } from './linkRequest'
import { buildPowerRequest, stepFor } from './powerRequest'
import { EXAMPLE } from './powerSpecs'

const window = { startMs: Date.UTC(2027, 0, 1), durationH: 720, mastM: 2 }
const power = { model: 'battery' as const, fields: EXAMPLE, commsCritical: false, includeSizing: true, panel: 'vertical' as const, ...window }
const link = {
  level: 1 as const,
  networks: ['dsn' as const],
  direction: 'downlink' as const,
  band: 'X' as const,
  budget: {},
  commsMinFraction: 0.5,
  ...window,
}

describe('buildPowerRequest', () => {
  it('sends a catalogue site by id and the battery level with the typed numbers', () => {
    const r = buildPowerRequest(power, { kind: 'site', id: 'shackleton_rim' })
    expect(r.site_id).toBe('shackleton_rim')
    expect(r.level).toBe(3)
    expect(r.start).toBe('2027-01-01T00:00:00Z')
    expect(r.load_w).toBe(60)
    expect(r.battery_capacity_wh).toBe(3000)
    expect(r.step_min).toBe(stepFor(720))
  })

  it('traces the terrain for manual coordinates', () => {
    const r = buildPowerRequest(power, { kind: 'point', lat: -89.5, lon: 10 })
    expect(r).toMatchObject({ lat: -89.5, lon: 10, horizon: 'terrain' })
    expect(r.site_id).toBeUndefined()
  })

  it('names the first missing required field and invents no default', () => {
    expect(() => buildPowerRequest({ ...power, fields: { ...EXAMPLE, load_w: '' } }, null)).toThrow('Load is required')
    expect(() => buildPowerRequest({ ...power, fields: { ...EXAMPLE, derating: 'abc' } }, null)).toThrow('Degradation must be a number')
  })

  it('refuses a colony window shorter than a synodic month', () => {
    expect(() => buildPowerRequest({ ...power, model: 'colony', durationH: 100 }, null)).toThrow('at least 30 days')
  })

  it('sends colony temperatures in kelvin: 20 C is 293.15 K', () => {
    const fields = {
      ...EXAMPLE,
      critical_load_w: '1', deferrable_load_w: '1', comms_load_w: '1', shed_soc: '0.3', max_charge_w: '1', max_discharge_w: '1',
      crew_count: '2', t_set_c: '20', t_min_c: '10', ua_w_k: '5', hab_area_m2: '50', skin_absorptivity: '0.3', skin_emissivity: '0.8',
      structure_mass_kg: '1000', structure_specific_heat_j_kgk: '900', air_volume_m3: '30', air_pressure_pa: '101325',
    }
    const r = buildPowerRequest({ ...power, model: 'colony', fields, durationH: 720 }, null)
    expect(r.level).toBe(4)
    expect(r.habitat?.t_set_k).toBeCloseTo(293.15, 9)
    expect(r.habitat?.t_min_k).toBeCloseTo(283.15, 9)
    expect(r.habitat?.metabolic_w_per_crew).toBeUndefined()
  })
})

describe('buildLinkRequest', () => {
  it('level 1 sends the networks, direction and the contact threshold, and no budget', () => {
    const r = buildLinkRequest({ ...link, commsMinFraction: 0.8 }, { kind: 'site', id: 'malapert' })
    expect(r).toMatchObject({ site_id: 'malapert', level: 1, networks: ['dsn'], direction: 'downlink', comms_min_fraction: 0.8 })
    expect(r.budget).toBeUndefined()
  })

  it('needs an antenna network', () => {
    expect(() => buildLinkRequest({ ...link, networks: [] }, null)).toThrow('at least one antenna network')
  })

  it('level 2 needs EIRP and data rate, and leaves empty optional values to the API defaults', () => {
    expect(() => buildLinkRequest({ ...link, level: 2 }, null)).toThrow('Transmit power (EIRP) is required')
    const r = buildLinkRequest({ ...link, level: 2, budget: { transmit_eirp_dbw: '10', data_rate_bps: '1e6', min_margin_db: '4' } }, null)
    expect(r.budget).toEqual({ band: 'X', transmit_eirp_dbw: 10, data_rate_bps: 1e6, min_margin_db: 4 })
  })

  it('an uplink needs the lunar terminal G/T', () => {
    const budget = { transmit_eirp_dbw: '60', data_rate_bps: '1000' }
    expect(() => buildLinkRequest({ ...link, level: 2, direction: 'uplink_low_power', budget }, null)).toThrow('receiver G/T')
    const r = buildLinkRequest({ ...link, level: 2, direction: 'uplink_low_power', budget: { ...budget, receive_gt_db_per_k: '-30' } }, null)
    expect(r.budget?.receive_gt_db_per_k).toBe(-30)
  })
})
