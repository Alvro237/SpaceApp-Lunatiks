/**
 * Radar (spider) plot of several places over the same metrics. Every axis runs from 0 at the centre to 1 at the
 * rim and points outwards for "better", on an absolute scale stated by its label (not relative to the places
 * shown), so the shape of a place does not change when another place is added.
 *
 * Places are told apart by their number at each vertex, a line pattern and a colour (never colour alone). The chart
 * is decorative for assistive technology beyond its summary: the numbers are in the table next to it.
 */
import { useId } from 'react'

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
/** Side margin for the axis labels ("Steady contact", "Earth contact"). */
const PAD = 46

const at = (i: number, n: number, v: number): [number, number] => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
  return [C + Math.cos(a) * R * v, C + Math.sin(a) * R * v]
}

export function RadarChart({ axes, series, summary }: { axes: RadarAxis[]; series: RadarSeries[]; summary: string }) {
  const id = useId()
  const n = axes.length
  return (
    <figure className="radar">
      <svg viewBox={`${-PAD} 0 ${SIZE + 2 * PAD} ${SIZE - 24}`} role="img" aria-labelledby={`${id}-s`}>
        <title id={`${id}-s`}>{summary}</title>
        <g transform="translate(0 -12)">
          {RINGS.map((r) => (
            <polygon key={r} className="radar-ring" points={axes.map((_, i) => at(i, n, r).join(',')).join(' ')} />
          ))}
          {axes.map((a, i) => {
            const [x, y] = at(i, n, 1)
            const [lx, ly] = at(i, n, 1.2)
            const anchor = Math.abs(lx - C) < 8 ? 'middle' : lx > C ? 'start' : 'end'
            return (
              <g key={a.key}>
                <line className="radar-spoke" x1={C} y1={C} x2={x} y2={y} />
                <text className="radar-axis" x={lx} y={ly + 4} textAnchor={anchor}>
                  {a.label}
                </text>
              </g>
            )
          })}
          {series.map((s) => {
            const pts = s.values.map((v, i) => at(i, n, Math.max(0, Math.min(1, v ?? 0))))
            return (
              <g key={s.num} className={`radar-series rs-${s.num}`}>
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
      </svg>
      <figcaption className="radar-legend">
        {series.map((s) => (
          <span key={s.num} className={`radar-key rs-${s.num}`}>
            <svg width="26" height="10" aria-hidden="true">
              <line x1="1" y1="5" x2="25" y2="5" />
            </svg>
            <span className="num" aria-hidden="true">
              {s.num}
            </span>
            {s.name}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
