/**
 * Power levels (MECH, POST /api/v1/power; contract in docs/api-guide-mech.md, flat field names):
 *   1. visible solar disc over the window (always available: same engine);
 *   2. array power (area, efficiency, derating);
 *   3. energy balance with a battery and a load: does the mission survive the longest night.
 * No panel, battery or load value is pre-filled: none has a cited source yet, so the planner types them. The
 * "example values" button fills the guide's test values and says so; they are not recommendations.
 */
import { type FormEvent, useId, useState } from 'react'
import { isMissing } from '../api/client'
import { usePower } from '../api/hooks'
import type { PowerRequest, PowerResponse } from '../api/types'
import { useApp } from '../state/store'
import { isoMinute } from '../time/clock'
import { useParams } from '../time/hooks'
import { useNow } from './useNow'
import { ApiStatus, SourceTag } from '../ui/ApiStatus'

type Key =
  | 'panel_area_m2'
  | 'cell_efficiency'
  | 'derating'
  | 'battery_capacity_wh'
  | 'battery_initial_soc'
  | 'battery_min_soc'
  | 'charge_efficiency'
  | 'discharge_efficiency'
  | 'load_w'
  | 'night_load_w'
type Fields = Partial<Record<Key, string>>

const ARRAY: readonly (readonly [Key, string])[] = [
  ['panel_area_m2', 'Array area (m²)'],
  ['cell_efficiency', 'Efficiency (0–1)'],
  ['derating', 'Other losses factor (0–1, 1 = none)'],
]
const BATTERY: readonly (readonly [Key, string])[] = [
  ['battery_capacity_wh', 'Battery capacity (Wh)'],
  ['battery_initial_soc', 'Initial charge (0–1)'],
  ['battery_min_soc', 'Lowest allowed charge (0–1)'],
  ['charge_efficiency', 'Charge efficiency (0–1)'],
  ['discharge_efficiency', 'Discharge efficiency (0–1)'],
]
const LOAD: readonly (readonly [Key, string])[] = [
  ['load_w', 'Load (W)'],
  ['night_load_w', 'Load in darkness (W, optional)'],
]

/** Test values from docs/api-guide-mech.md: for trying the model, not recommended limits. */
const EXAMPLE: Fields = {
  panel_area_m2: '2',
  cell_efficiency: '0.3',
  derating: '0.9',
  load_w: '60',
  battery_capacity_wh: '3000',
  battery_initial_soc: '1',
  battery_min_soc: '0.2',
  charge_efficiency: '0.95',
  discharge_efficiency: '0.95',
}

const fmt = (v: number | null | undefined, digits = 0, unit = '') => (v === null || v === undefined ? '—' : `${v.toFixed(digits)}${unit}`)
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(0)} %`)

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
  const [usedExample, setUsedExample] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const power = usePower()

  const meanVisible = local ? local.samples.reduce((a, s) => a + s.sun.fraction, 0) / local.samples.length : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const num = (k: Key, optional = false): number | undefined => {
      const v = f[k]?.trim()
      if (!v) {
        if (optional) return undefined
        throw new Error(`${labelOf(k)} is required`)
      }
      const n = Number(v)
      if (!Number.isFinite(n)) throw new Error(`${labelOf(k)} must be a number`)
      return n
    }
    try {
      const body: PowerRequest = {
        ...(selection.kind === 'site' ? { site_id: selection.id } : { lat: selection.lat, lon: selection.lon }),
        start: isoMinute(startMs),
        duration_h: durationH,
        // keep within the API's 20 000-sample limit for long windows
        step_min: Math.max(60, Math.ceil((durationH * 60) / 19_000)),
        mast_m: mastM,
        panel: params.panel,
        level,
        panel_area_m2: num('panel_area_m2'),
        cell_efficiency: num('cell_efficiency'),
        derating: num('derating'),
        ...(level === 3
          ? {
              battery_capacity_wh: num('battery_capacity_wh'),
              battery_initial_soc: num('battery_initial_soc'),
              battery_min_soc: num('battery_min_soc'),
              charge_efficiency: num('charge_efficiency'),
              discharge_efficiency: num('discharge_efficiency'),
              load_w: num('load_w'),
              night_load_w: num('night_load_w', true),
            }
          : {}),
      }
      setError(null)
      power.mutate(body)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const input = ([k, label]: readonly [Key, string]) => (
    <div className="field stack" key={k}>
      <label htmlFor={`${id}-${k}`}>{label}</label>
      <input
        id={`${id}-${k}`}
        inputMode="decimal"
        value={f[k] ?? ''}
        onChange={(e) => {
          setF({ ...f, [k]: e.target.value })
          setUsedExample(false)
        }}
      />
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
        <div className="row">
          <button type="submit" className="primary" disabled={power.isPending}>
            {power.isPending ? 'Computing…' : `Compute level ${level}`}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setF({ ...EXAMPLE, night_load_w: f.night_load_w })
              setUsedExample(true)
              setError(null)
            }}
          >
            Fill example values
          </button>
        </div>
        {usedExample && <p className="fine">Example values for trying the model (2 m², 30 %, 60 W, 3 kWh…), not mission recommendations.</p>}
      </form>
      {power.error && (
        <ApiStatus error={power.error} what="Power model" fallback={isMissing(power.error) ? 'Coming with the MECH model.' : undefined} />
      )}
      {r && <PowerResult r={r} />}
    </div>
  )
}

function labelOf(k: Key): string {
  return [...ARRAY, ...BATTERY, ...LOAD].find(([key]) => key === k)?.[1] ?? k
}

function PowerResult({ r }: { r: PowerResponse }) {
  return (
    <div className="result" aria-live="polite">
      <p className="meta-line">
        <span className={`badge badge-${r.horizon_kind}`}>
          {r.horizon_kind === 'terrain' ? `LOLA terrain horizon · ${r.mast_m_used} m` : 'Smooth-sphere horizon (estimate)'}
        </span>
        <SourceTag source="api" />
      </p>
      {r.level === 3 && r.survives !== null && (
        <p className={`verdict ${r.survives ? 'pass' : 'fail'}`}>
          {r.survives ? '✓ The load is served for the whole window' : `✗ The battery runs out${r.first_depletion_at ? ` on ${r.first_depletion_at.slice(0, 16).replace('T', ' ')} UTC` : ''}`}
        </p>
      )}
      <dl className="kv">
        <div>
          <dt>Sunlit</dt>
          <dd>{pct(r.sunlit_fraction)}</dd>
        </div>
        <div>
          <dt>Longest night</dt>
          <dd>{fmt(r.longest_dark_h, 1, ' h')}</dd>
        </div>
        <div>
          <dt>Mean power on 1 m²</dt>
          <dd>{fmt(r.mean_power_w_m2, 0, ' W/m²')}</dd>
        </div>
        {r.level >= 2 && (
          <>
            <div>
              <dt>Mean array power</dt>
              <dd>{fmt(r.mean_power_w, 1, ' W')}</dd>
            </div>
            <div>
              <dt>Peak array power</dt>
              <dd>{fmt(r.peak_power_w, 1, ' W')}</dd>
            </div>
            <div>
              <dt>Energy over the window</dt>
              <dd>{r.energy_wh === null ? '—' : `${(r.energy_wh / 1000).toFixed(2)} kWh`}</dd>
            </div>
            {r.eclipse_ranges.length > 0 && (
              <div>
                <dt>Lost to eclipses</dt>
                <dd>{fmt(r.eclipse_energy_loss_wh, 0, ' Wh')}</dd>
              </div>
            )}
          </>
        )}
        {r.level === 3 && (
          <>
            <div>
              <dt>Lowest charge</dt>
              <dd>{pct(r.min_soc)}</dd>
            </div>
            <div>
              <dt>Charge at the end</dt>
              <dd>{pct(r.final_soc)}</dd>
            </div>
            <div>
              <dt>Margin at the worst moment</dt>
              <dd>{fmt(r.energy_margin_wh, 0, ' Wh')}</dd>
            </div>
            <div>
              <dt>Longest night needs</dt>
              <dd>
                {fmt(r.longest_dark_energy_wh, 0, ' Wh')} of {fmt(r.usable_capacity_wh, 0, ' Wh')} usable
              </dd>
            </div>
            {(r.unserved_energy_wh ?? 0) > 0 && (
              <div>
                <dt>Load not served</dt>
                <dd>{fmt(r.unserved_energy_wh, 0, ' Wh')}</dd>
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
  )
}
