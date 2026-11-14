/**
 * Mission mode: hard filters (pass or fail) then a soft score with weights the planner sees and can change
 * (POST /api/v1/candidates/search). A site that fails any filter is out; it does not just score lower.
 * Every result says pass, fail or unknown in words and symbols, never colour alone.
 */
import { type FormEvent, useId, useState } from 'react'
import { isMissing } from '../api/client'
import { useCandidateSearch, useConstraints } from '../api/hooks'
import type { Candidate, ConstraintResult } from '../api/types'
import { useApp } from '../state/store'
import { isoMinute } from '../time/clock'
import { ApiStatus } from '../ui/ApiStatus'
import { FILTER_SPECS, buildThreshold } from './filterSpecs'

const verdict = (p: boolean | null) =>
  p === true ? { s: '✓', w: 'pass', c: 'pass' } : p === false ? { s: '✗', w: 'fail', c: 'fail' } : { s: '?', w: 'unknown', c: 'unknown' }

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

  return (
    <div className="panel-section">
      {!!meta.error && <ApiStatus error={meta.error} what="Registered filters" />}
      <form onSubmit={submit} noValidate>
        {filters.map(([fid, doc]) => {
          const spec = FILTER_SPECS[fid]
          return (
            <fieldset key={fid} className="filter">
              <legend>
                <label>
                  <input type="checkbox" checked={!!enabled[fid]} onChange={(e) => setEnabled({ ...enabled, [fid]: e.target.checked })} />{' '}
                  {spec?.title ?? fid}
                </label>
              </legend>
              {enabled[fid] && (
                <>
                  {spec ? (
                    <div className="grid-fields">
                      {spec.fields.map((f) => (
                        <div className="field stack" key={f.key}>
                          <label htmlFor={`${id}-${fid}-${f.key}`}>
                            {f.label}
                            {f.optional ? ' (optional)' : ''}
                          </label>
                          {f.kind === 'select' ? (
                            <select
                              id={`${id}-${fid}-${f.key}`}
                              value={values[fid]?.[f.key] ?? ''}
                              onChange={(e) => setValues({ ...values, [fid]: { ...values[fid], [f.key]: e.target.value } })}
                            >
                              <option value="">Choose…</option>
                              {f.options!.map((o) => (
                                <option key={o}>{o}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={`${id}-${fid}-${f.key}`}
                              inputMode="decimal"
                              value={values[fid]?.[f.key] ?? ''}
                              onChange={(e) => setValues({ ...values, [fid]: { ...values[fid], [f.key]: e.target.value } })}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="field stack">
                      <label htmlFor={`${id}-${fid}-raw`}>Threshold (JSON)</label>
                      <textarea id={`${id}-${fid}-raw`} rows={2} value={raw[fid] ?? ''} onChange={(e) => setRaw({ ...raw, [fid]: e.target.value })} />
                    </div>
                  )}
                  {spec?.help && <p className="fine">{spec.help}</p>}
                  <details>
                    <summary>Definition</summary>
                    <pre className="doc">{doc}</pre>
                  </details>
                </>
              )}
            </fieldset>
          )
        })}

        {Object.keys(w).length > 0 && (
          <fieldset className="weights">
            <legend>Score weights</legend>
            {Object.entries(w).map(([k, v]) => (
              <div className="field" key={k}>
                <label htmlFor={`${id}-w-${k}`}>{k}</label>
                <input
                  id={`${id}-w-${k}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={v}
                  onChange={(e) => setWeights({ ...w, [k]: Number(e.target.value) })}
                  aria-valuetext={v.toFixed(2)}
                />
                <output htmlFor={`${id}-w-${k}`}>{v.toFixed(2)}</output>
              </div>
            ))}
            {weights && (
              <button type="button" className="link" onClick={() => setWeights(null)}>
                Reset
              </button>
            )}
          </fieldset>
        )}

        <div className="row">
          <div className="field stack">
            <label htmlFor={`${id}-scope`}>Candidates</label>
            <select id={`${id}-scope`} value={scope} onChange={(e) => setScope(e.target.value as 'catalogue' | 'zones')}>
              <option value="catalogue">Catalogue sites</option>
              <option value="zones">Catalogue sites and their neighbours</option>
            </select>
          </div>
          <label className="check">
            <input type="checkbox" checked={unknownPasses} onChange={(e) => setUnknownPasses(e.target.checked)} /> Treat “unknown” (no data) as pass
          </label>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={search.isPending || filters.length === 0}>
          {search.isPending ? 'Searching…' : 'Find viable sites'}
        </button>
      </form>

      {search.error && (
        <ApiStatus
          error={search.error}
          what="Candidate search"
          fallback={isMissing(search.error) ? 'Coming soon.' : undefined}
        />
      )}
      {search.data && <Results candidates={search.data.candidates} onShow={(c) => c.site_id && select({ kind: 'site', id: c.site_id })} />}
    </div>
  )
}

function Results({ candidates, onShow }: { candidates: Candidate[]; onShow: (c: Candidate) => void }) {
  const viable = candidates.filter((c) => c.viable).length
  const ids = [...new Set(candidates.flatMap((c) => c.results.map((r) => r.id)))]
  return (
    <div className="results" aria-live="polite">
      <h3>
        {viable} of {candidates.length} candidates pass every filter
      </h3>
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
