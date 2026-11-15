/**
 * Builds the POST /api/v1/link body from the inputs of the comparison panel. Pure, so it can be tested; a missing
 * required value throws an Error that names it. Optional budget fields left empty are omitted: the API then uses
 * its own stated defaults (9.6 dB required Eb/N0, 0 dB other losses, 3 dB margin, the band centre).
 */
import type { LinkBudgetInput, LinkDirection, LinkBand, LinkRequest } from '../api/types'
import type { LinkBudgetFields, LinkBudgetKey, LinkNetwork } from '../state/link'
import type { Selection } from '../state/store'
import { isoMinute } from '../time/clock'
import { placeFields, stepFor } from './powerRequest'

export interface LinkInputs {
  level: 1 | 2
  networks: LinkNetwork[]
  direction: LinkDirection
  band: LinkBand
  budget: LinkBudgetFields
  commsMinFraction: number
  startMs: number
  durationH: number
  mastM: number
}

export interface BudgetFieldSpec {
  key: LinkBudgetKey
  label: string
  unit: string
  hint: string
  optional?: boolean
}

export const BUDGET_FIELDS: BudgetFieldSpec[] = [
  { key: 'transmit_eirp_dbw', label: 'Transmit power (EIRP)', unit: 'dBW', hint: 'EIRP of the transmitting end: the lunar terminal for a downlink, the ground antenna for an uplink.' },
  { key: 'data_rate_bps', label: 'Data rate', unit: 'bit/s', hint: 'Information data rate.' },
  { key: 'receive_gt_db_per_k', label: 'Receiver G/T', unit: 'dB/K', hint: 'Downlink: leave empty to use each antenna\'s catalogue value. Uplink: required, it is the lunar terminal\'s G/T.', optional: true },
  { key: 'frequency_ghz', label: 'Frequency', unit: 'GHz', hint: 'Leave empty for the centre of the band.', optional: true },
  { key: 'required_ebn0_db', label: 'Required Eb/N0', unit: 'dB', hint: 'What the modulation and coding need. Empty = 9.6 dB (uncoded BPSK/QPSK at 1e-5, conservative).', optional: true },
  { key: 'other_losses_db', label: 'Other losses', unit: 'dB', hint: 'Pointing, polarisation, atmosphere, implementation. Empty = 0 dB (ignored).', optional: true },
  { key: 'min_margin_db', label: 'Margin wanted', unit: 'dB', hint: 'Margin above the required Eb/N0 for the link to count as closed. Empty = 3 dB.', optional: true },
]

export function buildLinkRequest(p: LinkInputs, sel: Selection | null): LinkRequest {
  if (p.networks.length === 0) throw new Error('Pick at least one antenna network')
  let budget: LinkBudgetInput | undefined
  if (p.level === 2) {
    const num = (k: LinkBudgetKey): number | undefined => {
      const s = BUDGET_FIELDS.find((x) => x.key === k)!
      const v = p.budget[k]?.trim()
      if (!v) {
        if (s.optional) return undefined
        throw new Error(`${s.label} is required`)
      }
      const n = Number(v)
      if (!Number.isFinite(n)) throw new Error(`${s.label} must be a number`)
      return n
    }
    const gt = num('receive_gt_db_per_k')
    if (p.direction !== 'downlink' && gt === undefined) throw new Error('An uplink needs the receiver G/T (the lunar terminal)')
    const dropUndefined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
    budget = dropUndefined({
      band: p.band,
      frequency_ghz: num('frequency_ghz'),
      transmit_eirp_dbw: num('transmit_eirp_dbw') as number,
      data_rate_bps: num('data_rate_bps') as number,
      receive_gt_db_per_k: gt,
      required_ebn0_db: num('required_ebn0_db'),
      other_losses_db: num('other_losses_db'),
      min_margin_db: num('min_margin_db'),
    })
  }
  return {
    ...placeFields(sel),
    start: isoMinute(p.startMs),
    duration_h: p.durationH,
    step_min: stepFor(p.durationH),
    mast_m: p.mastM,
    level: p.level,
    ...(budget ? { budget } : {}),
    networks: p.networks,
    direction: p.direction,
    comms_min_fraction: p.commsMinFraction,
  }
}
