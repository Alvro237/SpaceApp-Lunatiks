/**
 * Level 4 result, the colony analysis (docs/api-guide-mech.md): the verdict first as words, then the numbers that
 * explain it, then where the energy went. Labels follow the guide's interface rules (plain words plus the unit).
 * A null stays "—"; the one exception is the freezing time, where null documented as "never reached".
 */
import type { ReactNode } from 'react'
import type { ColonyStatus, EnergyBreakdown, PowerResponse } from '../api/types'
import { Tip } from '../ui/Tip'

const K = 273.15
const kwh = (wh: number | null | undefined, d = 1) => (wh === null || wh === undefined ? '—' : `${(wh / 1000).toFixed(d)} kWh`)
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(0)} %`)
const num = (v: number | null | undefined, d: number, unit: string) => (v === null || v === undefined ? '—' : `${v.toFixed(d)} ${unit}`)

function stats(a: (number | null)[] | null): { min: number; max: number; mean: number } | null {
  const v = (a ?? []).filter((x): x is number => x !== null && Number.isFinite(x))
  if (v.length === 0) return null
  return { min: Math.min(...v), max: Math.max(...v), mean: v.reduce((s, x) => s + x, 0) / v.length }
}

const STATUS: Record<ColonyStatus, { cls: 'pass' | 'warn' | 'fail'; icon: string }> = {
  survives_independently: { cls: 'pass', icon: '✓ ' },
  survives_window_declining: { cls: 'warn', icon: '↘ ' },
  failure_after_x_days: { cls: 'fail', icon: '✗ ' },
}

function statusText(r: PowerResponse): string {
  switch (r.colony_status) {
    case 'survives_independently':
      return 'Survives on its own'
    case 'survives_window_declining':
      return 'Survives, but draining'
    case 'failure_after_x_days':
      return `Fails after ${r.failure_after_days === null ? '?' : r.failure_after_days.toFixed(1)} days`
    default:
      return '—'
  }
}

function Tile({ label, value, sub, tip }: { label: string; value: string; sub?: ReactNode; tip?: string }) {
  return (
    <li className="metric metric-neutral">
      <span className="metric-label">
        {label}
        {tip && <Tip label={label.toLowerCase()}>{tip}</Tip>}
      </span>
      <span className="metric-value">{value}</span>
      {sub && <span className="metric-sub">{sub}</span>}
    </li>
  )
}

export function ColonyResult({ r }: { r: PowerResponse }) {
  if (!r.colony_status) return null
  const st = STATUS[r.colony_status]
  const autonomy = stats(r.autonomy_h)
  const sunrise = stats(r.sunrise_margin_wh)
  const heater = stats(r.heater_w)
  const inside = stats(r.interior_k)

  return (
    <>
      <p className={`verdict-box ${st.cls}`}>
        <span aria-hidden="true">{st.icon}</span>
        {statusText(r)}
      </p>
      <ul className="metric-grid compact">
        <Tile label="Lowest battery (%)" value={pct(r.min_soc)} sub={`at the end ${pct(r.final_soc)}`} />
        <Tile
          label="Battery-only time (h)"
          value={autonomy ? `${autonomy.min.toFixed(0)} h` : '—'}
          sub="shortest, over the window"
          tip="Hours the battery alone could carry the essential load, at the worst moment."
        />
        <Tile
          label="Spare at sunrise (kWh)"
          value={sunrise ? kwh(sunrise.min) : '—'}
          sub={sunrise && sunrise.min < 0 ? 'negative: a night is not survived' : 'worst night'}
          tip="In the dark: stored energy above the floor minus what the essential load needs until sunrise. Positive means it reaches sunrise."
        />
        <Tile label="Saving mode (days)" value={num(r.degraded_days, 1, 'd')} sub="optional loads off" />
        <Tile
          label="Heating (W)"
          value={heater ? `${heater.mean.toFixed(0)} W` : '—'}
          sub={heater ? `peak ${heater.max.toFixed(0)} W` : undefined}
        />
        <Tile
          label="Inside temp (°C)"
          value={inside ? `${(inside.min - K).toFixed(0)} to ${(inside.max - K).toFixed(0)} °C` : '—'}
          sub={r.interior_below_min_ranges && r.interior_below_min_ranges.length > 0 ? 'drops below the minimum' : 'stays above the minimum'}
        />
        <Tile
          label="Time to freeze (h)"
          value={r.cold_soak_h === null ? 'Never' : `${r.cold_soak_h.toFixed(0)} h`}
          sub="if power is lost"
          tip="Hours from the target to the minimum temperature if all electrical power is lost, at the coldest moment. Never: it does not get that cold."
        />
        <Tile
          label="Battery needed (kWh)"
          value={r.min_battery_capacity_wh === null ? '—' : kwh(r.min_battery_capacity_wh, 0)}
          sub={r.min_battery_capacity_wh === null ? 'no size reaches it' : 'to survive on its own'}
          tip="Smallest battery that survives independently with the panels you gave. — means none does, or sizing was off."
        />
        <Tile
          label="Panels needed (m²)"
          value={r.min_panel_area_m2 === null ? '—' : `${r.min_panel_area_m2.toFixed(0)} m²`}
          sub={r.min_panel_area_m2 === null ? 'no size reaches it' : 'to survive on its own'}
          tip="Smallest array that survives independently with the battery you gave. — means none does, or sizing was off."
        />
      </ul>
      {r.energy_breakdown && <EnergyFlow b={r.energy_breakdown} />}
    </>
  )
}

/** Where the energy went: one bar per use, relative to what the array produced. The bars repeat the numbers. */
function EnergyFlow({ b }: { b: EnergyBreakdown }) {
  const rows: [string, number][] = [
    ['Essential loads', b.critical_served_wh],
    ['Heating', b.heater_served_wh],
    ['Comms', b.comms_served_wh],
    ['Optional loads', b.deferrable_served_wh],
    ['Battery losses', b.charge_losses_wh + b.discharge_losses_wh],
    ['Wasted (battery full)', b.curtailed_wh],
    ['Into the battery', b.battery_change_wh],
  ]
  const total = Math.max(1e-9, b.generated_wh)
  const unserved = b.critical_unserved_wh
  return (
    <div className="energy-flow">
      <h4 className="cmp-sub">
        Where the energy went
        <Tip label="the energy flow">Share of what the panels produced ({kwh(b.generated_wh, 0)}). Into the battery is negative when it drains.</Tip>
      </h4>
      <dl className="flow-list">
        {rows.map(([label, wh]) => (
          <div key={label} className="flow-row">
            <dt>{label}</dt>
            <dd>
              <span className="cmp-val">{kwh(wh, 0)}</span>
              <span className="cmp-bar" aria-hidden="true">
                <i style={{ width: `${Math.round(Math.max(0, Math.min(1, Math.abs(wh) / total)) * 100)}%` }} />
              </span>
            </dd>
          </div>
        ))}
        {unserved > 0 && (
          <div className="flow-row flow-bad">
            <dt>Essential not served</dt>
            <dd>
              <span className="cmp-val">{kwh(unserved, 0)}</span>
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}
