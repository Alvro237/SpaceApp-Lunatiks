/**
 * Timeline of the analysis window: when the place is sunlit and when the Earth is in view, as time ranges
 * and as a fraction of the window (the two forms every time answer takes, CLAUDE.md), with playback controls.
 * Source: GET /sites/{id}/series when deployed and paused, otherwise the browser engine.
 */
import { useId, useMemo } from 'react'
import { useApiSeries } from '../api/hooks'
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
            onClick={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
              const fx = ((e.clientX - r.left) / r.width) * (W + 76) - 70
              if (fx >= 0 && fx <= W) setTime(startMs + (fx / W) * (endMs - startMs))
            }}
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
        </>
      )}
    </section>
  )
}
