/**
 * Multiselect comparison: the side panel that opens once two or more places are picked with Multiselect on.
 *
 *   1. The places, numbered as on the map, each with a remove button (the keyboard route to what a right click
 *      on the map does).
 *   2. A radar plot of the metrics that decide a landing site, every axis on an absolute 0..1 scale.
 *   3. A Sunlight / Earth switch and, under it, one strip per place on the window's time axis: when the place is
 *      sunlit (or sees the Earth), like the strips under the map for a single place, with its share of the window.
 *
 * Same instant and window for every place, computed with the browser engine (the same tables and masks as the
 * rest of the navigator). The numbers behind both charts are in a table.
 */
import { type MouseEvent, useId, useMemo, useState } from 'react'
import { DataTable } from '../charts/DataTable'
import { type RadarAxis, RadarChart } from '../charts/RadarChart'
import { type Selection, sameSelection, useApp } from '../state/store'
import { formatUtc } from '../time/clock'
import { MS_PER_DAY, MS_PER_HOUR, SOLAR_CONSTANT_W_M2 } from '../time/engine'
import { type WindowSeries, evaluateWindow, useEphemeris, useMasks, useParams, useSiteNames, useThrottledTime } from '../time/hooks'
import { type ModelInfo, placeModel } from '../time/place'
import { IconAntenna, IconClose, IconMore, IconSun } from '../ui/icons'
import { openMenuFrom } from '../panels/PlaceMenu'

interface Place {
  num: number
  sel: Selection
  info: ModelInfo
  win: WindowSeries | null
}

/** The radar's axes: what a planner wants more of, each on a fixed scale that the label states. */
const AXES: (RadarAxis & { value: (w: WindowSeries) => number; text: (w: WindowSeries) => string })[] = [
  { key: 'sun', label: 'Sunlight', value: (w) => w.metrics.sunlightPct / 100, text: (w) => `${w.metrics.sunlightPct.toFixed(0)} % of the window` },
  { key: 'earth', label: 'Earth contact', value: (w) => w.metrics.commsPct / 100, text: (w) => `${w.metrics.commsPct.toFixed(0)} % of the window` },
  {
    key: 'night',
    label: 'Short nights',
    value: (w) => 1 - Math.min(1, w.metrics.longestDarkH / Math.max(1, w.metrics.windowHours)),
    text: (w) => `longest night ${w.metrics.longestDarkH.toFixed(0)} h`,
  },
  {
    key: 'blackout',
    label: 'Steady contact',
    value: (w) => 1 - Math.min(1, w.metrics.longestBlackoutH / Math.max(1, w.metrics.windowHours)),
    text: (w) => `longest blackout ${w.metrics.longestBlackoutH.toFixed(0)} h`,
  },
  {
    key: 'power',
    label: 'Power',
    value: (w) => Math.min(1, w.metrics.meanPowerWm2 / SOLAR_CONSTANT_W_M2),
    text: (w) => `${w.metrics.meanPowerWm2.toFixed(0)} W/m² mean`,
  },
]

type Strip = 'sun' | 'earth'

export function ComparePanel({ titleId }: { titleId: string }) {
  const id = useId()
  const compare = useApp((s) => s.compare)
  const selection = useApp((s) => s.selection)
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const mastM = useApp((s) => s.mastM)
  const { select, removePlace, setCompareMode } = useApp.getState()
  const params = useParams()
  const tMs = useThrottledTime()
  const eph = useEphemeris().data
  const masks = useMasks().data
  const names = useSiteNames()
  const [strip, setStrip] = useState<Strip>('sun')

  const places: Place[] = useMemo(() => {
    if (!masks) return []
    return compare
      .map((sel, i) => {
        const info = placeModel(masks, sel, mastM, names)
        if (!info) return null
        const win = eph ? evaluateWindow(eph.table, info.model, startMs, durationH, 60, params) : null
        return { num: i + 1, sel, info, win }
      })
      .filter((p): p is Place => p !== null)
  }, [masks, compare, mastM, names, eph, startMs, durationH, params])

  const endMs = startMs + durationH * MS_PER_HOUR
  const ready = places.filter((p) => p.win)
  const best = (key: string) => {
    const axis = AXES.find((a) => a.key === key)!
    const vals = ready.map((p) => axis.value(p.win!))
    return vals.length > 1 ? Math.max(...vals) : null
  }
  const summary =
    `Radar of ${places.length} places over ${AXES.map((a) => a.label.toLowerCase()).join(', ')}, outward is better. ` +
    ready.map((p) => `${p.num} ${p.info.name}: ${AXES.map((a) => a.text(p.win!)).join(', ')}`).join('. ')

  return (
    <div className="multi">
      <div className="multi-head">
        <h2 id={titleId} className="multi-title" tabIndex={-1}>
          Comparing {places.length} places
        </h2>
        <button type="button" className="icon" onClick={() => setCompareMode(false)} aria-label="Close comparison and leave multiselect" title="Leave multiselect">
          <IconClose size={18} />
        </button>
      </div>

      <ol className="multi-places" aria-label="Places compared">
        {places.map((p) => {
          const current = sameSelection(p.sel, selection)
          return (
            <li key={p.num} className={current ? 'is-current' : undefined}>
              <span className="num" aria-hidden="true">
                {p.num}
              </span>
              <button type="button" className="multi-name" onClick={() => select(p.sel)} aria-current={current ? 'true' : undefined} title={p.info.name}>
                {p.info.name}
              </button>
              {p.info.model.horizon.kind === 'smooth_sphere' && <span className="tag-pill">smooth sphere</span>}
              <button
                type="button"
                className="icon small"
                aria-haspopup="dialog"
                aria-label={`Options for ${p.info.name}`}
                title="Rename, pointer colour, remove"
                onClick={(e) => openMenuFrom(e.currentTarget, { sel: p.sel, name: p.info.name })}
              >
                <IconMore size={14} />
              </button>
              <button type="button" className="icon small" onClick={() => removePlace(p.sel, p.info.name)} aria-label={`Remove ${p.info.name}`}>
                <IconClose size={14} />
              </button>
            </li>
          )
        })}
      </ol>

      {ready.length >= 2 ? (
        <RadarChart axes={AXES} series={ready.map((p) => ({ num: p.num, name: p.info.name, values: AXES.map((a) => a.value(p.win!)) }))} summary={summary} />
      ) : (
        <p className="muted">Computing…</p>
      )}

      <div className="seg multi-switch" role="radiogroup" aria-label="Compare over time">
        {(
          [
            ['sun', 'Sunlight', <IconSun key="s" size={16} />],
            ['earth', 'Earth', <IconAntenna key="e" size={16} />],
          ] as const
        ).map(([v, label, icon]) => (
          <label key={v} className={`seg-item${strip === v ? ' is-on' : ''}`}>
            <input type="radio" name={`${id}-strip`} checked={strip === v} onChange={() => setStrip(v)} />
            <span className="seg-icon">
              {icon} {label}
            </span>
          </label>
        ))}
      </div>

      <Strips places={ready} strip={strip} startMs={startMs} endMs={endMs} durationH={durationH} tMs={tMs} best={best(strip === 'sun' ? 'sun' : 'earth')} />

      <DataTable
        summary="Table"
        caption={`Places compared over the window from ${formatUtc(startMs)} (${Math.round(durationH / 24)} days)`}
        head={['Place', ...AXES.map((a) => a.label)]}
        rows={ready.map((p) => [`${p.num} ${p.info.name}`, ...AXES.map((a) => a.text(p.win!))])}
      />
    </div>
  )
}

const W = 560
const ROW = 20
const LEFT = 0

/** One strip per place over the window, with its share of the window on the right and the playback cursor. */
function Strips({
  places,
  strip,
  startMs,
  endMs,
  durationH,
  tMs,
  best,
}: {
  places: Place[]
  strip: Strip
  startMs: number
  endMs: number
  durationH: number
  tMs: number
  best: number | null
}) {
  const id = useId()
  const setTime = useApp((s) => s.setTime)
  const x = (t: number) => LEFT + ((t - startMs) / (endMs - startMs)) * W
  const H = places.length * (ROW + 16) + 20
  const ticks: number[] = []
  const days = durationH / 24
  const every = days <= 3 ? 0.5 : days <= 14 ? 2 : days <= 60 ? 7 : 30
  for (let d = 0; d <= days + 1e-9; d += every) ticks.push(startMs + d * MS_PER_DAY)
  const seek = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const fx = ((e.clientX - r.left) / r.width) * W
    setTime(startMs + (Math.max(0, Math.min(W, fx)) / W) * (endMs - startMs))
  }
  const what = strip === 'sun' ? 'sunlit' : 'in view of the Earth'

  return (
    <svg
      className={`multi-strips is-${strip}`}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`When each place is ${what}: ${places
        .map((p) => `${p.num} ${p.info.name} ${(strip === 'sun' ? p.win!.metrics.sunlightPct : p.win!.metrics.commsPct).toFixed(0)} %`)
        .join(', ')}.`}
      onClick={seek}
    >
      <defs>
        <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" className="hatch-bg" />
          <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
        </pattern>
      </defs>
      {places.map((p, i) => {
        const y = i * (ROW + 16) + 16
        const ranges = strip === 'sun' ? p.win!.sunlit : p.win!.comms
        const share = strip === 'sun' ? p.win!.metrics.sunlightPct : p.win!.metrics.commsPct
        const isBest = best !== null && share / 100 === best
        return (
          <g key={p.num}>
            <text x={0} y={y - 4} className="strip-label">
              {`${p.num}  ${p.info.name}`}
            </text>
            <text x={W} y={y - 4} textAnchor="end" className="strip-value">
              {`${isBest ? '★ ' : ''}${share.toFixed(0)} %`}
            </text>
            <rect x={0} y={y} width={W} height={ROW - 6} className="row-bg" />
            {ranges.map(([a, b], k) => (
              <rect
                key={k}
                x={x(a)}
                y={y}
                width={Math.max(1.5, x(b) - x(a))}
                height={ROW - 6}
                className={strip === 'sun' ? 'range-sun' : 'range-earth'}
                fill={strip === 'earth' ? `url(#${id}-hatch)` : undefined}
              />
            ))}
          </g>
        )
      })}
      {ticks.map((t) => (
        <text key={t} x={Math.min(W - 30, Math.max(30, x(t)))} y={H - 2} textAnchor="middle" className="strip-tick">
          {new Date(t).toISOString().slice(5, 10)}
        </text>
      ))}
      {tMs >= startMs && tMs <= endMs && <line className="cursor" x1={x(tMs)} x2={x(tMs)} y1={4} y2={H - 14} />}
    </svg>
  )
}
