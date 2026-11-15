/**
 * Radar (spider) plot of several places over the same metrics, all on one chart: each place picked is added as
 * one more shape on top of the others. Every axis runs from 0 at the centre to 1 at the rim and points outwards
 * for "better", on an absolute scale stated by its label (not relative to the places shown), so the shape of a
 * place does not change when another place is added.
 *
 * Places are told apart by their number at each vertex, a line pattern and a colour (never colour alone). One place
 * can be highlighted (the others fade). Each axis (its name and its spoke) is a button: hovering or focusing it
 * calls `onAxis` with the axis and its label element, so the caller can explain the axis next to it. The numbers
 * are in the table next to the chart.
 */
import type { FocusEvent, MouseEvent } from 'react'

export interface RadarAxis {
  key: string
  /** Short label printed at the rim. */
  label: string
}

export interface RadarSeries {
  /** 1-based number of the place in the comparison (also its style). */
  num: number
  name: string
  /** One value per axis, 0..1; null when unknown (drawn at the centre and said in the table). */
  values: (number | null)[]
}

const SIZE = 300
const C = SIZE / 2
const R = 96
const RINGS = [0.25, 0.5, 0.75, 1]
/** Side margin for the axis labels ("Steady link", "Short nights"). */
const PAD = 46

const at = (i: number, n: number, v: number): [number, number] => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
  return [C + Math.cos(a) * R * v, C + Math.sin(a) * R * v]
}

export function RadarChart({
  axes,
  series,
  summary,
  highlight = null,
  activeAxis = null,
  onAxis,
  describedBy,
}: {
  axes: RadarAxis[]
  series: RadarSeries[]
  summary: string
  /** Number of the place drawn on top and stronger; the others fade. */
  highlight?: number | null
  /** Axis whose explanation is open. */
  activeAxis?: string | null
  /** Hover or focus on an axis name (with its label element), or null when it ends. */
  onAxis?: (key: string | null, anchor: Element | null) => void
  /** Id of the explanation element, set on the active axis button. */
  describedBy?: string
}) {
  const n = axes.length
  const ordered = highlight === null ? series : [...series.filter((s) => s.num !== highlight), ...series.filter((s) => s.num === highlight)]
  const open = (key: string) => (e: MouseEvent<SVGGElement> | FocusEvent<SVGGElement>) => onAxis?.(key, e.currentTarget)
  const close = () => onAxis?.(null, null)
  return (
    <svg className="radar-svg" viewBox={`${-PAD} 0 ${SIZE + 2 * PAD} ${SIZE - 24}`} role="group" aria-label={summary}>
      <g transform="translate(0 -12)">
        <g aria-hidden="true">
          {RINGS.map((r) => (
            <polygon key={r} className="radar-ring" points={axes.map((_, i) => at(i, n, r).join(',')).join(' ')} />
          ))}
          {axes.map((a, i) => {
            const [x, y] = at(i, n, 1)
            return <line key={a.key} className={`radar-spoke${activeAxis === a.key ? ' is-active' : ''}`} x1={C} y1={C} x2={x} y2={y} />
          })}
          {ordered.map((s) => {
            const pts = s.values.map((v, i) => at(i, n, Math.max(0, Math.min(1, v ?? 0))))
            const cls = highlight === null ? '' : s.num === highlight ? ' is-hl' : ' is-dim'
            return (
              <g key={s.num} className={`radar-series rs-${s.num}${cls}`}>
                <polygon points={pts.map((p) => p.join(',')).join(' ')} />
                {pts.map(([x, y], i) => (
                  <g key={i} className="radar-dot" transform={`translate(${x} ${y})`}>
                    <circle r={6.5} />
                    <text y={3.2} textAnchor="middle">
                      {s.num}
                    </text>
                  </g>
                ))}
              </g>
            )
          })}
        </g>
        {axes.map((a, i) => {
          const [x, y] = at(i, n, 1)
          const [lx, ly] = at(i, n, 1.2)
          const anchor = Math.abs(lx - C) < 8 ? 'middle' : lx > C ? 'start' : 'end'
          const label = (e: MouseEvent<SVGGElement>) => e.currentTarget.querySelector('text') ?? e.currentTarget
          return (
            <g
              key={a.key}
              className={`radar-axis-btn${activeAxis === a.key ? ' is-active' : ''}`}
              role="button"
              tabIndex={onAxis ? 0 : undefined}
              aria-label={`${a.label}: what it means`}
              aria-describedby={activeAxis === a.key ? describedBy : undefined}
              onMouseEnter={(e) => onAxis?.(a.key, label(e))}
              onMouseLeave={close}
              onFocus={open(a.key)}
              onBlur={close}
              onKeyDown={(e) => e.key === 'Escape' && close()}
            >
              {/* the whole spoke (branch) is a hover target too, wider than the drawn line */}
              <line className="radar-spoke-hit" x1={C + (x - C) * 0.12} y1={C + (y - C) * 0.12} x2={x} y2={y} />
              <text className="radar-axis" x={lx} y={ly + 4} textAnchor={anchor}>
                {a.label}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}
