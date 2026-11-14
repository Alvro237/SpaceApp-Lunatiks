/**
 * Power levels (MECH, POST /api/v1/power):
 *   1. visible solar disc over the window (always available: same engine);
 *   2. array power (area, efficiency, derating);
 *   3. energy balance with a battery and a load: does the mission survive the longest night.
 * No panel, battery or load value is pre-filled: none has a cited source yet, so the planner types them.
 */
import { type FormEvent, useId, useState } from 'react'
import { isMissing } from '../api/client'
import { usePower } from '../api/hooks'
import type { PowerRequest } from '../api/types'
import { useApp } from '../state/store'
import { isoMinute } from '../time/clock'
import { useParams } from '../time/hooks'
import { useNow } from './useNow'
import { ApiStatus, SourceTag } from '../ui/ApiStatus'

type Fields = Record<string, string>
const ARRAY = [
  ['area_m2', 'Array area (m²)'],
  ['efficiency', 'Efficiency (0–1)'],
  ['derating', 'Other losses factor (0–1, 1 = none)'],
] as const
const BATTERY = [
  ['capacity_wh', 'Battery capacity (Wh)'],
  ['initial_soc', 'Initial charge (0–1)'],
  ['min_soc', 'Lowest allowed charge (0–1)'],
  ['charge_efficiency', 'Charge efficiency (0–1)'],
  ['discharge_efficiency', 'Discharge efficiency (0–1)'],
] as const
const LOAD = [
  ['load_w', 'Load in sunlight (W)'],
  ['night_load_w', 'Load in darkness (W, optional)'],
] as const

export function PowerPanel() {
  const id = useId()
  const selection = useApp((s) => s.selection)
  const mastM = useApp((s) => s.mastM)
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const params = useParams()
  const { series: local } = useNow()
  const [level, setLevel] = useState<2 | 3>(2)
  const [f, setF] = useState<Fields>({})
  const [error, setError] = useState<string | null>(null)
  const power = usePower()

  const meanVisible = local ? local.samples.reduce((a, s) => a + s.sun.fraction, 0) / local.samples.length : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const num = (k: string, optional = false) => {
      const v = f[k]?.trim()
      if (!v) {
        if (optional) return undefined
        throw new Error(`${k.replace(/_/g, ' ')} is required`)
      }
      const n = Number(v)
      if (!Number.isFinite(n)) throw new Error(`${k.replace(/_/g, ' ')} must be a number`)
      return n
    }
    try {
      const body: PowerRequest = {
        ...(selection.kind === 'site' ? { site_id: selection.id } : { lat: selection.lat, lon: selection.lon }),
        start: isoMinute(startMs),
        duration_h: durationH,
        step_min: 60,
        mast_m: mastM,
        panel: params.panel,
        level,
        array: { area_m2: num('area_m2')!, efficiency: num('efficiency')!, derating: num('derating')! },
        ...(level === 3
          ? {
              battery: {
                capacity_wh: num('capacity_wh')!,
                initial_soc: num('initial_soc')!,
                min_soc: num('min_soc')!,
                charge_efficiency: num('charge_efficiency')!,
                discharge_efficiency: num('discharge_efficiency')!,
              },
              load: { load_w: num('load_w')!, night_load_w: num('night_load_w', true) ?? null },
            }
          : {}),
      }
      setError(null)
      power.mutate(body)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const input = ([k, label]: readonly [string, string]) => (
    <div className="field stack" key={k}>
      <label htmlFor={`${id}-${k}`}>{label}</label>
      <input id={`${id}-${k}`} inputMode="decimal" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  )
  const r = power.data

  return (
    <div className="panel-section">
      <h3 className="level">Visible solar disc</h3>
      {local && meanVisible !== null ? (
        <dl className="kv">
          <div>
            <dt>Mean disc visible</dt>
            <dd>{(meanVisible * 100).toFixed(1)} %</dd>
          </div>
          <div>
            <dt>Sunlit</dt>
            <dd>{local.metrics.sunlightPct.toFixed(1)} %</dd>
          </div>
          <div>
            <dt>Longest night</dt>
            <dd>{local.metrics.longestDarkH.toFixed(1)} h</dd>
          </div>
          <div>
            <dt>Mean W/m² ({params.panel})</dt>
            <dd>{local.metrics.meanPowerWm2.toFixed(0)} W/m²</dd>
          </div>
        </dl>
      ) : (
        <p className="muted">Loading…</p>
      )}

      <form onSubmit={submit} noValidate className="power-form">
        <fieldset className="segmented">
          <legend>Model</legend>
          <label>
            <input type="radio" name={`${id}-lvl`} checked={level === 2} onChange={() => setLevel(2)} /> Level 2 · array power
          </label>
          <label>
            <input type="radio" name={`${id}-lvl`} checked={level === 3} onChange={() => setLevel(3)} /> Level 3 · battery balance
          </label>
        </fieldset>
        <div className="grid-fields">{ARRAY.map(input)}</div>
        {level === 3 && (
          <>
            <div className="grid-fields">{BATTERY.map(input)}</div>
            <div className="grid-fields">{LOAD.map(input)}</div>
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" disabled={power.isPending}>
          {power.isPending ? 'Computing…' : `Compute level ${level}`}
        </button>
      </form>
      {power.error && (
        <ApiStatus
          error={power.error}
          what="Power model"
          fallback={isMissing(power.error) ? 'Coming with the MECH model.' : undefined}
        />
      )}
      {r && (
        <div className="result" aria-live="polite">
          <p className="meta-line">
            <span className={`badge badge-${r.horizon_kind}`}>{r.horizon_kind === 'terrain' ? 'LOLA terrain horizon' : 'Smooth-sphere horizon'}</span>
            <SourceTag source="api" />
          </p>
          <dl className="kv">
            {r.array && (
              <>
                <div>
                  <dt>Mean array power</dt>
                  <dd>{r.array.mean_power_w.toFixed(1)} W</dd>
                </div>
                <div>
                  <dt>Peak array power</dt>
                  <dd>{r.array.peak_power_w.toFixed(1)} W</dd>
                </div>
                <div>
                  <dt>Energy over the window</dt>
                  <dd>{(r.array.energy_wh / 1000).toFixed(2)} kWh</dd>
                </div>
              </>
            )}
            {r.balance && (
              <>
                <div>
                  <dt>Mission survives the window</dt>
                  <dd>{r.balance.survived ? '✓ Yes' : '✗ No'}</dd>
                </div>
                <div>
                  <dt>Lowest charge</dt>
                  <dd>{(r.balance.min_soc_fraction * 100).toFixed(0)} %</dd>
                </div>
                <div>
                  <dt>Energy to bridge the longest night</dt>
                  <dd>
                    {r.balance.longest_dark_energy_wh.toFixed(0)} Wh of {r.balance.usable_capacity_wh.toFixed(0)} Wh usable
                  </dd>
                </div>
                {r.balance.first_depletion_at && (
                  <div>
                    <dt>First unserved load</dt>
                    <dd>{r.balance.first_depletion_at}</dd>
                  </div>
                )}
              </>
            )}
          </dl>
          {r.assumptions.length > 0 && (
            <details>
              <summary>Assumptions</summary>
              <ul>
                {r.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
