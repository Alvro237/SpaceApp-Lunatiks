/**
 * Site × month map: for every catalogue site with a LOLA horizon, the share of each month of a year with
 * sunlight (or with the Earth in view). Drawn as a real table with a number in every cell, coloured with a
 * colour-blind-safe scale; Enter on a cell opens that site at the start of that month.
 */
import { useId, useMemo, useState } from 'react'
import { useApp } from '../state/store'
import { colorAt, textOn } from '../terrain/colormaps'
import { makeModel } from '../time/engine'
import { evaluateWindow, useEphemeris, useMasks, useParams } from '../time/hooks'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function SiteMonthHeatmap() {
  const id = useId()
  const eph = useEphemeris().data
  const masks = useMasks().data
  const params = useParams()
  const mastM = useApp((s) => s.mastM)
  const startMs = useApp((s) => s.startMs)
  const { select, setStart } = useApp.getState()
  const [year, setYear] = useState(() => Math.min(2035, Math.max(2025, new Date(startMs).getUTCFullYear())))
  const [metric, setMetric] = useState<'sunlightPct' | 'commsPct'>('sunlightPct')
  const [run, setRun] = useState(false)

  const grid = useMemo(() => {
    if (!run || !eph || !masks) return null
    return masks.doc.sites
      .filter((s) => s.terrain.available)
      .map((s) => {
        const { horizon, mastUsedM } = masks.forSite(s, mastM)
        const model = makeModel(s.lat, s.lon, s.terrain.groundHeightM ?? 0, horizon, mastUsedM)
        const months = MONTHS.map((_, m) => {
          const a = Date.UTC(year, m, 1)
          const b = Date.UTC(year, m + 1, 1)
          const w = evaluateWindow(eph.table, model, a, (b - a) / 3_600_000, 120, params)
          return w ? w.metrics : null
        })
        return { site: s, months }
      })
  }, [run, eph, masks, year, mastM, params])

  const cmap = metric === 'sunlightPct' ? 'inferno' : 'viridis'
  return (
    <div className="heatmap">
      <div className="row">
        <div className="field">
          <label htmlFor={`${id}-y`}>Year</label>
          <input id={`${id}-y`} type="number" min={2025} max={2035} value={year} onChange={(e) => setYear(Math.min(2035, Math.max(2025, Number(e.target.value))))} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-m`}>Show</label>
          <select id={`${id}-m`} value={metric} onChange={(e) => setMetric(e.target.value as 'sunlightPct' | 'commsPct')}>
            <option value="sunlightPct">Time sunlit (%)</option>
            <option value="commsPct">Time with the Earth in view (%)</option>
          </select>
        </div>
        {!run && (
          <button type="button" onClick={() => setRun(true)}>
            Compute
          </button>
        )}
      </div>
      {grid && (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Site by month">
          <table className="heat">
            <caption className="sr-only">
              {metric === 'sunlightPct' ? 'Share of each month with any sunlight' : 'Share of each month with the Earth in view'}, {year}, %. Select a cell to open that site and month.
            </caption>
            <thead>
              <tr>
                <th scope="col">Site</th>
                {MONTHS.map((m) => (
                  <th scope="col" key={m}>
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((r) => (
                <tr key={r.site.id}>
                  <th scope="row">{r.site.name}</th>
                  {r.months.map((m, i) => {
                    const v = m ? m[metric] : null
                    const bg = v === null ? 'transparent' : colorAt(cmap, v / 100)
                    return (
                      <td key={i} style={v === null ? undefined : { background: bg, color: textOn(bg) }}>
                        <button
                          type="button"
                          className="cell"
                          onClick={() => {
                            select({ kind: 'site', id: r.site.id })
                            setStart(Date.UTC(year, i, 1))
                          }}
                          aria-label={`${r.site.name}, ${MONTHS[i]} ${year}: ${v === null ? 'no data' : `${v.toFixed(0)} %`}. Open.`}
                        >
                          {v === null ? '—' : v.toFixed(0)}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
