/**
 * Comparison, as a section of the place panel: the places picked while "Compare" is on, one card each, at the same
 * instant and over the same window, updating with playback. Numbers match the numbered markers on the map.
 *
 * Each card shows the window metrics (sunlit, Earth in view, longest dark, longest without Earth) with a mini bar
 * that is relative to the other places, and the best value carries a star and the word "Best" (never colour alone).
 * The same numbers are in a table behind the cards. Computed with the browser engine (POST /api/v1/compare will
 * take over when deployed).
 */
import { useId, useMemo, useState } from 'react'
import { SiteMonthHeatmap } from '../charts/SiteMonthHeatmap'
import { DataTable } from '../charts/DataTable'
import { type Selection, sameSelection, useApp } from '../state/store'
import { formatDuration } from '../time/clock'
import { type Metrics, type Sample, type Transition, evaluateAt, nextTransition } from '../time/engine'
import { evaluateWindow, useEphemeris, useMasks, useParams, useSiteNames, useThrottledTime } from '../time/hooks'
import { type ModelInfo, placeModel } from '../time/place'

interface Column {
  sel: Selection
  info: ModelInfo
  now: Sample | null
  nextSun: Transition | null
  nextEarth: Transition | null
  metrics: Metrics | null
}

type Tone = 'sun' | 'earth' | 'plain'
interface Row {
  label: string
  value: (c: Column) => number | null
  text: (v: number, c: Column) => string
  best?: 'max' | 'min'
  /** Mini bar, 0..1, relative to the other places (only on window metrics). */
  bar?: (v: number, all: number[]) => number
  tone?: Tone
}

const share = (v: number) => v / 100
const ofLargest = (v: number, all: number[]) => (all.length === 0 || Math.max(...all) <= 0 ? 0 : v / Math.max(...all))

const WINDOW_ROWS: Row[] = [
  { label: 'Sunlit', value: (c) => c.metrics?.sunlightPct ?? null, text: (v) => `${v.toFixed(0)} %`, best: 'max', bar: share, tone: 'sun' },
  { label: 'Earth in view', value: (c) => c.metrics?.commsPct ?? null, text: (v) => `${v.toFixed(0)} %`, best: 'max', bar: share, tone: 'earth' },
  { label: 'Longest dark', value: (c) => c.metrics?.longestDarkH ?? null, text: (v) => `${v.toFixed(0)} h`, best: 'min', bar: ofLargest },
  { label: 'Longest without Earth', value: (c) => c.metrics?.longestBlackoutH ?? null, text: (v) => `${v.toFixed(0)} h`, best: 'min', bar: ofLargest },
]
const NOW_ROWS: Row[] = [
  { label: 'Sun now', value: (c) => c.now?.sun.fraction ?? null, text: (v, c) => `${Math.round(v * 100)} % · ${c.now!.sun.el.toFixed(1)}°`, best: 'max' },
  { label: 'Earth now', value: (c) => c.now?.earth.fraction ?? null, text: (v, c) => `${Math.round(v * 100)} % · ${c.now!.earth.el.toFixed(1)}°`, best: 'max' },
  {
    label: 'Sun changes',
    value: (c) => (c.nextSun ? c.nextSun.inMs : null),
    text: (v, c) => `${c.nextSun!.kind === 'set' ? 'sets' : 'rises'} in ${formatDuration(v)}`,
  },
  {
    label: 'Earth changes',
    value: (c) => (c.nextEarth ? c.nextEarth.inMs : null),
    text: (v, c) => `${c.nextEarth!.kind === 'set' ? 'sets' : 'rises'} in ${formatDuration(v)}`,
  },
]

/** The best value of a row among the places that have one; null when there is nothing to rank. */
function bestOf(r: Row, vals: (number | null)[]): number | null {
  const known = vals.filter((v): v is number => v !== null)
  if (!r.best || known.length < 2) return null
  return r.best === 'max' ? Math.max(...known) : Math.min(...known)
}

export function ComparePanel() {
  const id = useId()
  const compare = useApp((s) => s.compare)
  const selection = useApp((s) => s.selection)
  const playing = useApp((s) => s.playing)
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const mastM = useApp((s) => s.mastM)
  const { removeCompare, clearCompare, select } = useApp.getState()
  const params = useParams()
  const tMs = useThrottledTime()
  const eph = useEphemeris().data
  const masks = useMasks().data
  const names = useSiteNames()
  const [view, setView] = useState<'sites' | 'months'>('sites')

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

  const allRows = [...WINDOW_ROWS, ...NOW_ROWS]

  return (
    <div className="compare-body">
      <div className="seg" role="radiogroup" aria-label="Comparison view">
        {(
          [
            ['sites', 'Sites'],
            ['months', 'By month'],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className={`seg-item${view === v ? ' is-on' : ''}`}>
            <input type="radio" name={`${id}-view`} checked={view === v} onChange={() => setView(v)} />
            <span>{label}</span>
          </label>
        ))}
      </div>

      {view === 'months' ? (
        <div className="cmp-months">
          <SiteMonthHeatmap />
        </div>
      ) : (
        <>
          {cols.length < 2 && <p className="cmp-empty">Add {cols.length === 0 ? 'places' : 'another place'} from the map or the list (up to 4).</p>}
          <div className="cmp-grid">
            {cols.map((c, i) => {
              const current = sameSelection(c.sel, selection)
              return (
                <article key={i} className={`cmp-card${current ? ' is-current' : ''}`} aria-labelledby={`${id}-c${i}`}>
                  <header className="cmp-head">
                    <span className="num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <button type="button" id={`${id}-c${i}`} className="cmp-name" onClick={() => select(c.sel)} aria-current={current ? 'true' : undefined}>
                      {c.info.name}
                    </button>
                    <button type="button" className="icon small" onClick={() => removeCompare(i)} aria-label={`Remove ${c.info.name}`}>
                      ✕
                    </button>
                  </header>
                  {c.info.model.horizon.kind === 'smooth_sphere' && <span className="tag">smooth sphere</span>}
                  <CardRows title="Window" rows={WINDOW_ROWS} cols={cols} col={c} idx={i} />
                  <CardRows title="Now" rows={NOW_ROWS} cols={cols} col={c} idx={i} />
                </article>
              )
            })}
          </div>
          {cols.length > 0 && (
            <>
              <DataTable
                summary="Table"
                caption="Places side by side at the chosen instant and over the mission window"
                head={['Metric', ...cols.map((c, i) => `${i + 1} ${c.info.name}`)]}
                rows={allRows.map((r) => {
                  const vals = cols.map(r.value)
                  const best = bestOf(r, vals)
                  return [r.label, ...cols.map((c, i) => (vals[i] === null ? '—' : `${r.text(vals[i] as number, c)}${best !== null && vals[i] === best ? ' (best)' : ''}`))]
                })}
              />
              <button type="button" className="link" onClick={clearCompare}>
                Clear all
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}

function CardRows({ title, rows, cols, col, idx }: { title: string; rows: Row[]; cols: Column[]; col: Column; idx: number }) {
  return (
    <>
      <h4 className="cmp-sub">{title}</h4>
      <dl className="cmp-metrics">
        {rows.map((r) => {
          const vals = cols.map(r.value)
          const v = vals[idx]
          const best = bestOf(r, vals)
          const known = vals.filter((x): x is number => x !== null)
          return (
            <div key={r.label} className="cmp-metric">
              <dt>{r.label}</dt>
              <dd>
                <span className="cmp-val">{v === null ? '—' : r.text(v, col)}</span>
                {best !== null && v === best && (
                  <span className="best">
                    ★<span className="cmp-best-word"> Best</span>
                  </span>
                )}
                {r.bar && v !== null && (
                  <span className={`cmp-bar cmp-bar-${r.tone ?? 'plain'}`} aria-hidden="true">
                    <i style={{ width: `${Math.round(Math.max(0, Math.min(1, r.bar(v, known))) * 100)}%` }} />
                  </span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>
    </>
  )
}
