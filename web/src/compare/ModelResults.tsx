/**
 * What the power model answered for each compared place, under the parameters applied in the parameters panel. A real
 * table (one row per place), shown only once something is applied. A value the API did not give is a dash, never an
 * estimate; a smooth-sphere horizon is flagged because it is not a bound.
 */
import type { PowerResponse } from '../api/types'
import { useApplied } from './applied'
import { usePowerCompare } from './usePowerCompare'
import type { ComparedPlace } from './useComparePlaces'

const dash = '—'
const fixed = (v: number | null | undefined, d = 0, unit = '') => (v === null || v === undefined ? dash : `${v.toFixed(d)}${unit}`)
const pct = (v: number | null | undefined) => (v === null || v === undefined ? dash : `${(v * 100).toFixed(0)} %`)

const COLONY: Record<string, string> = {
  survives_independently: 'Survives on its own',
  survives_window_declining: 'Survives, declining',
  failure_after_x_days: 'Fails',
}

interface Col<T> {
  head: string
  cell: (r: T) => string
}

function powerCols(level: number): Col<PowerResponse>[] {
  const cols: Col<PowerResponse>[] = [
    { head: 'Power per m² (W/m²)', cell: (r) => fixed(r.mean_power_w_m2, 0) },
    { head: 'Array power (W)', cell: (r) => fixed(r.mean_power_w, 1) },
    { head: 'Energy (kWh)', cell: (r) => (r.energy_wh === null ? dash : (r.energy_wh / 1000).toFixed(2)) },
  ]
  if (level === 3) {
    cols.push(
      { head: 'Load served', cell: (r) => (r.survives === null ? dash : r.survives ? 'All window' : 'Battery runs out') },
      { head: 'Lowest battery', cell: (r) => pct(r.min_soc) },
    )
  }
  if (level === 4) {
    cols.push(
      { head: 'Colony', cell: (r) => (r.colony_status ? (COLONY[r.colony_status] ?? r.colony_status) : dash) },
      { head: 'Fails after (days)', cell: (r) => fixed(r.failure_after_days, 1) },
      { head: 'Min battery (Wh)', cell: (r) => fixed(r.min_battery_capacity_wh, 0) },
      { head: 'Min panel (m²)', cell: (r) => fixed(r.min_panel_area_m2, 1) },
    )
  }
  return cols
}

function status(a: { loading: boolean; error: string | null }) {
  if (a.error) return a.error
  if (a.loading) return 'Computing…'
  return null
}

export function ModelResults({ places }: { places: ComparedPlace[] }) {
  const applied = useApplied((s) => s.power)
  const answers = usePowerCompare(places)
  if (!applied) return null

  const cols = powerCols({ array: 2, battery: 3, colony: 4 }[applied.model])
  const smooth = answers.some((a) => a.data?.horizon_kind === 'smooth_sphere')

  return (
    <section className="cmp-models" aria-label="Power results">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Power results for each place">
        <table>
          <caption>Power under the applied parameters</caption>
          <thead>
            <tr>
              <th scope="col">Place</th>
              {cols.map((c) => (
                <th key={c.head} scope="col">
                  {c.head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {places.map((p, i) => {
              const a = answers[i]
              const msg = status(a)
              return (
                <tr key={p.num}>
                  <th scope="row">
                    {p.num} {p.info.name}
                  </th>
                  {msg || !a.data ? (
                    <td colSpan={cols.length} className={a.error ? 'error' : 'muted'}>
                      {msg ?? dash}
                    </td>
                  ) : (
                    cols.map((c) => <td key={c.head}>{c.cell(a.data!)}</td>)
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {smooth && <p className="muted small">A place without LOLA terrain uses a smooth-sphere horizon: an estimate, not a bound.</p>}
    </section>
  )
}
