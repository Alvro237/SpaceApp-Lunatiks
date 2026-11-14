/**
 * Timeline of the analysis window, as a bare bar over the map (no panel, no background): the time slider with the
 * clock, two icons on its right (play / pause and playback speed), and under it the two strips, when the place is
 * sunlit and when the Earth is in view. When the Power section has computed a battery balance for this same
 * scenario the battery charge is drawn under the strips as a line on the same time axis, and for the colony
 * analysis the inside temperature too. The playback cursor runs through all rows.
 *
 * Everything that used to be printed here (metrics, tables) is kept as text for assistive technology, and the
 * numbers are also in the Power and Earth link sections. Sunlit and Earth ranges come as time ranges and as a
 * fraction of the window (the two forms every time answer takes, CLAUDE.md). Source: GET /sites/{id}/series when
 * deployed and paused, otherwise the browser engine.
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
import { IconPause, IconPlay, IconSpeed } from '../ui/icons'

const W = 1000
const ROW = 14
const H = ROW * 2 + 24
const LEFT = 70

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

const sample = (r: PowerResponse, tMs: number): number => {
  const t0 = Date.parse(r.t[0])
  const step = r.step_min * 60_000
  return Math.max(0, Math.round((tMs - t0) / step))
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
  const inside = powerResult?.interior_k ? powerResult : null
  const stepMin = Math.max(10, Math.ceil((durationH * 60) / 2000 / 10) * 10)
  const apiParams = useMemo(
    () => ({ start: isoMinute(startMs), duration_h: durationH, step_min: stepMin, mast_m: mastM, comms_min_fraction: params.commsMinFraction }),
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
    const fx = ((e.clientX - r.left) / r.width) * (W + LEFT + 6) - LEFT
    if (fx >= 0 && fx <= W) setTime(startMs + (fx / W) * (endMs - startMs))
  }
  const speedLabel = SPEEDS.find((s) => s.id === speed)?.label ?? ''
  const nextSpeed = () => setSpeed(SPEEDS[(SPEEDS.findIndex((s) => s.id === speed) + 1) % SPEEDS.length].id as SpeedId)

  return (
    <section className="timeline mini" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="sr-only">
        Mission window and playback
      </h2>

      <div className="tl-row">
        <output className="tl-clock" aria-live="off">
          {formatUtc(tMs).replace(' UTC', '')}
        </output>
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
        <div className="tl-icons" role="group" aria-label="Playback">
          <button type="button" className="tl-btn" aria-pressed={playing} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => setPlaying(!playing)}>
            {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
          </button>
          <button type="button" className="tl-btn tl-speed" aria-label={`Speed: ${speedLabel}. Change`} title={`Speed: ${speedLabel}`} onClick={nextSpeed}>
            <IconSpeed size={20} />
            <span aria-hidden="true">{speed}</span>
          </button>
        </div>
      </div>

      {data && (
        <>
          <svg
            className="strip"
            viewBox={`${-LEFT} 0 ${W + LEFT + 6} ${H}`}
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
            <text x={-8} y={ROW * 0.78} textAnchor="end" className="row-label">
              Sunlit
            </text>
            <text x={-8} y={ROW * 1.78 + 4} textAnchor="end" className="row-label">
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
                <line x1={x(t)} x2={x(t)} y1={ROW * 2 + 4} y2={ROW * 2 + 9} />
                <text x={x(t)} y={ROW * 2 + 21} textAnchor="middle">
                  {new Date(t).toISOString().slice(5, durationH <= 72 ? 13 : 10).replace('T', ' ')}
                </text>
              </g>
            ))}
            {tMs >= startMs && tMs <= endMs && <line className="cursor" x1={x(tMs)} x2={x(tMs)} y1={-2} y2={ROW * 2 + 6} />}
          </svg>
          {battery && <BatteryChart r={battery} startMs={startMs} endMs={endMs} tMs={tMs} x={x} onSeek={seek} />}
          {inside && <InsideChart r={inside} startMs={startMs} endMs={endMs} tMs={tMs} x={x} onSeek={seek} />}
          <TimelineText data={data} battery={battery} inside={inside} tMs={tMs} />
        </>
      )}
    </section>
  )
}

const BH = 44
const socPct = (v: number) => `${(v * 100).toFixed(0)} %`

interface RowProps {
  r: PowerResponse
  startMs: number
  endMs: number
  tMs: number
  x: (t: number) => number
  onSeek: (e: MouseEvent<SVGSVGElement>) => void
}

/** Polyline points for the samples inside the window; `y` maps a value to the row's pixel height. */
function useLine(r: PowerResponse, series: number[] | null, startMs: number, endMs: number, x: (t: number) => number, y: (v: number) => number): string[] {
  return useMemo(() => {
    const out: string[] = []
    r.t.forEach((iso, i) => {
      const t = Date.parse(iso)
      if (t < startMs || t > endMs || series?.[i] === undefined) return
      out.push(`${x(t).toFixed(1)},${y(series[i]).toFixed(1)}`)
    })
    return out
  }, [r.t, series, startMs, endMs, x, y])
}

/**
 * Battery state of charge from POST /api/v1/power (levels 3 and 4), on the timeline's time axis. Empty ranges
 * from the API (and, at level 4, the saving-mode ranges) are marked with a hatch and a word, never colour alone;
 * the same series is in the text below.
 */
function BatteryChart({ r, startMs, endMs, tMs, x, onSeek }: RowProps) {
  const id = useId()
  const y = useMemo(() => (v: number) => BH - v * BH, [])
  const pts = useLine(r, r.battery_soc, startMs, endMs, x, y)
  if (pts.length < 2) return null
  const area = `M${pts[0].split(',')[0]},${BH} L${pts.join(' L')} L${pts[pts.length - 1].split(',')[0]},${BH} Z`
  const depleted = (r.depleted_ranges ?? []).map((q) => [Date.parse(q.start), Date.parse(q.end)] as const)
  const saving = (r.shed_ranges ?? []).map((q) => [Date.parse(q.start), Date.parse(q.end)] as const)
  const minY = r.min_soc === null ? null : y(r.min_soc)
  const label = `Battery charge over the window: lowest ${r.min_soc === null ? 'unknown' : socPct(r.min_soc)}, at the end ${
    r.final_soc === null ? 'unknown' : socPct(r.final_soc)
  }. ${r.survives ? 'The load is served for the whole window.' : `The battery runs out${r.first_depletion_at ? ` on ${formatUtc(Date.parse(r.first_depletion_at))}` : ''}.`}`

  return (
    <svg className="line-chart battery-chart" viewBox={`${-LEFT} -6 ${W + LEFT + 6} ${BH + 14}`} role="img" aria-label={label} onClick={onSeek}>
      <defs>
        <pattern id={`${id}-dep`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="6" className="dep-line" />
        </pattern>
        <pattern id={`${id}-sav`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" className="sav-line" />
        </pattern>
      </defs>
      <text x={-8} y={BH / 2 - 2} textAnchor="end" className="row-label">
        Battery
      </text>
      <text x={-8} y={BH / 2 + 11} textAnchor="end" className="axis-label">
        charge
      </text>
      <rect x={0} y={0} width={W} height={BH} className="row-bg" />
      {[0, 0.5, 1].map((v) => (
        <g key={v} className="bgrid">
          <line x1={0} x2={W} y1={y(v)} y2={y(v)} />
          <text x={W + 4} y={y(v) + 4} className="axis-label">
            {v * 100}%
          </text>
        </g>
      ))}
      {saving.map(([a, b], i) => (
        <rect key={`s${i}`} x={x(a)} y={0} width={Math.max(2, x(b) - x(a))} height={BH} fill={`url(#${id}-sav)`} className="sav-range" />
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
      {depleted.length === 0 && saving.length > 0 && (
        <text x={x(saving[0][0]) + 4} y={12} className="sav-text">
          saving mode
        </text>
      )}
      {tMs >= startMs && tMs <= endMs && <line className="cursor" x1={x(tMs)} x2={x(tMs)} y1={-4} y2={BH + 2} />}
    </svg>
  )
}

/** Habitat inside temperature in °C (colony analysis), with the minimum safe temperature breaches hatched. */
function InsideChart({ r, startMs, endMs, tMs, x, onSeek }: RowProps) {
  const id = useId()
  const k = r.interior_k
  const lo = k && k.length ? Math.min(...k) - 273.15 : 0
  const hi = k && k.length ? Math.max(...k) - 273.15 : 1
  const span = Math.max(1, hi - lo)
  const y = useMemo(() => (v: number) => BH - ((v - 273.15 - lo) / span) * (BH - 8) - 4, [lo, span])
  const pts = useLine(r, k, startMs, endMs, x, y)
  if (pts.length < 2) return null
  const below = (r.interior_below_min_ranges ?? []).map((q) => [Date.parse(q.start), Date.parse(q.end)] as const)
  const label = `Inside temperature from ${lo.toFixed(0)} to ${hi.toFixed(0)} °C.${below.length > 0 ? ' It drops below the minimum.' : ' It stays above the minimum.'}`
  return (
    <svg className="line-chart inside-chart" viewBox={`${-LEFT} -6 ${W + LEFT + 6} ${BH + 14}`} role="img" aria-label={label} onClick={onSeek}>
      <defs>
        <pattern id={`${id}-cold`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2="6" className="dep-line" />
        </pattern>
      </defs>
      <text x={-8} y={BH / 2 - 2} textAnchor="end" className="row-label">
        Inside
      </text>
      <text x={-8} y={BH / 2 + 11} textAnchor="end" className="axis-label">
        temp
      </text>
      <rect x={0} y={0} width={W} height={BH} className="row-bg" />
      <text x={W + 4} y={10} className="axis-label">
        {hi.toFixed(0)}°C
      </text>
      <text x={W + 4} y={BH} className="axis-label">
        {lo.toFixed(0)}°C
      </text>
      {below.map(([a, b], i) => (
        <rect key={i} x={x(a)} y={0} width={Math.max(2, x(b) - x(a))} height={BH} fill={`url(#${id}-cold)`} className="dep-range" />
      ))}
      <polyline points={pts.join(' ')} className="inside-line" />
      {below.length > 0 && (
        <text x={x(below[0][0]) + 4} y={12} className="dep-text">
          too cold
        </text>
      )}
      {tMs >= startMs && tMs <= endMs && <line className="cursor" x1={x(tMs)} x2={x(tMs)} y1={-4} y2={BH + 2} />}
    </svg>
  )
}

/**
 * The numbers behind the bars, as text for assistive technology (visually hidden): window metrics, the sunlit and
 * Earth ranges, and the battery / inside-temperature series. They are plain tables, always open, so a screen
 * reader finds them in order; the same figures are in the Power and Earth link sections for everyone else.
 */
function TimelineText({ data, battery, inside, tMs }: { data: TimelineData; battery: PowerResponse | null; inside: PowerResponse | null; tMs: number }) {
  const hours = ([a, b]: [number, number]) => ((b - a) / MS_PER_HOUR).toFixed(1)
  const series = battery ?? inside
  const every = series ? Math.max(1, Math.ceil(series.t.length / 48)) : 1
  const rows: string[][] = []
  if (series) {
    for (let i = 0; i < series.t.length; i += every) {
      rows.push([
        formatUtc(Date.parse(series.t[i])),
        series.battery_soc ? socPct(series.battery_soc[i]) : '—',
        series.interior_k ? `${(series.interior_k[i] - 273.15).toFixed(1)} °C` : '—',
        series.power_w ? `${series.power_w[i].toFixed(1)} W` : '—',
      ])
    }
  }
  return (
    <div className="sr-only">
      <p>
        Sunlit {data.sunlightPct.toFixed(1)} %, Earth in view {data.commsPct.toFixed(1)} %, longest dark {data.longestDarkH.toFixed(1)} h, longest without Earth{' '}
        {data.longestBlackoutH.toFixed(1)} h. Source: {data.source === 'api' ? 'API' : 'browser engine'}.
        {battery?.battery_soc && ` Battery now ${socPct(battery.battery_soc[Math.min(battery.battery_soc.length - 1, sample(battery, tMs))])}.`}
      </p>
      <table>
        <caption>Sunlit and Earth-in-view ranges in the window (UTC)</caption>
        <thead>
          <tr>
            <th scope="col">Kind</th>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Hours</th>
          </tr>
        </thead>
        <tbody>
          {data.sunlit.map((q, i) => (
            <tr key={`s${i}`}>
              <th scope="row">Sunlit</th>
              <td>{formatUtc(q[0])}</td>
              <td>{formatUtc(q[1])}</td>
              <td>{hours(q)}</td>
            </tr>
          ))}
          {data.comms.map((q, i) => (
            <tr key={`c${i}`}>
              <th scope="row">Earth in view</th>
              <td>{formatUtc(q[0])}</td>
              <td>{formatUtc(q[1])}</td>
              <td>{hours(q)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {series && (
        <table>
          <caption>Battery charge, inside temperature and array power over the window (UTC)</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Battery</th>
              <th scope="col">Inside</th>
              <th scope="col">Panel power</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]}>
                <th scope="row">{row[0]}</th>
                <td>{row[1]}</td>
                <td>{row[2]}</td>
                <td>{row[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
