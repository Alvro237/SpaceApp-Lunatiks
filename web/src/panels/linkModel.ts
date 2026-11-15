/**
 * Pure model of the radio-link section (AERO-2, POST /api/v1/link): what the form holds, the request it builds, and
 * the small calculations the panel and the timeline share (ranges, next change, ranking). No React here, so it is
 * tested on its own (linkModel.test.ts).
 *
 * Nothing physical is pre-filled. At the budget level the user must give what characterises their own radio and
 * antennas: the lunar EIRP, the data rate, the Eb/N0 their modulation needs, the lunar G/T for an uplink, and for each
 * antenna they add its G/T or dish diameter. Only the generic values keep a default, sent when typed: band X, margin 3 dB,
 * other losses 0 dB, the band-centre frequency.
 */
import type { LinkBand, LinkBudgetInput, LinkCustomStation, LinkDirection, LinkRequest, LinkResponse, LinkStationResult } from '../api/types'
import type { Selection } from '../state/store'

export const NETWORK_LABEL: Record<string, string> = { dsn: 'NASA DSN', estrack: 'ESA ESTRACK', jaxa: 'JAXA' }
export const NETWORK_IDS = ['dsn', 'estrack', 'jaxa'] as const
export const BANDS: LinkBand[] = ['S', 'X', 'Ka']
export const DIRECTIONS: { id: LinkDirection; label: string }[] = [
  { id: 'downlink', label: 'Downlink' },
  { id: 'uplink_low_power', label: 'Uplink low' },
  { id: 'uplink_high_power', label: 'Uplink high' },
]

/** One antenna the user adds; every value is the text typed in the form. */
export interface CustomForm {
  key: number
  lat: string
  lon: string
  height: string
  minEl: string
  diameter: string
  /** Receive G/T in dB/K (budget level): this or the diameter is required there. */
  gt: string
}

export interface LinkForm {
  networks: string[]
  level: 1 | 2
  direction: LinkDirection
  band: LinkBand
  freq: string
  eirp: string
  rateKbps: string
  ebn0: string
  margin: string
  losses: string
  gt: string
  custom: CustomForm[]
}

export const DEFAULT_FORM: LinkForm = {
  networks: [...NETWORK_IDS],
  level: 1,
  direction: 'downlink',
  band: 'X',
  freq: '',
  eirp: '',
  rateKbps: '',
  ebn0: '',
  margin: '',
  losses: '',
  gt: '',
  custom: [],
}

/** Sampling step that keeps the window under about 2000 samples, in steps of 10 minutes (the timeline's own rule). */
export const linkStepMin = (durationH: number) => Math.max(10, Math.ceil((durationH * 60) / 2000 / 10) * 10)

const BAD = Symbol('bad')
/** '' -> undefined (not given); a number -> the number; anything else -> BAD. */
function parse(text: string): number | undefined | typeof BAD {
  const t = text.trim().replace(',', '.')
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : BAD
}

export interface BuiltRequest {
  /** The request, or null while there is no place or the form is incomplete. */
  body: LinkRequest | null
  /** What to tell the user when the form is incomplete (null when there is simply no place yet). */
  problem: string | null
}

export function buildLinkRequest(place: Selection | null, win: { startIso: string; durationH: number; commsMinFraction: number }, f: LinkForm): BuiltRequest {
  if (!place) return { body: null, problem: null }
  const customs: LinkCustomStation[] = []
  for (const [i, c] of f.custom.entries()) {
    const label = `Antenna ${i + 1}`
    const lat = parse(c.lat)
    const lon = parse(c.lon)
    const minEl = parse(c.minEl)
    const height = parse(c.height)
    const diameter = parse(c.diameter)
    const gt = parse(c.gt)
    if (lat === undefined || lon === undefined || minEl === undefined) return { body: null, problem: `${label}: latitude, longitude and minimum elevation are needed` }
    if ([lat, lon, minEl, height, diameter, gt].includes(BAD)) return { body: null, problem: `${label}: use numbers` }
    if ((lat as number) < -90 || (lat as number) > 90) return { body: null, problem: `${label}: latitude is between -90 and 90` }
    if ((lon as number) < -180 || (lon as number) > 180) return { body: null, problem: `${label}: longitude is between -180 and 180` }
    if ((minEl as number) < 0 || (minEl as number) >= 90) return { body: null, problem: `${label}: minimum elevation is from 0 to under 90°` }
    if (diameter !== undefined && (diameter as number) <= 0) return { body: null, problem: `${label}: diameter must be above 0` }
    if (f.level === 2 && diameter === undefined && gt === undefined) return { body: null, problem: `${label}: give its G/T or its dish diameter` }
    customs.push({
      id: `own-${c.key}`,
      name: `My antenna ${i + 1}`,
      lat_deg: lat as number,
      lon_deg: lon as number,
      min_elevation_deg: minEl as number,
      height_m: (height as number | undefined) ?? 0,
      ...(diameter !== undefined ? { diameter_m: diameter as number } : {}),
      ...(f.level === 2 && gt !== undefined ? { gt_db_per_k: gt as number } : {}),
    })
  }
  if (f.networks.length === 0 && customs.length === 0) return { body: null, problem: 'Pick a network or add an antenna' }

  let budget: LinkBudgetInput | undefined
  if (f.level === 2) {
    const eirp = parse(f.eirp)
    const rate = parse(f.rateKbps)
    const need = parse(f.ebn0)
    if (eirp === undefined || rate === undefined || need === undefined) return { body: null, problem: 'Enter your EIRP, data rate and the Eb/N0 you need' }
    if (eirp === BAD || rate === BAD || need === BAD) return { body: null, problem: 'EIRP, data rate and Eb/N0 must be numbers' }
    if ((rate as number) <= 0) return { body: null, problem: 'The data rate must be above 0' }
    const opt = (text: string, name: string): { v?: number; err?: string } => {
      const n = parse(text)
      return n === BAD ? { err: `${name} must be a number` } : { v: n as number | undefined }
    }
    const freq = opt(f.freq, 'Frequency')
    const margin = opt(f.margin, 'Margin')
    const losses = opt(f.losses, 'Other losses')
    const gt = opt(f.gt, 'Lunar G/T')
    const err = [freq, margin, losses, gt].find((x) => x.err)?.err
    if (err) return { body: null, problem: err }
    if (freq.v !== undefined && (freq.v <= 0 || freq.v > 100)) return { body: null, problem: 'Frequency is between 0 and 100 GHz' }
    if ((margin.v ?? 0) < 0 || (losses.v ?? 0) < 0) return { body: null, problem: 'Margin and other losses cannot be negative' }
    if (f.direction !== 'downlink' && gt.v === undefined) return { body: null, problem: 'An uplink needs the lunar terminal’s G/T' }
    budget = {
      band: f.band,
      transmit_eirp_dbw: eirp as number,
      required_ebn0_db: need as number,
      data_rate_bps: (rate as number) * 1000,
      ...(freq.v !== undefined ? { frequency_ghz: freq.v } : {}),
      ...(margin.v !== undefined ? { min_margin_db: margin.v } : {}),
      ...(losses.v !== undefined ? { other_losses_db: losses.v } : {}),
      ...(gt.v !== undefined ? { receive_gt_db_per_k: gt.v } : {}),
    } as LinkBudgetInput
  }

  const placeFields = place.kind === 'site' ? { site_id: place.id } : { lat: place.lat, lon: place.lon, horizon: 'terrain' as const }
  return {
    problem: null,
    body: {
      ...placeFields,
      start: win.startIso,
      duration_h: win.durationH,
      step_min: linkStepMin(win.durationH),
      comms_min_fraction: win.commsMinFraction,
      networks: f.networks,
      custom_stations: customs,
      direction: f.direction,
      level: f.level,
      ...(budget ? { budget } : {}),
    } as LinkRequest,
  }
}

/**
 * The request to run for the form. At the budget level, while the budget is incomplete, the geometry (level 1) is asked
 * instead so the panel and the timeline keep showing the contact; `problem` still says what the budget needs.
 */
export function buildLinkRequestWithFallback(place: Selection | null, win: { startIso: string; durationH: number; commsMinFraction: number }, f: LinkForm): BuiltRequest {
  const built = buildLinkRequest(place, win, f)
  if (built.body || !built.problem || f.level !== 2) return built
  const geometry = buildLinkRequest(place, win, { ...f, level: 1 })
  return { body: geometry.body, problem: built.problem }
}

// ---------------------------------------------------------------------------------------------- time ranges

export type Range = [number, number]
export const toRanges = (r: { start: string; end: string }[] | undefined): Range[] => (r ?? []).map((q) => [Date.parse(q.start), Date.parse(q.end)] as Range)

/** Is `t` inside a range? A range ends at its last sample, which stands for one step more. */
export const inRanges = (ranges: Range[], t: number, stepMs: number) => ranges.some(([a, b]) => t >= a && t < b + stepMs)

/**
 * What happens next: the current range ends, or the next one starts. Null when nothing changes inside the window
 * (the range in progress reaches the window's last sample, or no further range starts). `lastMs` is that last sample.
 */
export function nextChange(ranges: Range[], now: number, stepMs: number, lastMs: number): { kind: 'start' | 'end'; at: number } | null {
  const current = ranges.find(([a, b]) => now >= a && now < b + stepMs)
  if (current) return current[1] >= lastMs ? null : { kind: 'end', at: current[1] + stepMs }
  const next = ranges.find(([a]) => a > now)
  return next ? { kind: 'start', at: next[0] } : null
}
// ---------------------------------------------------------------------------------------------- result summaries

export interface LinkSummary {
  level2: boolean
  linkRanges: Range[]
  contactRanges: Range[]
  earthRanges: Range[]
  antennaRanges: Range[]
  stepMs: number
  linkFraction: number
  linkHours: number
  gapHours: number
  earthFraction: number
  antennaFraction: number
  margin: { min: number; max: number } | null
  needMarginDb: number | null
}

export function summarize(r: LinkResponse): LinkSummary {
  const b = r.budget ?? null
  const margins = (b?.best_margin_db ?? []).filter((m): m is number => m !== null)
  return {
    level2: b !== null,
    linkRanges: toRanges(b ? b.link_ranges : r.contact_ranges),
    contactRanges: toRanges(r.contact_ranges),
    earthRanges: toRanges(r.earth_visible_ranges),
    antennaRanges: toRanges(r.any_station_ranges),
    stepMs: r.step_min * 60_000,
    linkFraction: b ? b.link_window_fraction : r.contact_window_fraction,
    linkHours: b ? b.link_hours : r.contact_hours,
    gapHours: b ? b.longest_link_blackout_h : r.longest_blackout_h,
    earthFraction: r.earth_visible_fraction,
    antennaFraction: r.any_station_fraction,
    margin: margins.length ? { min: Math.min(...margins), max: Math.max(...margins) } : null,
    needMarginDb: b ? b.inputs.min_margin_db : null,
  }
}

/** Why there is no link at this instant, in a few words. Null when there is one. */
export function noLinkReason(s: LinkSummary, now: number): string | null {
  const inLink = inRanges(s.linkRanges, now, s.stepMs)
  if (inLink) return null
  if (!inRanges(s.earthRanges, now, s.stepMs)) return 'The Earth is below this place’s horizon'
  if (!inRanges(s.antennaRanges, now, s.stepMs)) return 'No antenna sees the Moon'
  return 'The link budget falls short'
}

/** The antennas ranked by the hours they give: link hours at level 2, contact hours at level 1. */
export function rankStations(r: LinkResponse): LinkStationResult[] {
  const hours = (s: LinkStationResult) => (s.budget ? s.budget.link_hours : s.contact_hours)
  return [...r.stations].sort((a, b) => hours(b) - hours(a))
}

export function formatRate(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '—'
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1)} Mbit/s`
  return `${Math.round(bps / 1e3)} kbit/s`
}
