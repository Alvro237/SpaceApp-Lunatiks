/**
 * Live comparison: the places picked while "Compare" is on, side by side at the same instant and over the same
 * window, updating with playback. Numbers match the numbered markers on the map. Computed with the browser
 * engine (POST /api/v1/compare will take over when deployed); ★ marks the best value in each row.
 */
import { useId, useMemo, useState } from 'react'
import { type Selection, sameSelection, useApp } from '../state/store'
import { formatDuration } from '../time/clock'
import { type Metrics, type Sample, type Transition, evaluateAt, nextTransition } from '../time/engine'
import { evaluateWindow, useEphemeris, useMasks, useParams, useSiteNames, useThrottledTime } from '../time/hooks'
import { type ModelInfo, placeModel } from '../time/place'
import { SiteMonthHeatmap } from '../charts/SiteMonthHeatmap'

interface Column {
  sel: Selection
  info: ModelInfo
  now: Sample | null
  nextSun: Transition | null
  nextEarth: Transition | null
  metrics: Metrics | null
}

type Row = { label: string; value: (c: Column) => number | null; text: (v: number, c: Column) => string; best?: 'max' | 'min' }

const ROWS: Row[] = [
  { label: 'Sun now', value: (c) => c.now?.sun.fraction ?? null, text: (v, c) => `${Math.round(v * 100)} % · ${c.now!.sun.el.toFixed(1)}°`, best: 'max' },
  { label: 'Earth now', value: (c) => c.now?.earth.fraction ?? null, text: (v, c) => `${Math.round(v * 100)} % · ${c.now!.earth.el.toFixed(1)}°`, best: 'max' },
  {
    label: 'Sun changes in',
    value: (c) => (c.nextSun ? c.nextSun.inMs : null),
    text: (v, c) => `${c.nextSun!.kind === 'set' ? 'sets' : 'rises'} ${formatDuration(v)}`,
  },
  {
    label: 'Earth changes in',
    value: (c) => (c.nextEarth ? c.nextEarth.inMs : null),
    text: (v, c) => `${c.nextEarth!.kind === 'set' ? 'sets' : 'rises'} ${formatDuration(v)}`,
  },
  { label: 'Sunlit (window)', value: (c) => c.metrics?.sunlightPct ?? null, text: (v) => `${v.toFixed(0)} %`, best: 'max' },
  { label: 'Earth in view (window)', value: (c) => c.metrics?.commsPct ?? null, text: (v) => `${v.toFixed(0)} %`, best: 'max' },
  { label: 'Longest dark', value: (c) => c.metrics?.longestDarkH ?? null, text: (v) => `${v.toFixed(0)} h`, best: 'min' },
  { label: 'Longest without Earth', value: (c) => c.metrics?.longestBlackoutH ?? null, text: (v) => `${v.toFixed(0)} h`, best: 'min' },
]

export function CompareLive() {
  const id = useId()
  const compare = useApp((s) => s.compare)
  const selection = useApp((s) => s.selection)
  const playing = useApp((s) => s.playing)
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const mastM = useApp((s) => s.mastM)
  const { removeCompare, clearCompare, select, setCompareMode } = useApp.getState()
  const params = useParams()
  const tMs = useThrottledTime()
  const eph = useEphemeris().data
  const masks = useMasks().data
  const names = useSiteNames()
  const [tab, setTab] = useState<'live' | 'months'>('live')

  const infos = useMemo(() => (masks ? compare.map((sel) => ({ sel, info: placeModel(masks, sel, mastM, names) })) : []), [masks, compare, mastM, names])

  const windows = useMemo(
    () => infos.map(({ info }) => (eph && info ? (evaluateWindow(eph.table, info.model, startMs, durationH, 60, params)?.metrics ?? null) : null)),
    [infos, eph, startMs, durationH, params],
  )
  // Rise and set times need a scan of up to 45 days: during playback, refresh them every 6 simulated hours.
  const coarseT = playing ? Math.floor(tMs / 21_600_000) * 21_600_000 : tMs
  const transitions = useMemo(
    () =>
      infos.map(({ info }) =>
        eph && info && eph.table.covers(coarseT)
          ? { sun: nextTransition(eph.table, info.model, coarseT, 'sun', params), earth: nextTransition(eph.table, info.model, coarseT, 'earth', params) }
          : { sun: null, earth: null },
      ),
    [infos, eph, coarseT, params],
  )

  const cols: Column[] = infos
    .map(({ sel, info }, i) => {
      if (!info) return null
      const now = eph?.table.covers(tMs) ? evaluateAt(eph.table, info.model, tMs, params) : null
      const later = (tr: Transition | null) => (tr && tr.atMs > tMs ? { ...tr, inMs: tr.atMs - tMs } : null)
      return { sel, info, now, nextSun: later(transitions[i]?.sun), nextEarth: later(transitions[i]?.earth), metrics: windows[i] }
    })
    .filter((c): c is Column => c !== null)

  return (
    <section className="compare-live" aria-labelledby={`${id}-h`}>
      <div className="float-head">
        <h2 id={`${id}-h`}>Compare</h2>
        <div role="tablist" aria-label="Comparison views" className="tabs">
          <button role="tab" type="button" aria-selected={tab === 'live'} onClick={() => setTab('live')}>
            Live
          </button>
          <button role="tab" type="button" aria-selected={tab === 'months'} onClick={() => setTab('months')}>
            By month
          </button>
        </div>
        <button type="button" className="icon" onClick={() => setCompareMode(false)} aria-label="Close comparison">
          ✕
        </button>
      </div>
      {tab === 'live' ? (
        <div role="tabpanel" aria-label="Live comparison">
          {cols.length < 2 && <p className="hint">Pick places on the map or in the list to add them (up to 4).</p>}
          {cols.length > 0 && (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Live comparison table">
              <table className="compare-table">
                <caption className="sr-only">Places side by side at the chosen instant and over the mission window; ★ marks the best value</caption>
                <thead>
                  <tr>
                    <td />
                    {cols.map((c, i) => (
                      <th scope="col" key={i} className={sameSelection(c.sel, selection) ? 'is-current' : undefined}>
                        <span className="num" aria-hidden="true">
                          {i + 1}
                        </span>
                        <button type="button" className="link" onClick={() => select(c.sel)}>
                          {c.info.name}
                        </button>
                        <button type="button" className="icon small" onClick={() => removeCompare(i)} aria-label={`Remove ${c.info.name}`}>
                          ✕
                        </button>
                        {c.info.model.horizon.kind === 'smooth_sphere' && <span className="tag">smooth sphere</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r) => {
                    const vals = cols.map(r.value)
                    const known = vals.filter((v): v is number => v !== null)
                    const best = r.best && known.length > 1 ? (r.best === 'max' ? Math.max(...known) : Math.min(...known)) : null
                    return (
                      <tr key={r.label}>
                        <th scope="row">{r.label}</th>
                        {cols.map((c, i) => {
                          const v = vals[i]
                          return (
                            <td key={i}>
                              {v === null ? '—' : r.text(v, c)}
                              {best !== null && v === best && <span className="best"> ★<span className="sr-only"> best</span></span>}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {cols.length > 0 && (
            <button type="button" className="link" onClick={clearCompare}>
              Clear
            </button>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-label="Sites by month">
          <SiteMonthHeatmap />
        </div>
      )}
    </section>
  )
}
