/**
 * 360° horizon chart: the LOLA terrain skyline (or the smooth-sphere dip) with the Sun and Earth discs at
 * their true angular size and their paths over the next 24 hours. Vertical exaggeration is labelled; two insets
 * at true shape show how much of each disc the terrain hides. The numbers are in the table below the chart.
 */
import { useId, useMemo } from 'react'
import type { Horizon } from '../time/engine'
import { useEphemeris } from '../time/hooks'
import { evaluateAt, timeGrid } from '../time/engine'
import type { ModelInfo } from '../time/hooks'
import type { BodyView } from '../panels/useNow'
import { DataTable } from './DataTable'
import { COMPASS, type Viewport, elevationTicks, horizonPath, niceExaggeration, pathSegments, pxPerDegX, pxPerDegY, xOf, yOf } from './horizonGeometry'

const W = 1000
const H = 260
const INSET = 150
const INSET_SPAN = 6

interface Props {
  info: ModelInfo
  sun: BodyView
  earth: BodyView
  tMs: number
}

export function HorizonChart({ info, sun, earth, tMs }: Props) {
  const uid = useId()
  const eph = useEphemeris().data
  const horizon = info.model.horizon
  const values = useMemo(() => Array.from(horizon.values), [horizon])

  // paths over the next 24 h, hourly (browser engine; the API series replaces it when deployed)
  const path = useMemo(() => {
    if (!eph) return null
    const t = timeGrid(Math.floor(tMs / 3_600_000) * 3_600_000, 24, 30).filter((x) => eph.table.covers(x))
    const s = t.map((x) => evaluateAt(eph.table, info.model, x))
    return { sunAz: s.map((q) => q.sun.az), sunEl: s.map((q) => q.sun.el), earthAz: s.map((q) => q.earth.az), earthEl: s.map((q) => q.earth.el) }
  }, [eph, info, tMs])

  const view: Viewport = useMemo(() => {
    const lows = [horizon.min, sun.el, earth.el, ...(path ? [...path.sunEl, ...path.earthEl] : [])]
    const highs = [horizon.max, sun.el + sun.radiusDeg, earth.el + earth.radiusDeg, ...(path ? [...path.sunEl, ...path.earthEl] : [])]
    const el0 = Math.floor(Math.min(...lows) - 1)
    const top = Math.ceil(Math.max(...highs) + 1)
    return { az0: 0, az1: 360, el0, width: W, height: H, exaggeration: niceExaggeration(top - el0, W, H) }
  }, [horizon, sun, earth, path])

  let maxIdx = 0
  values.forEach((v, i) => {
    if (v > values[maxIdx]) maxIdx = i
  })
  const summary =
    `Sun at azimuth ${sun.az.toFixed(1)}°, elevation ${sun.el.toFixed(2)}°, ${Math.round(sun.fraction * 100)}% of its disc above the horizon. ` +
    `Earth at azimuth ${earth.az.toFixed(1)}°, elevation ${earth.el.toFixed(2)}°, ${Math.round(earth.fraction * 100)}% above the horizon. ` +
    `Highest horizon point ${values[maxIdx].toFixed(2)}° at azimuth ${(maxIdx * horizon.azStep).toFixed(1)}°.`

  return (
    <figure className="horizon-chart">
      <div className="horizon-main">
        <svg viewBox={`-44 -10 ${W + 54} ${H + 36}`} role="img" aria-labelledby={`${uid}-t ${uid}-d`} preserveAspectRatio="xMidYMid meet">
          <title id={`${uid}-t`}>360° horizon with the Sun and the Earth</title>
          <desc id={`${uid}-d`}>{summary}</desc>
          <defs>
            <linearGradient id={`${uid}-sky`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--sky-top)" />
              <stop offset="1" stopColor="var(--sky-bottom)" />
            </linearGradient>
            <clipPath id={`${uid}-clip`}>
              <rect width={W} height={H} />
            </clipPath>
          </defs>
          <rect width={W} height={H} fill={`url(#${uid}-sky)`} />
          <Grid v={view} />
          <g clipPath={`url(#${uid}-clip)`}>
            {path && <PathLines v={view} az={path.sunAz} el={path.sunEl} className="path-sun" />}
            {path && <PathLines v={view} az={path.earthAz} el={path.earthEl} className="path-earth" />}
            <Disc v={view} body={earth} kind="earth" />
            <Disc v={view} body={sun} kind="sun" />
            <path d={horizonPath(view, values)} className="terrain" />
            <Marker v={view} body={earth} label="Earth" kind="earth" />
            <Marker v={view} body={sun} label="Sun" kind="sun" />
          </g>
        </svg>
        <figcaption>
          <span className="badge">Vertical exaggeration ×{view.exaggeration}</span>
          <span className="legend">
            <span className="swatch swatch-sun" aria-hidden="true" /> Sun
            <span className="swatch swatch-earth" aria-hidden="true" /> Earth (dashed ring)
            <span className="swatch swatch-path" aria-hidden="true" /> Path over the next 24 h
            <span className="swatch swatch-terrain" aria-hidden="true" /> {horizon.kind === 'terrain' ? 'LOLA terrain horizon' : 'Smooth-sphere horizon'}
          </span>
        </figcaption>
      </div>
      <div className="horizon-insets">
        <Inset horizon={horizon} values={values} body={sun} kind="sun" label="Sun" uid={`${uid}-s`} />
        <Inset horizon={horizon} values={values} body={earth} kind="earth" label="Earth" uid={`${uid}-e`} />
      </div>
      <DataTable
        summary="Horizon profile as a table (every 10°)"
        caption={`Horizon elevation by azimuth at ${info.name}`}
        head={['Azimuth', 'Horizon elevation']}
        rows={Array.from({ length: 36 }, (_, i) => [`${i * 10}° ${COMPASS[i * 10] ?? ''}`.trim(), `${horizon.at(i * 10).toFixed(2)}°`])}
      />
    </figure>
  )
}

function Grid({ v }: { v: Viewport }) {
  return (
    <g className="grid" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => i * 45).map((az) => {
        const x = az === 360 ? v.width : xOf(v, az)
        return (
          <g key={az}>
            <line x1={x} x2={x} y1={0} y2={v.height} />
            <text x={x} y={v.height + 18} textAnchor="middle">
              {COMPASS[az % 360]} {az % 360}°
            </text>
          </g>
        )
      })}
      {elevationTicks(v).map((el) => (
        <g key={el}>
          <line x1={0} x2={v.width} y1={yOf(v, el)} y2={yOf(v, el)} className={el === 0 ? 'zero' : undefined} />
          <text x={-6} y={yOf(v, el) + 4} textAnchor="end">
            {el}°
          </text>
        </g>
      ))}
    </g>
  )
}

function PathLines({ v, az, el, className }: { v: Viewport; az: number[]; el: number[]; className: string }) {
  return (
    <g className={className}>
      {pathSegments(v, az, el).map((seg, i) => (
        <polyline key={i} points={seg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} />
      ))}
    </g>
  )
}

function Disc({ v, body, kind }: { v: Viewport; body: BodyView; kind: 'sun' | 'earth' }) {
  return (
    <ellipse
      className={`disc disc-${kind}`}
      cx={xOf(v, body.az)}
      cy={yOf(v, body.el)}
      rx={body.radiusDeg * pxPerDegX(v)}
      ry={body.radiusDeg * pxPerDegY(v)}
    />
  )
}

function Marker({ v, body, label, kind }: { v: Viewport; body: BodyView; label: string; kind: 'sun' | 'earth' }) {
  const x = xOf(v, body.az)
  const y = yOf(v, body.el)
  return (
    <g className={`marker marker-${kind}`}>
      <circle cx={x} cy={y} r={9} />
      <text x={x} y={y - 14} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

function Inset({ values, body, kind, label, uid }: { horizon: Horizon; values: number[]; body: BodyView; kind: 'sun' | 'earth'; label: string; uid: string }) {
  let az0 = body.az - INSET_SPAN / 2
  let az1 = body.az + INSET_SPAN / 2
  if (az0 < 0) {
    az0 += 360
    az1 += 360
  }
  const v: Viewport = { az0, az1, el0: body.el - INSET_SPAN / 2, width: INSET, height: INSET, exaggeration: 1 }
  const pct = Math.round(body.fraction * 100)
  return (
    <figure className={`inset inset-${kind}`}>
      <svg viewBox={`0 0 ${INSET} ${INSET}`} role="img" aria-label={`${label} close-up at true shape: ${pct}% of the disc above the horizon`}>
        <defs>
          <clipPath id={`${uid}-c`}>
            <rect width={INSET} height={INSET} />
          </clipPath>
        </defs>
        <rect width={INSET} height={INSET} className="inset-sky" />
        <g clipPath={`url(#${uid}-c)`}>
          <Disc v={v} body={body} kind={kind} />
          <path d={horizonPath(v, values)} className="terrain" />
        </g>
      </svg>
      <figcaption>
        <strong>{label}</strong> · {pct}% visible · {INSET_SPAN}° × {INSET_SPAN}°, true shape
      </figcaption>
    </figure>
  )
}
