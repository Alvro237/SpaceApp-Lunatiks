/**
 * Mission mode: hard filters (pass or fail) then a soft score with weights the planner sees and can change
 * (POST /api/v1/candidates/search). A site that fails any filter is out; it does not just score lower.
 *
 * Laid out as grouped lists (iOS style) inside the tool bar's flyout: each registered filter is a row with an icon,
 * its name, an ⓘ with what it checks, and a switch; switching it on reveals its thresholds, each with its unit.
 * Weights are sliders with the share in %, the search options a segmented control and a switch. Every result says
 * pass, fail or unknown in words and symbols, never colour alone.
 */
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { isMissing } from '../api/client'
import { useCandidateSearch, useConstraints } from '../api/hooks'
import type { Candidate, ConstraintResult } from '../api/types'
import { useApp } from '../state/store'
import { isoMinute } from '../time/clock'
import { ApiStatus } from '../ui/ApiStatus'
import {
  IconAntenna,
  IconBattery,
  IconClock,
  IconCrater,
  IconMountain,
  IconRadiation,
  IconRock,
  IconSearch,
  IconSliders,
  IconSun,
  IconThermo,
} from '../ui/icons'
import { Tip } from '../ui/Tip'
import { FILTER_SPECS, type FieldSpec, type FilterIcon, buildThreshold } from './filterSpecs'

const verdict = (p: boolean | null) =>
  p === true ? { s: '✓', w: 'pass', c: 'pass' } : p === false ? { s: '✗', w: 'fail', c: 'fail' } : { s: '?', w: 'unknown', c: 'unknown' }

const ICONS: Record<FilterIcon, ReactNode> = {
  slope: <IconMountain size={16} />,
  sun: <IconSun size={16} />,
  radiation: <IconRadiation size={16} />,
  battery: <IconBattery size={16} />,
  thermo: <IconThermo size={16} />,
  earth: <IconAntenna size={16} />,
  crater: <IconCrater size={16} />,
  rock: <IconRock size={16} />,
  clock: <IconClock size={16} />,
}
const TONE: Record<FilterIcon, string> = {
  slope: 'gray',
  sun: 'orange',
  radiation: 'purple',
  battery: 'green',
  thermo: 'red',
  earth: 'blue',
  crater: 'gray',
  rock: 'gray',
  clock: 'blue',
}
const WEIGHT_LABEL: Record<string, { label: string; icon: ReactNode; tone: string; tip: string }> = {
  sunlight: { label: 'Sunlight', icon: <IconSun size={16} />, tone: 'orange', tip: 'Share of the window with the Sun visible.' },
  comms: { label: 'Earth contact', icon: <IconAntenna size={16} />, tone: 'blue', tip: 'Share of the window with the Earth in view.' },
  continuity: { label: 'Continuity', icon: <IconClock size={16} />, tone: 'gray', tip: 'Shorter longest night and blackout score higher.' },
}

export function MissionPanel() {
  const id = useId()
  const meta = useConstraints()
  const search = useCandidateSearch()
  const { startMs, durationH, mastM, panel, commsMinFraction, select } = useApp()
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})
  const [values, setValues] = useState<Record<string, Record<string, string>>>({})
  const [raw, setRaw] = useState<Record<string, string>>({})
  const [weights, setWeights] = useState<Record<string, number> | null>(null)
  const [scope, setScope] = useState<'catalogue' | 'zones'>('catalogue')
  const [unknownPasses, setUnknownPasses] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filters = meta.data ? Object.entries(meta.data.hard_filters) : []
  const w = weights ?? meta.data?.soft_score_default_weights ?? {}
  const wSum = Object.values(w).reduce((a, b) => a + b, 0) || 1
  const onCount = filters.filter(([fid]) => enabled[fid]).length

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const hard: Record<string, Record<string, unknown>> = {}
    for (const [fid] of filters) {
      if (!enabled[fid]) continue
      const spec = FILTER_SPECS[fid]
      if (spec) {
        const t = buildThreshold(spec.fields, values[fid] ?? {})
        if (typeof t === 'string') return setError(`${spec.title}: ${t}`)
        hard[fid] = t
      } else {
        try {
          hard[fid] = JSON.parse(raw[fid] || '{}')
        } catch {
          return setError(`${fid}: the threshold must be JSON`)
        }
      }
    }
    if (Object.keys(hard).length === 0) return setError('Choose at least one hard filter.')
    setError(null)
    search.mutate({
      start: isoMinute(startMs),
      duration_h: durationH,
      mast_m: mastM,
      panel,
      comms_min_fraction: commsMinFraction,
      scope,
      hard_filters: hard,
      weights: w,
      unknown_passes: unknownPasses,
    })
  }

  const setValue = (fid: string, key: string, v: string) => setValues({ ...values, [fid]: { ...values[fid], [key]: v } })

  const field = (fid: string, f: FieldSpec) => {
    const fieldId = `${id}-${fid}-${f.key}`
    const value = values[fid]?.[f.key] ?? ''
    if (f.kind === 'select') {
      return (
        <div className="pfield" key={f.key}>
          <div className="pfield-top">
            <span id={`${fieldId}-l`} className="pfield-label">
              {f.label}
            </span>
            {f.hint && <Tip label={f.label.toLowerCase()}>{f.hint}</Tip>}
          </div>
          <div className="seg" role="radiogroup" aria-labelledby={`${fieldId}-l`}>
            {f.options!.map((o) => (
              <label key={o.value} className={`seg-item${value === o.value ? ' is-on' : ''}`}>
                <input type="radio" name={fieldId} checked={value === o.value} onChange={() => setValue(fid, f.key, o.value)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </div>
      )
    }
    return (
      <div className="pfield" key={f.key}>
        <div className="pfield-top">
          <label htmlFor={fieldId}>
            {f.label}
            {f.optional && <span className="opt"> (optional)</span>}
          </label>
          {f.hint && (
            <Tip label={f.label.toLowerCase()}>
              {f.hint}
              {f.unit ? ` Unit: ${f.unit}.` : ''}
            </Tip>
          )}
        </div>
        <div className="unit-input">
          <input id={fieldId} inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(fid, f.key, e.target.value)} />
          {f.unit && (
            <span className="unit" aria-hidden="true">
              {f.unit}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="panel-section mission">
      {!!meta.error && <ApiStatus error={meta.error} what="Registered filters" />}
      <form onSubmit={submit} noValidate className="mission-form">
        <h3 className="ios-header">
          Must pass{onCount > 0 && <span className="count-pill">{onCount} on</span>}
          <Tip label="hard filters">A site that fails any filter you switch on is out. It does not just score lower.</Tip>
        </h3>
        <div className="ios-list filter-list">
          {filters.map(([fid, doc]) => {
            const spec = FILTER_SPECS[fid]
            const on = !!enabled[fid]
            const icon = spec?.icon ?? 'slope'
            const labelId = `${id}-${fid}-name`
            return (
              <div key={fid} className={`filter-row${on ? ' is-on' : ''}`}>
                <div className="ios-row">
                  <span className={`ios-icon ios-icon-${TONE[icon]}`}>{ICONS[icon]}</span>
                  <span id={labelId} className="ios-label">
                    {spec?.title ?? fid}
                  </span>
                  <Tip label={(spec?.title ?? fid).toLowerCase()}>
                    {spec?.summary ?? ''} <span className="tip-doc">{doc}</span>
                  </Tip>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-labelledby={labelId}
                    className="switch"
                    onClick={() => setEnabled({ ...enabled, [fid]: !on })}
                  >
                    <span className="switch-knob" aria-hidden="true" />
                  </button>
                </div>
                {on && (
                  <div className="filter-fields">
                    {spec ? (
                      <>
                        {spec.fields.filter((f) => !f.key.includes('.')).map((f) => field(fid, f))}
                        {spec.fields.some((f) => f.key.includes('.')) && (
                          <details className="pgroup-d">
                            <summary>
                              <IconThermo size={16} /> Ground properties
                            </summary>
                            {spec.fields.filter((f) => f.key.includes('.')).map((f) => field(fid, f))}
                          </details>
                        )}
                      </>
                    ) : (
                      <div className="pfield">
                        <label htmlFor={`${id}-${fid}-raw`}>Threshold (JSON)</label>
                        <textarea id={`${id}-${fid}-raw`} rows={2} value={raw[fid] ?? ''} onChange={(e) => setRaw({ ...raw, [fid]: e.target.value })} />
                      </div>
                    )}
                    {spec?.help && <p className="fine">{spec.help}</p>}
                  </div>
                )}
              </div>
            )
          })}
          {filters.length === 0 && !meta.error && <p className="muted pad">Loading filters…</p>}
        </div>

        {Object.keys(w).length > 0 && (
          <>
            <h3 className="ios-header">
              Ranking
              <Tip label="the ranking">Among the sites that pass, a weighted mean of these scores. The weights are shown as shares of the total.</Tip>
              {weights && (
                <button type="button" className="link header-link" onClick={() => setWeights(null)}>
                  Reset
                </button>
              )}
            </h3>
            <div className="ios-list">
              {Object.entries(w).map(([k, v]) => {
                const wl = WEIGHT_LABEL[k] ?? { label: k, icon: <IconSliders size={16} />, tone: 'gray', tip: k }
                return (
                  <div className="ios-row stack" key={k}>
                    <div className="ios-row-top">
                      <span className={`ios-icon ios-icon-${wl.tone}`}>{wl.icon}</span>
                      <label htmlFor={`${id}-w-${k}`} className="ios-label">
                        {wl.label}
                      </label>
                      <Tip label={wl.label.toLowerCase()}>{wl.tip}</Tip>
                      <output htmlFor={`${id}-w-${k}`} className="ios-value">
                        {Math.round((v / wSum) * 100)} %
                      </output>
                    </div>
                    <input
                      id={`${id}-w-${k}`}
                      className="ios-slider"
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={v}
                      onChange={(e) => setWeights({ ...w, [k]: Number(e.target.value) })}
                      aria-valuetext={`weight ${v.toFixed(2)}, ${Math.round((v / wSum) * 100)} percent of the score`}
                    />
                  </div>
                )
              })}
            </div>
          </>
        )}

        <h3 className="ios-header">Search</h3>
        <div className="ios-list">
          <div className="ios-row stack">
            <div className="ios-row-top">
              <span id={`${id}-scope-l`} className="ios-label">
                Candidates
              </span>
              <Tip label="candidates">Catalogue: the curated sites. With neighbours: also the screening-grid points around them.</Tip>
            </div>
            <div className="seg" role="radiogroup" aria-labelledby={`${id}-scope-l`}>
              {(
                [
                  ['catalogue', 'Catalogue'],
                  ['zones', 'With neighbours'],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className={`seg-item${scope === v ? ' is-on' : ''}`}>
                  <input type="radio" name={`${id}-scope`} checked={scope === v} onChange={() => setScope(v)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="ios-row">
            <span id={`${id}-unk`} className="ios-label">
              Count “no data” as pass
            </span>
            <Tip label="no data">Off: a filter that cannot be evaluated at a site (no dataset) puts it out. On: it lets it through.</Tip>
            <button type="button" role="switch" aria-checked={unknownPasses} aria-labelledby={`${id}-unk`} className="switch" onClick={() => setUnknownPasses(!unknownPasses)}>
              <span className="switch-knob" aria-hidden="true" />
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="primary search-go" disabled={search.isPending || filters.length === 0}>
          <IconSearch size={17} />
          {search.isPending ? 'Searching…' : 'Find viable sites'}
        </button>
      </form>

      {search.error && <ApiStatus error={search.error} what="Candidate search" fallback={isMissing(search.error) ? 'Coming soon.' : undefined} />}
      {search.data && <Results candidates={search.data.candidates} onShow={(c) => c.site_id && select({ kind: 'site', id: c.site_id })} />}
    </div>
  )
}

function Results({ candidates, onShow }: { candidates: Candidate[]; onShow: (c: Candidate) => void }) {
  const viable = candidates.filter((c) => c.viable).length
  const ids = [...new Set(candidates.flatMap((c) => c.results.map((r) => r.id)))]
  return (
    <div className="results" aria-live="polite">
      <h3 className="ios-header">Results</h3>
      <p className="result-chips">
        <span className="chip-stat pass">
          <span aria-hidden="true">✓</span> {viable} viable
        </span>
        <span className="chip-stat fail">
          <span aria-hidden="true">✗</span> {candidates.length - viable} out
        </span>
      </p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Candidate results">
        <table>
          <caption className="sr-only">Hard-filter results and score per candidate</caption>
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col">Verdict</th>
              {ids.map((i) => (
                <th scope="col" key={i}>
                  {FILTER_SPECS[i]?.title ?? i}
                </th>
              ))}
              <th scope="col">Score</th>
              <th scope="col">
                <span className="sr-only">Show</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c, k) => {
              const v = verdict(c.viable)
              return (
                <tr key={`${c.site_id ?? ''}-${k}`}>
                  <th scope="row">{c.name ?? c.site_id ?? `${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}`}</th>
                  <td className={`verdict ${v.c}`}>
                    <span aria-hidden="true">{v.s}</span> {c.viable ? 'viable' : 'out'}
                  </td>
                  {ids.map((i) => (
                    <ResultCell key={i} r={c.results.find((r) => r.id === i)} />
                  ))}
                  <td>{c.viable && c.score != null ? c.score.toFixed(2) : '—'}</td>
                  <td>
                    {c.site_id && (
                      <button type="button" className="small" onClick={() => onShow(c)}>
                        Show
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ResultCell({ r }: { r?: ConstraintResult }) {
  if (!r) return <td>—</td>
  const v = verdict(r.passed)
  return (
    <td className={`verdict ${v.c}`} title={r.note ?? undefined}>
      <span aria-hidden="true">{v.s}</span> {v.w}
      {r.value != null && <span className="muted"> · {Number(r.value).toFixed(2)}</span>}
      {r.basis === 'unavailable' && <span className="muted"> · no data</span>}
    </td>
  )
}
