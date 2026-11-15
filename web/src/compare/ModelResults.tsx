/**
 * What the power model and the radio link answered for each compared place, under the parameters applied in the
 * parameters panel. A real table (one row per place), shown only once something is applied. A value the API did
 * not give is a dash, never an estimate; the horizon kind of each answer is shown because a smooth-sphere result
 * is not a bound.
 */
import type { LinkResponse, PowerResponse } from '../api/types'
import { useApplied } from './applied'
import { type PlaceModels, useCompareModels } from './useCompareModels'
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

function linkCols(level: number): Col<LinkResponse>[] {
  const cols: Col<LinkResponse>[] = [
    { head: 'Earth in view', cell: (r) => pct(r.earth_visible_fraction) },
    { head: 'Contact with an antenna', cell: (r) => pct(r.contact_window_fraction) },
    { head: 'Longest blackout (h)', cell: (r) => fixed(r.longest_blackout_h, 1) },
  ]
  if (level === 2) {
    cols.push(
      { head: 'Link closed', cell: (r) => pct(r.budget?.link_window_fraction) },
      { head: 'Longest gap without link (h)', cell: (r) => fixed(r.budget?.longest_link_blackout_h, 1) },
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
  const applied = useApplied()
  const { models } = useCompareModels(places)
  if (!applied.power && !applied.link) return null

  const pCols = applied.power ? powerCols({ array: 2, battery: 3, colony: 4 }[applied.power.model]) : []
  const lCols = applied.link ? linkCols(applied.link.level) : []
  const smooth = models.some((m) => m.power.data?.horizon_kind === 'smooth_sphere' || m.link.data?.horizon_kind === 'smooth_sphere')
  const estimated = new Set(models.flatMap((m) => m.link.data?.estimated_limits ?? []))

  const cells = <T,>(cols: Col<T>[], a: PlaceModels['power'] | PlaceModels['link']) => {
    const msg = status(a)
    const d = a.data as T | null
    if (msg || !d) {
      return (
        <td key="msg" colSpan={cols.length} className={a.error ? 'error' : 'muted'}>
          {msg ?? dash}
        </td>
      )
    }
    return cols.map((c) => <td key={c.head}>{c.cell(d)}</td>)
  }

  return (
    <section className="cmp-models" aria-label="Power and link results">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Power and link results for each place">
        <table>
          <caption>Power and radio link under the applied parameters</caption>
          <thead>
            <tr>
              <th scope="col">Place</th>
              {pCols.map((c) => (
                <th key={c.head} scope="col">
                  {c.head}
                </th>
              ))}
              {lCols.map((c) => (
                <th key={c.head} scope="col">
                  {c.head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {places.map((p, i) => (
              <tr key={p.num}>
                <th scope="row">
                  {p.num} {p.info.name}
                </th>
                {applied.power && cells(pCols, models[i].power)}
                {applied.link && cells(lCols, models[i].link)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(estimated.size > 0 || smooth) && (
        <p className="muted small">
          {estimated.size > 0 ? `Some antenna elevation limits are project estimates, not operator values (${[...estimated].join(', ')}). ` : ''}
          {smooth ? 'A place without LOLA terrain uses a smooth-sphere horizon: an estimate, not a bound.' : ''}
        </p>
      )}
    </section>
  )
}
