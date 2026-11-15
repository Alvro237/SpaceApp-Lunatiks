/**
 * "Candidate sites" (mission-planner-ui-spec.md section 3.7, Stage B content; mission-design-spec.md section 9.7):
 * the floating right panel shown in mission mode as soon as a suitability answer exists. On top the cell counts in
 * words and numbers, then the map legend, the score weights, the proposed landing sites (rank, score, nearest named
 * feature, pros and cons in words, criteria without data, Show and Study), the funnel and the assumptions.
 */
import { useId } from 'react'
import './planner.css'
import type { SuitabilityResponse, TopSite } from '../api/types'
import type { LinkSummary } from '../panels/linkModel'
import { useAreas } from '../state/areas'
import { usePlannerSiteLinks } from '../state/link'
import { usePanels } from '../state/panels'
import { MAX_COMPARE, useApp } from '../state/store'
import { CloseButton } from '../ui/PanelNav'
import { CATEGORY_TITLE, CRITERION_LABEL } from './plannerInputs'
import { coord, siteTitle } from './sites'

/** Score ramp of the viable cells (design spec 9.6 modes 1 and 4): the ramp's own 0, 0.33, 0.67, 1 ticks, in words. */
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

/** Map legend of the suitability search: every code with its pattern in words (never colour alone). */
export function SuitabilityLegend() {
  return (
    <ul className="area-legend" aria-label="Map legend of the suitability search">
      <li>
        <span className="sw sw-viable" aria-hidden="true" /> Viable, outlined, coloured by score
      </li>
      <li>
        <span className="sw sw-window" aria-hidden="true" /> Fails a mission-window input (hatched)
      </li>
      <li>
        <span className="sw sw-bound" aria-hidden="true" /> Ruled out by the ephemeris bound (cross-hatched)
      </li>
      <li>
        <span className="sw sw-static" aria-hidden="true" /> Fails a map input or the landing radius (dimmed)
      </li>
      <li>
        <span className="sw sw-unknown" aria-hidden="true" /> No data (dotted)
      </li>
      <li>
        <span className="sw sw-region" aria-hidden="true" /> Search region (ring)
      </li>
    </ul>
  )
}

const fmtKm2 = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))
const pct = (v: number) => `${Math.round(v * 100)} %`

/** Category ids, highest weight first. */
const byWeight = (cats: string[], w: Record<string, number>) => [...cats].sort((x, y) => (w[y] ?? 0) - (w[x] ?? 0)).join(',')

/** Hides the panel; the planner's "Show candidate sites" button and the next answer bring it back. */
function CloseResults() {
  return <CloseButton label="Close candidate sites" esc={false} onClick={() => usePanels.getState().setResultsOpen(false)} />
}

export function ResultsPanel({ titleId }: { titleId: string }) {
  const a = useAreas()
  if (!a.suit) {
    return (
      <div className="results-empty">
        <div className="results-head">
          <h2 id={titleId}>Candidate sites</h2>
          <CloseResults />
        </div>
        <p className="muted pad">No search yet: set a region and switch on at least one category in the planner panel.</p>
      </div>
    )
  }
  return <Results r={a.suit} titleId={titleId} />
}

/** The link budget at one proposed site, for the user's radio (Earth link, "Show the link budget"): the hours with a closed link
 * and the margin. The margin is the same at every site (the search cannot rank by it); here it says whether this one closes. */
function SiteLink({ link }: { link: LinkSummary }) {
  const pctText = (f: number) => `${f * 100 >= 99.95 || f * 100 < 0.05 ? (f * 100).toFixed(0) : (f * 100).toFixed(1)} %`
  return (
    <span className="site-link">
      <span aria-hidden="true">📡 </span>Link budget: closed {pctText(link.linkFraction)} of the window · longest gap {link.gapHours.toFixed(0)} h
      {link.margin ? ` · best margin ${link.margin.max.toFixed(1)} dB (needs +${link.needMarginDb} dB)` : ' · no antenna in contact'}
    </span>
  )
}

function SiteItem({ s, landing, link }: { s: TopSite; landing: boolean; link: LinkSummary | null }) {
  const a = useAreas()
  const selected = a.compareSelected.includes(s.rank)
  const atLimit = a.compareSelected.length >= MAX_COMPARE
  const catLabel = (c: string) => s.categories.find((x) => x.category === c)?.label ?? CATEGORY_TITLE[c] ?? c
  const critLabel = (id: string) => s.criteria.find((x) => x.id === id)?.label ?? CRITERION_LABEL[id] ?? id
  return (
    <li className={a.focus === s.rank ? 'is-focus' : ''}>
      <div className="area-main">
        <strong>
          #{s.rank} · {siteTitle(s)}
        </strong>
        <span className="muted">
          score {pct(s.score)}
          {landing ? ` · worst in the landing ellipse ${pct(s.area_score)}` : ''}
          {s.coverage < 0.995 ? ` · data for ${pct(s.coverage)} of the weight` : ''}
        </span>
        {s.categories.length > 0 && (
          <ul className="site-cats">
            {s.categories.map((c) => (
              <li key={c.category}>
                <span className="site-cat-label">{c.label}</span>
                <span className="site-bar" aria-hidden="true">
                  <span style={{ width: `${Math.round((c.utility ?? 0) * 100)}%` }} />
                </span>
                <span className="site-cat-value">{c.utility == null ? 'no data' : pct(c.utility)}</span>
              </li>
            ))}
          </ul>
        )}
        {s.pros.length > 0 && (
          <span>
            <span aria-hidden="true">✓ </span>Strong: {s.pros.map(catLabel).join(', ')}
          </span>
        )}
        {s.cons.length > 0 && (
          <span>
            <span aria-hidden="true">✗ </span>Weak: {s.cons.map(catLabel).join(', ')}
          </span>
        )}
        {link && <SiteLink link={link} />}
        {s.unknown.length > 0 && (
          <span className="muted">
            <span aria-hidden="true">? </span>No data: {s.unknown.map(critLabel).join(', ')}
          </span>
        )}
        <span className="muted small-note">
          {coord(s.lat, s.lon)}
          {s.window_exact === true ? ' · window checked at the spot with its own LOLA horizon' : s.window_exact === false ? ' · window values from the nearest sample' : ''}
          {s.rank <= 10 ? ` · red flag ${s.rank} on the map` : ''}
        </span>
      </div>
      <div className="area-actions">
        <button
          type="button"
          className="small"
          aria-label={`Show site ${s.rank} on the map`}
          onClick={() => {
            a.set({ focus: s.rank })
            a.look(s.lat, s.lon, 12)
          }}
        >
          Show
        </button>
        <button
          type="button"
          className="small"
          aria-pressed={selected}
          aria-label={`${selected ? 'Deselect' : 'Select'} site ${s.rank} for comparison`}
          title={selected ? 'Selected for comparison' : 'Select for comparison'}
          disabled={!selected && atLimit}
          onClick={() => a.toggleCompareSelected(s.rank)}
        >
          Study
        </button>
      </div>
    </li>
  )
}

function Results({ r, titleId }: { r: SuitabilityResponse; titleId: string }) {
  const a = useAreas()
  const id = useId()
  const cellKm2 = (r.grid.cell_m / 1000) ** 2
  const n = (k: keyof SuitabilityResponse['counts']) => r.counts[k] ?? 0
  const compareCount = a.compareSelected.length
  const landing = a.suitRequest?.landing_radius_km != null
  // the link budget of each proposed site (only while "Show the link budget" is on), for the window of this answer
  const req = a.suitRequest
  const siteLinks = usePlannerSiteLinks(r.sites, req ? { startIso: req.start, durationH: req.duration_h } : null)
  // the map follows the priorities at once; the sites were ranked with the order of the request
  const cats = r.layers.map((l) => l.category)
  const stale = cats.length > 1 && byWeight(cats, r.weights) !== byWeight(cats, a.weights)
  // Reuses Study + Multiselect's own comparison (ComparePanel), as the Stage A areas did.
  const compareSelected = () => {
    const picks = r.sites
      .filter((s) => a.compareSelected.includes(s.rank))
      .map((s) => ({ kind: 'point' as const, lat: Math.round(s.lat * 1e4) / 1e4, lon: Math.round(s.lon * 1e4) / 1e4 }))
    useApp.setState({ compare: picks.slice(0, MAX_COMPARE), compareMode: true })
  }
  const counts: [string, number, string][] = [
    ['Viable', n('viable'), `≈ ${fmtKm2(n('viable') * cellKm2)} km²`],
    ['Fail a map input or the landing radius', n('failed_static'), ''],
    ['Fail a mission-window input (sampled)', n('failed_window'), ''],
    ['Ruled out by the ephemeris bound', n('failed_bound'), ''],
    ['No data', n('unknown'), ''],
  ]
  return (
    <div className="results" aria-live="polite">
      <div className="results-head">
        <h2 id={titleId} className="ios-header">
          Candidate sites
          <span className="muted small-note">
            {r.seconds.toFixed(1)} s{r.window ? ` · ${r.window.samples} horizons` : ''}
          </span>
        </h2>
        <CloseResults />
      </div>
      <table className="cell-counts">
        <caption className="sr-only">Cells of the search region by outcome</caption>
        <tbody>
          {counts.map(([label, v, extra]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>
                {v.toLocaleString('en')} cells{extra ? ` (${extra})` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <SuitabilityLegend />

      <h3 className="ios-header">Score</h3>
      {r.layers.length === 0 ? (
        <p className="fine">No category with a score is on: every viable cell scores 1. Switch on Power or Earth link, or set a limit that scores.</p>
      ) : (
        <ul className="fine score-weights">
          {r.layers.map((l) => (
            <li key={l.category}>
              <strong>
                {l.label} {pct(a.weights[l.category] ?? l.weight)}
              </strong>
              : {l.measure}
            </li>
          ))}
        </ul>
      )}
      {stale && (
        <p className="fine" role="status">
          The map follows the new priorities; the sites below are still ranked with the previous ones.{' '}
          <button type="button" className="small" onClick={() => a.set({ rerankSeq: a.rerankSeq + 1 })}>
            Re-rank the sites
          </button>
        </p>
      )}

      <h3 className="ios-header">
        Proposed landing sites
        <button
          type="button"
          className="small header-link"
          disabled={compareCount < 2}
          onClick={compareSelected}
          title={compareCount < 2 ? 'Select at least two sites first (their own Study button)' : undefined}
        >
          Compare selected{compareCount > 0 ? ` (${compareCount})` : ''}
        </button>
      </h3>
      {r.sites.length === 0 ? (
        <p className="muted pad">No cell passes every input. The funnel below shows which input removed the most.</p>
      ) : (
        <ol className="area-list">
          {r.sites.map((s, i) => (
            <SiteItem key={s.rank} s={s} landing={landing} link={siteLinks.links[i] ?? null} />
          ))}
        </ol>
      )}
      {siteLinks.on && siteLinks.problem && (
        <p className="error link-hint" role="status">
          Link budget for the sites: {siteLinks.problem}
        </p>
      )}
      {r.sites_dropped > 0 && (
        <p className="fine">
          {r.sites_dropped} more candidate{r.sites_dropped > 1 ? 's' : ''} failed a mission-window input when checked at the spot with its own horizon, and{' '}
          {r.sites_dropped > 1 ? 'were' : 'was'} dropped.
        </p>
      )}

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
              <tr key={`${f.stage}-${f.id}`}>
                <th scope="row">
                  {CRITERION_LABEL[f.id] ?? f.id}
                  {(f.stage === 'window' || f.stage === 'bound') && <span className="win-tag"> {f.stage}</span>}
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
