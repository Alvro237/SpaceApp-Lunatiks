/**
 * "Candidate areas" (mission-planner-ui-spec.md section 3.7, Stage A content): the floating right panel shown in
 * mission mode as soon as an answer exists. The areas list and the funnel table are the same as the old
 * `panels/MissionPanel.tsx` `Results`, moved out here now that the left panel is the planner inputs, not a popover.
 */
import { useId } from 'react'
import './planner.css'
import type { AreaSearchResponse } from '../api/types'
import { AreaLegend } from '../panels/MissionPanel'
import { FUNNEL_LABEL } from '../panels/missionFilters'
import { useAreas } from '../state/areas'
import { MAX_COMPARE, useApp } from '../state/store'

/** Score ramp of the viable cells (4.3): the ramp's own 0, 0.33, 0.67, 1 ticks, in words. */
function ScoreLegend() {
  const a = useAreas()
  const id = useId()
  return (
    <div className="score-legend">
      <label className="ios-row-top" htmlFor={`${id}-mode`}>
        <span className="ios-label">Display</span>
        <select id={`${id}-mode`} value={a.areaMode} onChange={(e) => a.set({ areaMode: Number(e.target.value) as 1 | 4 })}>
          <option value={1}>Continuous</option>
          <option value={4}>Colour-blind palette</option>
        </select>
      </label>
      <div className={`score-ramp${a.areaMode === 4 ? ' is-viridis' : ''}`} aria-hidden="true" />
      <div className="score-ticks">
        <span>0 · poor</span>
        <span>0.33</span>
        <span>0.67</span>
        <span>1 · best</span>
      </div>
    </div>
  )
}

const fmtKm2 = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))
const coord = (lat: number, lon: number) => `${Math.abs(lat).toFixed(3)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}° ${lon < 0 ? 'W' : 'E'}`

export function ResultsPanel({ titleId }: { titleId: string }) {
  const a = useAreas()
  if (!a.result) {
    return (
      <div className="results-empty">
        <h2 id={titleId}>Candidate areas</h2>
        <p className="muted pad">No search yet: set a region and switch on at least one input in the planner panel.</p>
      </div>
    )
  }
  return <Results r={a.result} titleId={titleId} />
}

function Results({ r, titleId }: { r: AreaSearchResponse; titleId: string }) {
  const a = useAreas()
  const id = useId()
  const cellKm2 = (r.grid.cell_m / 1000) ** 2
  const viableKm2 = r.counts.viable * cellKm2
  const compareCount = a.compareSelected.length
  const atCompareLimit = compareCount >= MAX_COMPARE
  // Reuses Study + Multiselect's own comparison (ComparePanel): points at the ticked areas' best spots, the same
  // "compare" and "compareMode" the map's Multiselect switch sets, so the same radar and strips render here.
  const compareSelected = () => {
    const picks = r.areas
      .filter((ar) => a.compareSelected.includes(ar.id))
      .map((ar) => ({ kind: 'point' as const, lat: Math.round(ar.best_lat * 1e4) / 1e4, lon: Math.round(ar.best_lon * 1e4) / 1e4 }))
    // compareMode/compare sit outside the generic `set` action's Scene&Prefs type (useApp's own setCompareMode
    // takes no list): setState is zustand's own API, so this is still the same store, not a new code path.
    useApp.setState({ compare: picks.slice(0, MAX_COMPARE), compareMode: true })
  }
  return (
    <div className="results" aria-live="polite">
      <h2 id={titleId} className="ios-header">
        Candidate areas
        <span className="muted small-note">
          {r.seconds.toFixed(1)} s{r.window ? ` · ${r.window.samples} horizons` : ''}
        </span>
      </h2>
      <p className="result-chips">
        <span className="chip-stat pass">
          <span aria-hidden="true">✓</span> ≈ {fmtKm2(viableKm2)} km² viable
        </span>
        <span className="chip-stat fail">
          <span aria-hidden="true">✗</span> {(r.counts.failed_static + r.counts.failed_window).toLocaleString('en')} cells out
        </span>
        {r.counts.unknown > 0 && (
          <span className="chip-stat unknown">
            <span aria-hidden="true">?</span> {r.counts.unknown.toLocaleString('en')} no data
          </span>
        )}
      </p>
      <div className="ios-list">
        <div className="ios-row">
          <span id={`${id}-show`} className="ios-label">
            Paint on the map
          </span>
          <button type="button" role="switch" aria-checked={a.show} aria-labelledby={`${id}-show`} className="switch" onClick={() => a.set({ show: !a.show })}>
            <span className="switch-knob" aria-hidden="true" />
          </button>
        </div>
      </div>
      <ScoreLegend />
      <AreaLegend />

      <h3 className="ios-header">
        Areas found
        <button
          type="button"
          className="small header-link"
          disabled={compareCount < 2}
          onClick={compareSelected}
          title={compareCount < 2 ? 'Select at least two areas first (their own Study button)' : undefined}
        >
          Compare selected{compareCount > 0 ? ` (${compareCount})` : ''}
        </button>
      </h3>
      {r.areas.length === 0 ? (
        <p className="muted pad">No connected area passes every input. The funnel below shows which input removed the most.</p>
      ) : (
        <ol className="area-list">
          {r.areas.map((ar, k) => (
            <li key={ar.id} className={a.focus === ar.id ? 'is-focus' : ''}>
              <div className="area-main">
                <strong>
                  #{k + 1} · {fmtKm2(ar.area_km2)} km²
                </strong>
                <span className="muted">
                  score {Math.round(ar.mean_score * 100)} % (best {Math.round(ar.best_score * 100)} %)
                </span>
                {ar.sites.length > 0 && <span className="muted">{ar.sites.join(', ')}</span>}
                <span className="muted small-note">
                  best spot {coord(ar.best_lat, ar.best_lon)}
                  {k < 10 ? ` · red flag ${k + 1} on the map` : ''}
                </span>
              </div>
              <div className="area-actions">
                <button
                  type="button"
                  className="small"
                  aria-label={`Show area ${k + 1} on the map`}
                  onClick={() => {
                    a.set({ focus: ar.id })
                    a.look(ar.centroid_lat, ar.centroid_lon, Math.max(8, Math.sqrt(ar.area_km2) * 4))
                  }}
                >
                  Show
                </button>
                <button
                  type="button"
                  className="small"
                  aria-pressed={a.compareSelected.includes(ar.id)}
                  aria-label={`${a.compareSelected.includes(ar.id) ? 'Deselect' : 'Select'} area ${k + 1} for comparison`}
                  title={a.compareSelected.includes(ar.id) ? 'Selected for comparison' : 'Select for comparison'}
                  disabled={!a.compareSelected.includes(ar.id) && atCompareLimit}
                  onClick={() => a.toggleCompareSelected(ar.id)}
                >
                  Study
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="fine">Score: share of the window with sunlight and with Earth contact, equal weights (the long-term maps when no window input is on).</p>

      <h3 className="ios-header">Funnel</h3>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Cells removed by each input">
        <table>
          <caption className="sr-only">Cells reaching each input, removed by it, and without data, in the order they ran</caption>
          <thead>
            <tr>
              <th scope="col">Input</th>
              <th scope="col">In</th>
              <th scope="col">Out</th>
              <th scope="col">No data</th>
            </tr>
          </thead>
          <tbody>
            {r.funnel.map((f) => (
              <tr key={f.id}>
                <th scope="row">
                  {FUNNEL_LABEL[f.id] ?? f.id}
                  {f.stage === 'window' && <span className="win-tag"> window</span>}
                </th>
                <td>{f.cells_in.toLocaleString('en')}</td>
                <td>{f.cells_out.toLocaleString('en')}</td>
                <td>{f.cells_unknown.toLocaleString('en')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="pgroup-d">
        <summary>How it was computed</summary>
        <ul className="fine assumptions">
          {r.assumptions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>
    </div>
  )
}
