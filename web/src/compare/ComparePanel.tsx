/**
 * Multiselect comparison: the side panel that opens once two or more places are picked with Multiselect on.
 *
 * One card per place (numbered as on the map), side by side instead of piled on one chart: its own small radar of
 * the metrics that decide a landing site, every axis on an absolute 0..1 scale, with the best of the group drawn
 * as a faint outline behind it, and the same metrics as numbers with a bar and a star for the best place. The card
 * header keeps the place's options and remove button (the keyboard route to what a right click on the map does).
 *
 * When each place is sunlit or sees the Earth is in the timeline under the map: in Multiselect it shows one strip
 * per place on the window's time axis, with a Sunlit / Earth switch.
 *
 * Same instant and window for every place, computed with the browser engine (the same tables and masks as the
 * rest of the navigator). The numbers behind the cards are also in a table.
 */
import { type FocusEvent, type MouseEvent, useId, useState } from 'react'
import { DataTable } from '../charts/DataTable'
import { sameSelection, useApp } from '../state/store'
import { formatUtc } from '../time/clock'
import { SOLAR_CONSTANT_W_M2 } from '../time/engine'
import type { WindowSeries } from '../time/hooks'
import { IconClose, IconMore } from '../ui/icons'
import { openMenuFrom } from '../panels/PlaceMenu'
import { type ComparedPlace, useComparePlaces } from './useComparePlaces'

interface Axis {
  key: string
  label: string
  /** 0..1, outward is better, on an absolute scale (not relative to the places shown). */
  value: (w: WindowSeries) => number
  /** Full sentence for the table and the screen-reader summary. */
  text: (w: WindowSeries) => string
  /** Name of the figure printed on the card (what the number is, not the direction of the axis). */
  cardLabel: string
  /** Compact figure printed on the card. */
  short: (w: WindowSeries) => string
}

/** What a planner wants more of, each on a fixed scale that the label states. */
const AXES: Axis[] = [
  {
    key: 'sun',
    label: 'Sunlight',
    cardLabel: 'Sunlight',
    value: (w) => w.metrics.sunlightPct / 100,
    text: (w) => `${w.metrics.sunlightPct.toFixed(0)} % of the window`,
    short: (w) => `${w.metrics.sunlightPct.toFixed(0)} %`,
  },
  {
    key: 'earth',
    label: 'Earth contact',
    cardLabel: 'Earth contact',
    value: (w) => w.metrics.commsPct / 100,
    text: (w) => `${w.metrics.commsPct.toFixed(0)} % of the window`,
    short: (w) => `${w.metrics.commsPct.toFixed(0)} %`,
  },
  {
    key: 'night',
    label: 'Short nights',
    cardLabel: 'Longest night',
    value: (w) => 1 - Math.min(1, w.metrics.longestDarkH / Math.max(1, w.metrics.windowHours)),
    text: (w) => `longest night ${w.metrics.longestDarkH.toFixed(0)} h`,
    short: (w) => `${w.metrics.longestDarkH.toFixed(0)} h`,
  },
  {
    key: 'blackout',
    label: 'Steady contact',
    cardLabel: 'Longest blackout',
    value: (w) => 1 - Math.min(1, w.metrics.longestBlackoutH / Math.max(1, w.metrics.windowHours)),
    text: (w) => `longest blackout ${w.metrics.longestBlackoutH.toFixed(0)} h`,
    short: (w) => `${w.metrics.longestBlackoutH.toFixed(0)} h`,
  },
  {
    key: 'power',
    label: 'Power',
    cardLabel: 'Mean power',
    value: (w) => Math.min(1, w.metrics.meanPowerWm2 / SOLAR_CONSTANT_W_M2),
    text: (w) => `${w.metrics.meanPowerWm2.toFixed(0)} W/m² mean`,
    short: (w) => `${w.metrics.meanPowerWm2.toFixed(0)} W/m²`,
  },
]

/**
 * What each axis means and which way is better, shown in a small pop-up when the pointer is over an axis of the
 * radar or a metric name (or the metric name has keyboard focus). `comms` is the share of the Earth's disc that
 * counts as contact (the analysis setting).
 */
const HELP: Record<string, { what: (comms: number) => string; better: string; worse: string }> = {
  sun: {
    what: () => 'Share of the window with any part of the Sun above the local horizon.',
    better: 'More sunlight: more solar power and warmth.',
    worse: 'Long stretches in shadow: batteries and heaters must carry the load.',
  },
  earth: {
    what: (c) => `Share of the window with at least ${Math.round(c * 100)} % of the Earth's disc above the horizon (direct radio link).`,
    better: 'More time talking to Earth directly.',
    worse: 'Little direct contact: a relay satellite is needed.',
  },
  night: {
    what: () => 'Longest continuous time without sunlight in the window. On the radar: 1 − longest night ÷ window length.',
    better: 'Short nights: a smaller battery survives them.',
    worse: 'Long nights: the battery and the thermal design must last through them.',
  },
  blackout: {
    what: () => 'Longest continuous time without the Earth in view. On the radar: 1 − longest blackout ÷ window length.',
    better: 'Short gaps: commands and data flow steadily.',
    worse: 'Long blackouts: the lander must work on its own for that long.',
  },
  power: {
    what: () => `Mean sunlight reaching the solar panel over the window, as a share of the solar constant (${SOLAR_CONSTANT_W_M2} W/m²).`,
    better: 'More energy per square metre of panel.',
    worse: 'Low mean power: larger panels are needed.',
  },
}

interface Tip {
  key: string
  left: number
  top: number
  /** Open above the anchor (for anchors in the lower half). */
  above: boolean
}

export function ComparePanel({ titleId }: { titleId: string }) {
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const { setCompareMode } = useApp.getState()
  const places = useComparePlaces()
  const ready = places.filter((p) => p.win)

  // best value per axis among the places (the outline behind each radar and the stars)
  const best = AXES.map((a) => (ready.length ? Math.max(...ready.map((p) => a.value(p.win!))) : 0))

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
      <p className="muted cmp-note">
        Outward on the radar and a longer bar are better on every axis. The faint outline is the best of the group; ★ marks the best place. When each place is sunlit or sees the
        Earth is in the timeline below the map.
      </p>

      <ol className="cmp-cards" aria-label="Places compared">
        {places.map((p) => (
          <PlaceCard key={p.num} p={p} best={best} several={ready.length > 1} />
        ))}
      </ol>

      <DataTable
        summary="Table"
        caption={`Places compared over the window from ${formatUtc(startMs)} (${Math.round(durationH / 24)} days)`}
        head={['Place', ...AXES.map((a) => a.label)]}
        rows={ready.map((p) => [`${p.num} ${p.info.name}`, ...AXES.map((a) => a.text(p.win!))])}
      />
    </div>
  )
}

function PlaceCard({ p, best, several }: { p: ComparedPlace; best: number[]; several: boolean }) {
  const selection = useApp((s) => s.selection)
  const { select, removePlace } = useApp.getState()
  const current = sameSelection(p.sel, selection)
  const values = p.win ? AXES.map((a) => a.value(p.win!)) : null
  const comms = useApp((s) => s.commsMinFraction)
  const tipId = useId()
  const [tip, setTip] = useState<Tip | null>(null)
  // a metric name: open the pop-up under its row, over the metrics column
  const openFromRow = (key: string) => (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const li = e.currentTarget.closest('li') as HTMLElement
    setTip({ key, left: li.offsetLeft, top: li.offsetTop + li.offsetHeight + 4, above: false })
  }
  const close = () => setTip(null)

  return (
    <li className={`cmp-card cmp-c-${p.num}${current ? ' is-current' : ''}`}>
      <div className="cmp-card-head">
        <span className="num" aria-hidden="true">
          {p.num}
        </span>
        <button type="button" className="multi-name" onClick={() => select(p.sel)} aria-current={current ? 'true' : undefined} title={p.info.name}>
          {p.info.name}
        </button>
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
      </div>
      {p.info.model.horizon.kind === 'smooth_sphere' && <span className="tag-pill cmp-tag">smooth sphere horizon</span>}
      {values ? (
        <div className="cmp-body" onMouseLeave={close}>
          <MiniRadar
            num={p.num}
            values={values}
            best={several ? best : null}
            active={tip?.key ?? null}
            onAxis={(key, left, top) => setTip(key ? { key, left, top, above: top > RS * RSCALE * 0.55 } : null)}
            label={`Radar of ${p.num} ${p.info.name}, outward is better: ${AXES.map((a) => `${a.label.toLowerCase()} ${a.text(p.win!)}`).join(', ')}.`}
          />
          <ul className="cmp-metrics">
            {AXES.map((a, i) => {
              const isBest = several && values[i] === best[i]
              const on = tip?.key === a.key
              return (
                <li key={a.key} className={`${isBest ? 'is-best' : ''}${on ? ' is-active' : ''}`.trim() || undefined}>
                  <button
                    type="button"
                    className="cmp-m-label"
                    aria-describedby={on ? tipId : undefined}
                    onMouseEnter={openFromRow(a.key)}
                    onFocus={openFromRow(a.key)}
                    onBlur={close}
                    onKeyDown={(e) => e.key === 'Escape' && close()}
                  >
                    {a.cardLabel}
                  </button>
                  <span className="cmp-m-value">
                    {isBest && (
                      <>
                        <span aria-hidden="true">★ </span>
                        <span className="sr-only">best: </span>
                      </>
                    )}
                    {a.short(p.win!)}
                  </span>
                  <span className="cmp-m-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(2, values[i] * 100)}%` }} />
                  </span>
                </li>
              )
            })}
          </ul>
          {tip && (
            <AxisTip
              id={tipId}
              tip={tip}
              comms={comms}
              label={AXES.find((a) => a.key === tip.key)!.label}
              value={p.win ? AXES.find((a) => a.key === tip.key)!.text(p.win) : null}
            />
          )}
        </div>
      ) : (
        <p className="muted">Computing…</p>
      )}
    </li>
  )
}

/** The explanation pop-up: what the axis measures, then which way is better and worse (words, not colour alone). */
function AxisTip({ id, tip, comms, label, value }: { id: string; tip: Tip; comms: number; label: string; value: string | null }) {
  const h = HELP[tip.key]
  return (
    <div
      id={id}
      role="tooltip"
      className={`cmp-tip${tip.above ? ' is-above' : ''}`}
      style={{ left: tip.left, top: tip.top }}
    >
      <strong className="cmp-tip-title">{label}</strong>
      {value && <span className="cmp-tip-value">Here: {value}</span>}
      <p>{h.what(comms)}</p>
      <p className="cmp-tip-good">
        <span aria-hidden="true">▲</span> <b>Better:</b> {h.better}
      </p>
      <p className="cmp-tip-bad">
        <span aria-hidden="true">▼</span> <b>Worse:</b> {h.worse}
      </p>
    </div>
  )
}

const RS = 120
/** Rendered size of the radar in CSS pixels over its viewBox size (.cmp-radar is 112 px wide). */
const RSCALE = 112 / RS
const RC = RS / 2
const RR = 46
const RINGS = [0.5, 1]
/** Rim labels, short enough for the small radar; the full names are next to it in the metric list. */
const ABBR: Record<string, string> = { sun: 'Sun', earth: 'Earth', night: 'Night', blackout: 'Link', power: 'Power' }

const at = (i: number, n: number, v: number): [number, number] => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
  return [RC + Math.cos(a) * RR * v, RC + Math.sin(a) * RR * v]
}
const poly = (vals: number[]) => vals.map((v, i) => at(i, vals.length, Math.max(0, Math.min(1, v))).join(',')).join(' ')

/**
 * A small radar for one place: short axis names at the rim, the group's best as a faint outline behind it. Hovering
 * an axis (its spoke or its name) reports it with the pop-up's anchor in CSS pixels; the same explanations are
 * reachable from the keyboard through the metric names next to the radar.
 */
function MiniRadar({
  num,
  values,
  best,
  label,
  active,
  onAxis,
}: {
  num: number
  values: number[]
  best: number[] | null
  label: string
  active: string | null
  onAxis: (key: string | null, left: number, top: number) => void
}) {
  const n = values.length
  return (
    <svg className="cmp-radar" viewBox={`0 0 ${RS} ${RS}`} role="img" aria-label={label}>
      {RINGS.map((r) => (
        <polygon key={r} className="radar-ring" points={poly(values.map(() => r))} />
      ))}
      {best && <polygon className="cmp-radar-best" points={poly(best)} />}
      <g className={`radar-series rs-${num}`}>
        <polygon points={poly(values)} />
      </g>
      {AXES.map((a, i) => {
        const [x, y] = at(i, n, 1)
        const [lx, ly] = at(i, n, 1.24)
        const below = ly > RC
        return (
          <g
            key={a.key}
            className={`cmp-axis${active === a.key ? ' is-active' : ''}`}
            onMouseEnter={() => onAxis(a.key, lx * RSCALE, (below ? ly - 8 : ly + 8) * RSCALE)}
          >
            <line className="radar-spoke" x1={RC} y1={RC} x2={x} y2={y} />
            <line className="cmp-axis-hit" x1={RC} y1={RC} x2={lx} y2={ly} />
            <circle className="cmp-axis-hit" cx={lx} cy={ly} r={11} />
            <text className="cmp-radar-axis" x={lx} y={ly + 3.5} textAnchor="middle">
              {ABBR[a.key]}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
