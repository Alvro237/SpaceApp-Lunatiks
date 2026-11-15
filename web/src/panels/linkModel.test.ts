import { describe, expect, it } from 'vitest'
import type { LinkResponse } from '../api/types'
import { DEFAULT_FORM, type LinkForm, buildLinkRequest, buildLinkRequestWithFallback, formatRate, inRanges, linkStepMin, nextChange, noLinkReason, rankStations, summarize } from './linkModel'

const HOUR = 3_600_000
const win = { startIso: '2027-03-01T00:00', durationH: 720, commsMinFraction: 0.5 }
const site = { kind: 'site', id: 'im-2' } as const
const form = (over: Partial<LinkForm> = {}): LinkForm => ({ ...DEFAULT_FORM, ...over })

describe('buildLinkRequest', () => {
  it('waits for a place, and says nothing about it', () => {
    expect(buildLinkRequest(null, win, form())).toEqual({ body: null, problem: null })
  })

  it('builds the level 1 request with all three networks by default', () => {
    const { body, problem } = buildLinkRequest(site, win, form())
    expect(problem).toBeNull()
    expect(body).toMatchObject({ site_id: 'im-2', level: 1, direction: 'downlink', comms_min_fraction: 0.5, networks: ['dsn', 'estrack', 'jaxa'], step_min: 30 })
    expect(body).not.toHaveProperty('budget')
  })

  it('traces the horizon for a manual point', () => {
    const { body } = buildLinkRequest({ kind: 'point', lat: -89, lon: 10 }, win, form())
    expect(body).toMatchObject({ lat: -89, lon: 10, horizon: 'terrain' })
    expect(body).not.toHaveProperty('site_id')
  })

  it('needs a network or an antenna', () => {
    expect(buildLinkRequest(site, win, form({ networks: [] })).problem).toBe('Pick a network or add an antenna')
  })

  it('level 2 needs the radio data: EIRP, data rate and the Eb/N0 needed; kbit/s become bit/s', () => {
    expect(buildLinkRequest(site, win, form({ level: 2 })).problem).toBe('Enter your EIRP, data rate and the Eb/N0 you need')
    expect(buildLinkRequest(site, win, form({ level: 2, eirp: '20', rateKbps: '256' })).problem).toBe('Enter your EIRP, data rate and the Eb/N0 you need')
    const { body } = buildLinkRequest(site, win, form({ level: 2, eirp: '20', rateKbps: '256', ebn0: '2.5' }))
    expect(body?.budget).toEqual({ band: 'X', transmit_eirp_dbw: 20, required_ebn0_db: 2.5, data_rate_bps: 256_000 })
  })

  it('sends the generic budget fields only when typed', () => {
    const { body } = buildLinkRequest(site, win, form({ level: 2, eirp: '15', rateKbps: '1000', ebn0: '3', band: 'Ka', freq: '26,2', margin: '4' }))
    expect(body?.budget).toEqual({ band: 'Ka', transmit_eirp_dbw: 15, required_ebn0_db: 3, data_rate_bps: 1_000_000, frequency_ghz: 26.2, min_margin_db: 4 })
  })
  it('an uplink needs the lunar G/T', () => {
    const f = form({ level: 2, eirp: '60', rateKbps: '2', ebn0: '5', direction: 'uplink_low_power' })
    expect(buildLinkRequest(site, win, f).problem).toMatch(/lunar terminal/)
    expect(buildLinkRequest(site, win, { ...f, gt: '-20' }).body?.budget).toMatchObject({ receive_gt_db_per_k: -20 })
  })

  it('rejects text where a number is expected', () => {
    expect(buildLinkRequest(site, win, form({ level: 2, eirp: 'high', rateKbps: '1', ebn0: '2' })).problem).toMatch(/numbers/)
    expect(buildLinkRequest(site, win, form({ level: 2, eirp: '1', rateKbps: '0', ebn0: '2' })).problem).toMatch(/above 0/)
  })

  it('validates and converts own antennas', () => {
    const own = { key: 1, lat: '40.4', lon: '-4.2', height: '', minEl: '6', diameter: '34', gt: '' }
    const { body } = buildLinkRequest(site, win, form({ networks: [], custom: [own] }))
    expect(body?.custom_stations).toEqual([{ id: 'own-1', name: 'My antenna 1', lat_deg: 40.4, lon_deg: -4.2, min_elevation_deg: 6, height_m: 0, diameter_m: 34 }])
    expect(buildLinkRequest(site, win, form({ custom: [{ ...own, minEl: '' }] })).problem).toMatch(/minimum elevation are needed/)
    expect(buildLinkRequest(site, win, form({ custom: [{ ...own, lat: '95' }] })).problem).toMatch(/latitude is between/)
    expect(buildLinkRequest(site, win, form({ custom: [{ ...own, minEl: '90' }] })).problem).toMatch(/under 90/)
  })

  it('at the budget level an own antenna must give its G/T or its dish diameter', () => {
    const budget = { level: 2 as const, eirp: '20', rateKbps: '256', ebn0: '2.5', networks: [] }
    const bare = { key: 1, lat: '40.4', lon: '-4.2', height: '', minEl: '6', diameter: '', gt: '' }
    expect(buildLinkRequest(site, win, form({ ...budget, custom: [bare] })).problem).toBe('Antenna 1: give its G/T or its dish diameter')
    expect(buildLinkRequest(site, win, form({ custom: [bare], networks: [] })).problem).toBeNull() // geometry does not need it
    const withGt = buildLinkRequest(site, win, form({ ...budget, custom: [{ ...bare, gt: '52.5' }] }))
    expect(withGt.body?.custom_stations).toEqual([{ id: 'own-1', name: 'My antenna 1', lat_deg: 40.4, lon_deg: -4.2, min_elevation_deg: 6, height_m: 0, gt_db_per_k: 52.5 }])
    expect(buildLinkRequest(site, win, form({ ...budget, custom: [{ ...bare, diameter: '35' }] })).problem).toBeNull()
  })

  it('while the budget is incomplete the geometry is asked instead, and the problem is kept', () => {
    const { body, problem } = buildLinkRequestWithFallback(site, win, form({ level: 2 }))
    expect(body?.level).toBe(1)
    expect(body).not.toHaveProperty('budget')
    expect(problem).toBe('Enter your EIRP, data rate and the Eb/N0 you need')
    const done = buildLinkRequestWithFallback(site, win, form({ level: 2, eirp: '20', rateKbps: '256', ebn0: '2.5' }))
    expect(done.problem).toBeNull()
    expect(done.body?.level).toBe(2)
    expect(buildLinkRequestWithFallback(site, win, form({ level: 2, networks: [] })).body).toBeNull() // nothing to ask for
  })
})

describe('linkStepMin', () => {
  it('keeps the window under 2000 samples in steps of 10 minutes', () => {
    expect(linkStepMin(72)).toBe(10)
    expect(linkStepMin(720)).toBe(30)
    expect(Math.floor((720 * 60) / linkStepMin(720)) + 1).toBeLessThanOrEqual(2000)
  })
})

describe('ranges', () => {
  const step = HOUR
  const ranges: [number, number][] = [
    [10 * HOUR, 20 * HOUR],
    [30 * HOUR, 40 * HOUR],
  ]
  it('a range lasts until one step after its last sample', () => {
    expect(inRanges(ranges, 10 * HOUR, step)).toBe(true)
    expect(inRanges(ranges, 20.5 * HOUR, step)).toBe(true)
    expect(inRanges(ranges, 21 * HOUR, step)).toBe(false)
    expect(inRanges(ranges, 5 * HOUR, step)).toBe(false)
  })
  it('finds the next change', () => {
    expect(nextChange(ranges, 5 * HOUR, step, 48 * HOUR)).toEqual({ kind: 'start', at: 10 * HOUR })
    expect(nextChange(ranges, 15 * HOUR, step, 48 * HOUR)).toEqual({ kind: 'end', at: 21 * HOUR })
    expect(nextChange(ranges, 45 * HOUR, step, 48 * HOUR)).toBeNull()
  })
  it('a range that reaches the window end does not end inside it', () => {
    expect(nextChange([[10 * HOUR, 48 * HOUR]], 15 * HOUR, step, 48 * HOUR)).toBeNull()
  })
})

const response = (over: Partial<LinkResponse> = {}): LinkResponse =>
  ({
    step_min: 60,
    contact_ranges: [{ start: '2027-03-01T10:00:00Z', end: '2027-03-01T20:00:00Z' }],
    earth_visible_ranges: [{ start: '2027-03-01T08:00:00Z', end: '2027-03-01T22:00:00Z' }],
    any_station_ranges: [{ start: '2027-03-01T10:00:00Z', end: '2027-03-01T20:00:00Z' }],
    contact_window_fraction: 0.4,
    contact_hours: 10,
    longest_blackout_h: 14,
    earth_visible_fraction: 0.6,
    any_station_fraction: 0.4,
    budget: null,
    stations: [],
    ...over,
  }) as unknown as LinkResponse

describe('summarize and noLinkReason', () => {
  const at = (h: number) => Date.parse('2027-03-01T00:00:00Z') + h * HOUR
  it('level 1 reads the contact series', () => {
    const s = summarize(response())
    expect(s).toMatchObject({ level2: false, linkFraction: 0.4, linkHours: 10, gapHours: 14, margin: null })
  })
  it('the longest unbroken link counts the step each range ends on', () => {
    const two = [
      { start: '2027-03-01T02:00:00Z', end: '2027-03-01T04:00:00Z' },
      { start: '2027-03-01T10:00:00Z', end: '2027-03-01T15:00:00Z' },
    ]
    expect(summarize(response({ contact_ranges: two })).longestLinkH).toBe(6)
    expect(summarize(response({ contact_ranges: [] })).longestLinkH).toBe(0)
  })
  it('explains why there is no link', () => {
    const s = summarize(response())
    expect(noLinkReason(s, at(15))).toBeNull()
    expect(noLinkReason(s, at(5))).toBe('The Earth is below this place’s horizon')
    const noAntenna = summarize(response({ any_station_ranges: [], contact_ranges: [] }))
    expect(noLinkReason(noAntenna, at(15))).toBe('No antenna sees the Moon')
  })
  it('level 2 reads the budget, and a closed contact without margin says so', () => {
    const b = {
      inputs: { min_margin_db: 3 },
      link_ranges: [{ start: '2027-03-01T16:00:00Z', end: '2027-03-01T20:00:00Z' }],
      link_window_fraction: 0.2,
      link_hours: 5,
      longest_link_blackout_h: 19,
      best_margin_db: [null, 2.5, 3.9],
    }
    const s = summarize(response({ budget: b as unknown as LinkResponse['budget'] }))
    expect(s).toMatchObject({ level2: true, linkFraction: 0.2, gapHours: 19, needMarginDb: 3, margin: { min: 2.5, max: 3.9 } })
    expect(noLinkReason(s, at(12))).toBe('The link budget falls short')
  })
})

describe('rankStations and formatRate', () => {
  it('ranks by link hours at level 2 and contact hours at level 1', () => {
    const st = [
      { id: 'a', contact_hours: 5, budget: { link_hours: 9 } },
      { id: 'b', contact_hours: 8, budget: { link_hours: 2 } },
    ]
    expect(rankStations(response({ stations: st as never })).map((s) => s.id)).toEqual(['a', 'b'])
    const lvl1 = [
      { id: 'a', contact_hours: 5, budget: null },
      { id: 'b', contact_hours: 8, budget: null },
    ]
    expect(rankStations(response({ stations: lvl1 as never })).map((s) => s.id)).toEqual(['b', 'a'])
  })
  it('formats data rates', () => {
    expect(formatRate(37_000_000)).toBe('37 Mbit/s')
    expect(formatRate(1_060_000)).toBe('1.1 Mbit/s')
    expect(formatRate(256_000)).toBe('256 kbit/s')
    expect(formatRate(null)).toBe('—')
  })
})
