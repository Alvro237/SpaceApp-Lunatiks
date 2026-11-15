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
 *
 * With Multiselect comparing two or more places, the two strips give way to one strip per place on the same time
 * axis (numbered as on the map, with its share of the window), and a Sunlit / Earth switch next to the playback
 * icons chooses what those strips show. Adding a place adds a row.
 */
import { type MouseEvent, useId, useMemo, useState } from 'react'
import { useApiSeries } from '../api/hooks'
import type { LinkResponse, PowerResponse } from '../api/types'
import { type ComparedPlace, useComparePlaces, useComparing } from '../compare/useComparePlaces'
import { useCurrentPowerResult } from '../state/power'
import { sameSelection, useApp } from '../state/store'
import { SPEEDS, type SpeedId, formatUtc, isoMinute } from '../time/clock'
import { MS_PER_DAY, MS_PER_HOUR } from '../time/engine'
import { useParams, useThrottledTime } from '../time/hooks'
import { toRanges } from '../panels/linkModel'
import { useNow } from '../panels/useNow'
import { useLinkResult, useLinkStore } from '../state/link'
import { IconAntenna, IconPause, IconPlay, IconSpeed, IconSun } from '../ui/icons'

const W = 1000
const ROW = 14
/** Width of the label column: the row names for one place, number + name + share when comparing. */
const LEFT_SINGLE = 70
const LEFT_COMPARE = 230

type Strip = 'sun' | 'earth'

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
  const comparing = useComparing()
  const compared = useComparePlaces()
  const [strip, setStrip] = useState<Strip>('sun')
  const link = useLinkResult()
  const showEarthRow = useLinkStore((s) => s.showEarthRow)
  const LEFT = comparing ? LEFT_COMPARE : LEFT_SINGLE

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
        {comparing && (
          <div className="tl-seg" role="radiogroup" aria-label="The strips show">
            {(
              [
                ['sun', 'Sunlit', <IconSun key="s" size={16} />],
                ['earth', 'Earth', <IconAntenna key="e" size={16} />],
              ] as const
            ).map(([v, label, icon]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={strip === v}
                className={`tl-seg-item${strip === v ? ' is-on' : ''}`}
                onClick={() => setStrip(v)}
                title={v === 'sun' ? 'When each place is sunlit' : 'When each place sees the Earth'}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="tl-icons" role="group" aria-label="Playback">
          <button type="button" className="tl-btn" aria-pressed={playing} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => setPlaying(!playing)}>
            {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
          </button>
          <button type="button" className="tl-btn tl-speed" aria-label={`Speed ${speed}: ${speedLabel}. Change`} title={`Speed: ${speedLabel}`} onClick={nextSpeed}>
            <IconSpeed size={20} />
            <span aria-hidden="true">{speed}</span>
          </button>
        </div>
      </div>

      {comparing && (
        <CompareStrips places={compared.filter((p) => p.win)} strip={strip} startMs={startMs} endMs={endMs} durationH={durationH} tMs={tMs} ticks={ticks} x={x} onSeek={seek} />
      )}
      {data && (
        <>
          {!comparing && <PlaceStrip id={id} data={data} link={link.data ?? null} linkReady={!link.problem} showEarth={showEarthRow || !link.data} left={LEFT} x={x} ticks={ticks} durationH={durationH} startMs={startMs} endMs={endMs} tMs={tMs} onSeek={seek} />}
          {!comparing && link.data?.budget && !link.problem && <MarginChart link={link.data} startMs={startMs} endMs={endMs} tMs={tMs} x={x} left={LEFT} onSeek={seek} />}
          {battery && <BatteryChart r={battery} startMs={startMs} endMs={endMs} tMs={tMs} x={x} left={LEFT} onSeek={seek} />}
          {inside && <InsideChart r={inside} startMs={startMs} endMs={endMs} tMs={tMs} x={x} left={LEFT} onSeek={seek} />}
          <TimelineText data={data} battery={battery} inside={inside} tMs={tMs} link={link.data && !link.problem ? link.data : null} />
        </>
      )}
    </section>
  )
}


/**
 * The strips of one place on the window's time axis: Sunlit, optionally Earth up (the place sees the Earth), and Link
 * (the place sees the Earth AND an antenna of the chosen networks sees the Moon; with the link budget on, the solid bars
 * are where the budget closes and the dotted ones where there is contact but too little margin). While the link answer
 * is not there (no place data yet, API down) the Earth row stands in so the timeline never goes blank.
 */
interface PlaceStripProps {
  id: string
  data: TimelineData
  link: LinkResponse | null
  /** False while the budget is incomplete: the answer then is only the geometry and the Link row stays empty. */
  linkReady: boolean
  showEarth: boolean
  left: number
  x: (t: number) => number
  ticks: number[]
  durationH: number
  startMs: number
  endMs: number
  tMs: number
  onSeek: (e: MouseEvent<SVGSVGElement>) => void
}

function PlaceStrip({ id, data, link, linkReady, showEarth, left, x, ticks, durationH, startMs, endMs, tMs, onSeek }: PlaceStripProps) {
  const level2 = !!link?.budget
  // the Link row shows real link only: where the budget closes (or, at the geometry level, where there is contact)
  const linkRanges = link && linkReady ? toRanges(level2 ? link.budget!.link_ranges : link.contact_ranges) : []
  const rows: { key: 'sun' | 'earth' | 'link'; label: string }[] = [
    { key: 'sun', label: 'Sunlit' },
    ...(showEarth ? [{ key: 'earth' as const, label: link ? 'Earth up' : 'Earth' }] : []),
    ...(link ? [{ key: 'link' as const, label: 'Link' }] : []),
  ]
  const pitch = ROW + 4
  const tickY = (rows.length - 1) * pitch + ROW
  const height = tickY + 20
  const summary =
    `Sunlit ${data.sunlightPct.toFixed(1)}% and Earth in view ${data.commsPct.toFixed(1)}% of the window, longest dark ${data.longestDarkH.toFixed(1)} h, longest without Earth ${data.longestBlackoutH.toFixed(1)} h.` +
    (link && linkReady ? ` Link ${((level2 ? link.budget!.link_window_fraction : link.contact_window_fraction) * 100).toFixed(1)}% of the window, longest gap ${(level2 ? link.budget!.longest_link_blackout_h : link.longest_blackout_h).toFixed(1)} h.` : '')

  return (
    <svg className="strip" viewBox={`${-left} 0 ${W + left + 6} ${height}`} role="img" aria-label={summary} onClick={onSeek}>
      <defs>
        <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" className="hatch-bg" />
          <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
        </pattern>
      </defs>
      {rows.map((r, i) => {
        const y = i * pitch
        const bars: [number, number][] = r.key === 'sun' ? data.sunlit : r.key === 'earth' ? data.comms : linkRanges
        return (
          <g key={r.key}>
            <text x={-8} y={y + ROW * 0.78} textAnchor="end" className="row-label">
              {r.label}
            </text>
            <rect x={0} y={y} width={W} height={ROW - 2} className="row-bg" />
            {bars.map(([a, b], k) => (
              <rect
                key={k}
                x={x(a)}
                y={y}
                width={Math.max(1, x(b) - x(a))}
                height={ROW - 2}
                className={r.key === 'sun' ? 'range-sun' : r.key === 'link' ? 'range-link' : 'range-earth'}
                fill={r.key === 'earth' ? `url(#${id}-hatch)` : undefined}
              />
            ))}
          </g>
        )
      })}
      {ticks.map((t) => (
        <g key={t} className="tick">
          <line x1={x(t)} x2={x(t)} y1={tickY} y2={tickY + 5} />
          <text x={x(t)} y={tickY + 17} textAnchor="middle">
            {new Date(t).toISOString().slice(5, durationH <= 72 ? 13 : 10).replace('T', ' ')}
          </text>
        </g>
      ))}
      {tMs >= startMs && tMs <= endMs && <line className="cursor" x1={x(tMs)} x2={x(tMs)} y1={-2} y2={tickY + 2} />}
    </svg>
  )
}
/**
 * Link budget (level 2): the best Eb/N0 margin among the antennas in contact, at each sample, against the margin the
 * user asks for (dashed). The link is closed only where the line is at or above the dashed one, which is what the
 * Link row above draws. A break in the line means no antenna is in contact then. The same numbers are in the panel.
 */
function MarginChart({ link, startMs, endMs, tMs, x, left, onSeek }: { link: LinkResponse; startMs: number; endMs: number; tMs: number; x: (t: number) => number; left: number; onSeek: (e: MouseEvent<SVGSVGElement>) => void }) {
  const b = link.budget!
  const need = b.inputs.min_margin_db
  const values = b.best_margin_db
  const finite = values.filter((v): v is number => v !== null)
  if (finite.length === 0) return null
  const lo = Math.min(...finite, need) - 1
  const hi = Math.max(...finite, need) + 1
  const y = (v: number) => BH - ((v - lo) / (hi - lo)) * (BH - 8) - 4
  const runs: string[] = []
  let current: string[] = []
  link.t.forEach((iso, i) => {
    const t = Date.parse(iso)
    const v = values[i]
    if (v === null || v === undefined || t < startMs || t > endMs) {
      if (current.length) runs.push(current.join(' L'))
      current = []
    } else current.push(`${x(t).toFixed(1)},${y(v).toFixed(1)}`)
  })
  if (current.length) runs.push(current.join(' L'))
  const closed = Math.min(...finite) >= need
  const label = `Link margin between ${Math.min(...finite).toFixed(1)} and ${Math.max(...finite).toFixed(1)} dB, against the ${need} dB the link needs. ${closed ? 'It stays above the need.' : 'It falls below the need at times.'}`

  return (
    <svg className="line-chart margin-chart" viewBox={`${-left} -6 ${W + left + 6} ${BH + 14}`} role="img" aria-label={label} onClick={onSeek}>
      <text x={-8} y={BH / 2 - 2} textAnchor="end" className="row-label">
        Margin
      </text>
      <text x={-8} y={BH / 2 + 11} textAnchor="end" className="axis-label">
        dB
      </text>
      <rect x={0} y={0} width={W} height={BH} className="row-bg" />
      <text x={W + 4} y={10} className="axis-label">
        {hi.toFixed(0)}
      </text>
      <text x={W + 4} y={BH} className="axis-label">
        {lo.toFixed(0)}
      </text>
      <line x1={0} x2={W} y1={y(need)} y2={y(need)} className="margin-need">
        <title>Margin the link needs: {need} dB</title>
      </line>
      <text x={4} y={y(need) - 3} className="axis-label">
        needs {need} dB
      </text>
      {runs.map((d, i) => (
        <path key={i} d={`M${d}`} className="margin-line" />
      ))}
      {tMs >= startMs && tMs <= endMs && <line className="cursor" x1={x(tMs)} x2={x(tMs)} y1={-4} y2={BH + 2} />}
    </svg>
  )
}

const CROW = 14
const CGAP = 6
const NAME_CHARS = 22

/**
 * Multiselect: one strip per compared place on the window's time axis, sunlit or Earth in view as the switch says.
 * The label column carries the place's number (as on the map), its name and its share of the window, with a star
 * for the best; the current place is highlighted and a click on a label makes that place current.
 */
function CompareStrips({
  places,
  strip,
  startMs,
  endMs,
  durationH,
  tMs,
  ticks,
  x,
  onSeek,
}: {
  places: ComparedPlace[]
  strip: Strip
  startMs: number
  endMs: number
  durationH: number
  tMs: number
  ticks: number[]
  x: (t: number) => number
  onSeek: (e: MouseEvent<SVGSVGElement>) => void
}) {
  const id = useId()
  const selection = useApp((s) => s.selection)
  const select = useApp((s) => s.select)
  if (places.length === 0) return null
  const share = (p: ComparedPlace) => (strip === 'sun' ? p.win!.metrics.sunlightPct : p.win!.metrics.commsPct)
  const best = Math.max(...places.map(share))
  const rowsH = places.length * (CROW + CGAP) - CGAP
  const h = rowsH + 24
  const what = strip === 'sun' ? 'sunlit' : 'in view of the Earth'
  const cut = (s: string) => (s.length > NAME_CHARS ? `${s.slice(0, NAME_CHARS - 1)}…` : s)

  return (
    <svg
      className={`strip compare-strips is-${strip}`}
      viewBox={`${-LEFT_COMPARE} 0 ${W + LEFT_COMPARE + 6} ${h}`}
      role="img"
      aria-label={`When each place is ${what}: ${places.map((p) => `${p.num} ${p.info.name} ${share(p).toFixed(0)} %`).join(', ')} of the window.`}
      onClick={onSeek}
    >
      <defs>
        <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" className="hatch-bg" />
          <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
        </pattern>
      </defs>
      {places.map((p, i) => {
        const y = i * (CROW + CGAP)
        const ranges = strip === 'sun' ? p.win!.sunlit : p.win!.comms
        const current = sameSelection(p.sel, selection)
        const isBest = places.length > 1 && share(p) === best
        return (
          <g key={p.num} className={current ? 'is-current' : undefined}>
            <g
              className="cs-label"
              onClick={(e) => {
                e.stopPropagation()
                select(p.sel)
              }}
            >
              <title>{`${p.info.name}: ${share(p).toFixed(1)} % ${what}`}</title>
              <circle cx={-LEFT_COMPARE + 9} cy={y + (CROW - 2) / 2} r={8} className={`cs-num cs-c-${p.num}`} />
              <text x={-LEFT_COMPARE + 9} y={y + (CROW - 2) / 2 + 4} textAnchor="middle" className="cs-num-text">
                {p.num}
              </text>
              <text x={-LEFT_COMPARE + 23} y={y + CROW * 0.78} className="row-label">
                {cut(p.info.name)}
              </text>
              <text x={-8} y={y + CROW * 0.78} textAnchor="end" className="row-label cs-share">
                {`${isBest ? '★ ' : ''}${share(p).toFixed(0)}%`}
              </text>
            </g>
            <rect x={0} y={y} width={W} height={CROW - 2} className="row-bg" />
            {ranges.map(([a, b], k) => (
              <rect
                key={k}
                x={x(a)}
                y={y}
                width={Math.max(1, x(b) - x(a))}
                height={CROW - 2}
                className={strip === 'sun' ? 'range-sun' : 'range-earth'}
                fill={strip === 'earth' ? `url(#${id}-hatch)` : undefined}
              />
            ))}
          </g>
        )
      })}
      {ticks.map((t) => (
        <g key={t} className="tick">
          <line x1={x(t)} x2={x(t)} y1={rowsH + 4} y2={rowsH + 9} />
          <text x={x(t)} y={rowsH + 21} textAnchor="middle">
            {new Date(t).toISOString().slice(5, durationH <= 72 ? 13 : 10).replace('T', ' ')}
          </text>
        </g>
      ))}
      {tMs >= startMs && tMs <= endMs && <line className="cursor" x1={x(tMs)} x2={x(tMs)} y1={-2} y2={rowsH + 6} />}
    </svg>
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
  /** Width of the label column, so every row shares the strips' time axis. */
  left: number
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
function BatteryChart({ r, startMs, endMs, tMs, x, left: LEFT, onSeek }: RowProps) {
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
function InsideChart({ r, startMs, endMs, tMs, x, left: LEFT, onSeek }: RowProps) {
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
function TimelineText({ data, battery, inside, tMs, link }: { data: TimelineData; battery: PowerResponse | null; inside: PowerResponse | null; tMs: number; link: LinkResponse | null }) {
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
          {(link ? toRanges(link.budget ? link.budget.link_ranges : link.contact_ranges) : []).map((q, i) => (
            <tr key={`l${i}`}>
              <th scope="row">Link</th>
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
