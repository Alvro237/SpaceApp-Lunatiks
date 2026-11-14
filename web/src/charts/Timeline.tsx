/**
 * Timeline of the analysis window: when the place is sunlit and when the Earth is in view, as time ranges
 * and as a fraction of the window (the two forms every time answer takes, CLAUDE.md), with playback controls.
 * Source: GET /sites/{id}/series when deployed and paused, otherwise the browser engine.
 * When the Power section has computed a battery balance for this same scenario, the battery charge is drawn as
 * a line on the same time axis, under the strip, with the playback cursor through both.
 */
import { type MouseEvent, useId, useMemo } from 'react'
import { useApiSeries } from '../api/hooks'
import type { PowerResponse } from '../api/types'
import { useCurrentPowerResult } from '../state/power'
import { useApp } from '../state/store'
import { SPEEDS, type SpeedId, formatUtc, isoMinute } from '../time/clock'
import { MS_PER_DAY, MS_PER_HOUR } from '../time/engine'
import { useParams, useThrottledTime } from '../time/hooks'
import { useNow } from '../panels/useNow'
import { SourceTag } from '../ui/ApiStatus'
import { DataTable } from './DataTable'

const W = 1000
const ROW = 16
const H = ROW * 2 + 30

interface TimelineData {
  source: 'api' | 'browser'
  startMs: number
  endMs: number
  sunlit: [number, number][]
  comms: [number, number][]
  sunlightPct: number
  commsPct: number
  longestDarkH: number
  longestBlackoutH: number
}

export function Timeline() {
  const id = useId()
  const selection = useApp((s) => s.selection)
  const mastM = useApp((s) => s.mastM)
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const playing = useApp((s) => s.playing)
  const speed = useApp((s) => s.speed)
  const { setPlaying, setSpeed, setTime } = useApp.getState()
  const params = useParams()
  const tMs = useThrottledTime()
  const { series: local } = useNow()
  const powerResult = useCurrentPowerResult()
  const battery = powerResult?.battery_soc ? powerResult : null
  const stepMin = Math.max(10, Math.ceil((durationH * 60) / 2000 / 10) * 10)
  const apiParams = useMemo(
    () => ({ start: isoMinute(startMs), duration_h: durationH, step_min: stepMin, mast_m: mastM, panel: params.panel, comms_min_fraction: params.commsMinFraction }),
    [startMs, durationH, stepMin, mastM, params],
  )
  const api = useApiSeries(selection, apiParams, !playing)
  const endMs = startMs + durationH * MS_PER_HOUR

  const data: TimelineData | null = useMemo(() => {
    if (api.data && !playing) {
      const m = api.data.metrics
      const r = (x: { start: string; end: string }[]) => x.map((q) => [Date.parse(q.start), Date.parse(q.end)] as [number, number])
      return {
        source: 'api',
        startMs,
        endMs,
        sunlit: r(api.data.sunlit_ranges),
        comms: r(api.data.comms_ranges),
        sunlightPct: Number(m.sunlight_pct),
        commsPct: Number(m.comms_pct),
        longestDarkH: Number(m.longest_dark_h),
        longestBlackoutH: Number(m.longest_blackout_h),
      }
    }
    if (!local) return null
    return {
      source: 'browser',
      startMs,
      endMs,
      sunlit: local.sunlit,
      comms: local.comms,
      sunlightPct: local.metrics.sunlightPct,
      commsPct: local.metrics.commsPct,
      longestDarkH: local.metrics.longestDarkH,
      longestBlackoutH: local.metrics.longestBlackoutH,
    }
  }, [api.data, playing, local, startMs, endMs])

  const x = (t: number) => ((t - startMs) / (endMs - startMs)) * W
  const ticks = useMemo(() => {
    const days = durationH / 24
    const every = days <= 3 ? 0.25 : days <= 14 ? 1 : days <= 60 ? 5 : 30
    const out: number[] = []
    for (let d = 0; d <= days + 1e-9; d += every) out.push(startMs + d * MS_PER_DAY)
    return out
  }, [startMs, durationH])

  const slider = Math.min(Math.max(tMs, startMs), endMs)
  const seek = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const fx = ((e.clientX - r.left) / r.width) * (W + 76) - 70
    if (fx >= 0 && fx <= W) setTime(startMs + (fx / W) * (endMs - startMs))
  }

  return (
    <section className="timeline" aria-labelledby={`${id}-h`}>
      <div className="timeline-head">
        <h2 id={`${id}-h`} className="sr-only">
          Mission window and playback
        </h2>
        <div className="playback" role="group" aria-label="Playback">
          <button type="button" onClick={() => setTime(tMs - MS_PER_HOUR)} disabled={playing}>
            <span aria-hidden="true">◀︎ </span>1 h back
          </button>
          <button type="button" className="play" aria-pressed={playing} onClick={() => setPlaying(!playing)}>
            <span aria-hidden="true">{playing ? '❚❚ ' : '▶︎ '}</span>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={() => setTime(tMs + MS_PER_HOUR)} disabled={playing}>
            1 h forward<span aria-hidden="true"> ▶︎</span>
          </button>
          <label className="sr-only" htmlFor={`${id}-speed`}>
            Playback speed
          </label>
          <select id={`${id}-speed`} value={speed} onChange={(e) => setSpeed(e.target.value as SpeedId)}>
            {SPEEDS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <output className="clock" aria-live="off">
            {formatUtc(tMs)}
          </output>
        </div>
      </div>

      <label className="sr-only" htmlFor={`${id}-t`}>
        Active instant within the window
      </label>
      <input
        id={`${id}-t`}
        className="time-slider"
        type="range"
        min={startMs}
        max={endMs}
        step={10 * 60_000}
        value={slider}
        aria-valuetext={formatUtc(slider)}
        onChange={(e) => setTime(Number(e.target.value))}
      />

      {data && (
        <>
          <svg
            className="strip"
            viewBox={`-70 0 ${W + 76} ${H}`}
            role="img"
            aria-label={`Sunlit ${data.sunlightPct.toFixed(1)}% and Earth in view ${data.commsPct.toFixed(1)}% of the window, longest dark ${data.longestDarkH.toFixed(1)} h, longest without Earth ${data.longestBlackoutH.toFixed(1)} h.`}
            onClick={seek}
          >
            <defs>
              <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" className="hatch-bg" />
                <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
              </pattern>
            </defs>
            <text x={-8} y={ROW * 0.7} textAnchor="end" className="row-label">
              Sunlit
            </text>
            <text x={-8} y={ROW * 1.7 + 4} textAnchor="end" className="row-label">
              Earth
            </text>
            <rect x={0} y={0} width={W} height={ROW - 2} className="row-bg" />
            <rect x={0} y={ROW + 4} width={W} height={ROW - 2} className="row-bg" />
            {data.sunlit.map(([a, b], i) => (
              <rect key={`s${i}`} x={x(a)} y={0} width={Math.max(1, x(b) - x(a))} height={ROW - 2} className="range-sun" />
            ))}
            {data.comms.map(([a, b], i) => (
              <rect key={`c${i}`} x={x(a)} y={ROW + 4} width={Math.max(1, x(b) - x(a))} height={ROW - 2} fill={`url(#${id}-hatch)`} className="range-earth" />
            ))}
            {ticks.map((t) => (
              <g key={t} className="tick">
                <line x1={x(t)} x2={x(t)} y1={ROW * 2 + 4} y2={ROW * 2 + 10} />
                <text x={x(t)} y={ROW * 2 + 24} textAnchor="middle">
                  {new Date(t).toISOString().slice(5, durationH <= 72 ? 13 : 10).replace('T', ' ')}
                </text>
              </g>
            ))}
            {tMs >= startMs && tMs <= endMs && <line className="cursor" x1={x(tMs)} x2={x(tMs)} y1={-2} y2={ROW * 2 + 6} />}
          </svg>
          {battery && <BatteryChart r={battery} startMs={startMs} endMs={endMs} tMs={tMs} x={x} onSeek={seek} />}
          <dl className="metrics">
            <div>
              <dt>Sunlit</dt>
              <dd>{data.sunlightPct.toFixed(1)} %</dd>
            </div>
            <div>
              <dt>Earth in view</dt>
              <dd>{data.commsPct.toFixed(1)} %</dd>
            </div>
            <div>
              <dt>Longest dark</dt>
              <dd>{data.longestDarkH.toFixed(1)} h</dd>
            </div>
            <div>
              <dt>Longest without Earth</dt>
              <dd>{data.longestBlackoutH.toFixed(1)} h</dd>
            </div>
            {battery && (
              <div className="metrics-battery">
                <dt>Battery now</dt>
                <dd>{socAt(battery, tMs)}</dd>
              </div>
            )}
            <div className="metrics-source">
              <dt className="sr-only">Source</dt>
              <dd>
                <SourceTag source={data.source} />
              </dd>
            </div>
          </dl>
          <DataTable
            summary="Table"
            caption="Sunlit and Earth-in-view ranges in the window (UTC)"
            head={['Kind', 'From', 'To', 'Hours']}
            rows={[
              ...data.sunlit.map(([a, b]) => ['Sunlit', formatUtc(a), formatUtc(b), ((b - a) / MS_PER_HOUR).toFixed(1)]),
              ...data.comms.map(([a, b]) => ['Earth in view', formatUtc(a), formatUtc(b), ((b - a) / MS_PER_HOUR).toFixed(1)]),
            ]}
          />
          {battery && <BatteryTable r={battery} />}
        </>
      )}
    </section>
  )
}

const BH = 64
const socPct = (v: number) => `${(v * 100).toFixed(0)} %`

/** Battery charge at the instant nearest to tMs (the API's own samples, no interpolation). */
function socAt(r: PowerResponse, tMs: number): string {
  const soc = r.battery_soc
  if (!soc || soc.length === 0) return '—'
  const t0 = Date.parse(r.t[0])
  const step = r.step_min * 60_000
  const i = Math.min(soc.length - 1, Math.max(0, Math.round((tMs - t0) / step)))
  return socPct(soc[i])
}

/**
 * Battery state of charge from POST /api/v1/power (level 3), on the timeline's time axis. Empty ranges from the
 * API are marked with a hatch and a word, never colour alone; the table below holds the same series as text.
 */
function BatteryChart({
  r,
  startMs,
  endMs,
  tMs,
  x,
  onSeek,
}: {
  r: PowerResponse
  startMs: number
  endMs: number
  tMs: number
  x: (t: number) => number
  onSeek: (e: MouseEvent<SVGSVGElement>) => void
}) {
  const id = useId()
  const pts = useMemo(() => {
    const soc = r.battery_soc ?? []
    const out: string[] = []
    r.t.forEach((iso, i) => {
      const t = Date.parse(iso)
      if (t < startMs || t > endMs || soc[i] === undefined) return
      out.push(`${x(t).toFixed(1)},${(BH - soc[i] * BH).toFixed(1)}`)
    })
    return out
  }, [r.t, r.battery_soc, startMs, endMs, x])
  if (pts.length < 2) return null
  const area = `M${pts[0].split(',')[0]},${BH} L${pts.join(' L')} L${pts[pts.length - 1].split(',')[0]},${BH} Z`
  const depleted = (r.depleted_ranges ?? []).map((q) => [Date.parse(q.start), Date.parse(q.end)] as const)
  const minY = r.min_soc === null ? null : BH - r.min_soc * BH
  const label = `Battery charge over the window: lowest ${r.min_soc === null ? 'unknown' : socPct(r.min_soc)}, at the end ${
    r.final_soc === null ? 'unknown' : socPct(r.final_soc)
  }. ${r.survives ? 'The load is served for the whole window.' : `The battery runs out${r.first_depletion_at ? ` on ${formatUtc(Date.parse(r.first_depletion_at))}` : ''}.`}`

  return (
    <svg className="battery-chart" viewBox={`-70 -6 ${W + 76} ${BH + 14}`} role="img" aria-label={label} onClick={onSeek}>
      <defs>
        <pattern id={`${id}-dep`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="6" className="dep-line" />
        </pattern>
      </defs>
      <text x={-8} y={BH / 2 - 4} textAnchor="end" className="row-label">
        Battery
      </text>
      <text x={-8} y={BH / 2 + 10} textAnchor="end" className="axis-label">
        charge
      </text>
      <rect x={0} y={0} width={W} height={BH} className="row-bg" />
      {[0, 0.5, 1].map((v) => (
        <g key={v} className="bgrid">
          <line x1={0} x2={W} y1={BH - v * BH} y2={BH - v * BH} />
          <text x={W + 4} y={BH - v * BH + 4} className="axis-label">
            {v * 100}%
          </text>
        </g>
      ))}
      {depleted.map(([a, b], i) => (
        <rect key={i} x={x(a)} y={0} width={Math.max(2, x(b) - x(a))} height={BH} fill={`url(#${id}-dep)`} className="dep-range" />
      ))}
      <path d={area} className="battery-area" />
      <polyline points={pts.join(' ')} className="battery-line" />
      {minY !== null && (
        <line x1={0} x2={W} y1={minY} y2={minY} className="battery-min">
          <title>Lowest charge {socPct(r.min_soc ?? 0)}</title>
        </line>
      )}
      {depleted.length > 0 && (
        <text x={x(depleted[0][0]) + 4} y={12} className="dep-text">
          empty
        </text>
      )}
      {tMs >= startMs && tMs <= endMs && <line className="cursor" x1={x(tMs)} x2={x(tMs)} y1={-4} y2={BH + 2} />}
    </svg>
  )
}

/** The battery series as text: at most ~48 rows, evenly spaced, plus the lowest point. */
function BatteryTable({ r }: { r: PowerResponse }) {
  const soc = r.battery_soc ?? []
  const every = Math.max(1, Math.ceil(soc.length / 48))
  const rows: string[][] = []
  for (let i = 0; i < soc.length; i += every) {
    rows.push([formatUtc(Date.parse(r.t[i])), socPct(soc[i]), r.power_w ? `${r.power_w[i].toFixed(1)} W` : '—', r.net_power_w ? `${r.net_power_w[i].toFixed(1)} W` : '—'])
  }
  return <DataTable summary="Battery table" caption="Battery charge, array power and net power over the window (UTC)" head={['Time', 'Charge', 'Array', 'Net']} rows={rows} />
}
