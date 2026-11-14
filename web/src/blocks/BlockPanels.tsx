/**
 * Block Moon's panels: places on the left, the sky now on the right, the next days along the bottom, and Pip's
 * story over the map. Every answer comes from the same engine and data as the planner's panels; "Show the real
 * numbers" opens them.
 */
import { type ReactNode, useId, useState } from 'react'
import { useNow } from '../panels/useNow'
import { sameSelection, useApp } from '../state/store'
import { MS_PER_DAY, MS_PER_HOUR, hasComms, isSunlit } from '../time/engine'
import { formatUtc } from '../time/clock'
import { useMasks, useParams } from '../time/hooks'
import type { StaticSite } from '../time/staticData'
import { StoryCard } from './StoryCard'
import { dayBlocks, simpleDuration } from './voxels'
import './blocks.css'

type Kind = 'mountain' | 'lander' | 'crater' | 'point'

function kindOf(s: StaticSite): Kind {
  if (/^mons /i.test(s.name)) return 'mountain'
  if (s.group === 'Recent landers') return 'lander'
  return 'crater'
}

const ICONS: Record<Kind, string> = {
  mountain: 'M3 2h2v1H3zM2 3h4v1H2zM1 4h6v3H1z',
  crater: 'M0 2h2v5H0zM6 2h2v5H6zM2 5h4v2H2z',
  lander: 'M2 2h4v3H2zM1 5h1v2H1zM6 5h1v2H6z',
  point: 'M3 1h2v1H3zM2 2h4v2H2zM3 4h2v1H3zM3.5 5h1v2h-1z',
}

function PixelIcon({ kind }: { kind: Kind }) {
  const color = kind === 'lander' ? '#ffb547' : kind === 'point' ? '#7ee2a8' : '#b2b3b7'
  return (
    <svg width="24" height="24" viewBox="0 0 8 8" aria-hidden="true" shapeRendering="crispEdges">
      <rect width="8" height="8" fill="#0b0c0e" />
      <path d={ICONS[kind]} fill={color} />
    </svg>
  )
}

/** Short names for the tiles ("Shackleton" rather than "Shackleton crater"); the full name stays in the label. */
const shortName = (name: string) =>
  name
    .replace(/ \(intended site\)$/, '')
    .replace(/ crater$/, '')
    .replace(/ \(Shiv Shakti\)$/, '')

const fmtLat = (v: number) => `${Math.abs(v).toFixed(2)}° ${v < 0 ? 'S' : 'N'}`
const fmtLon = (v: number) => `${Math.abs(v).toFixed(2)}° ${v < 0 ? 'W' : 'E'}`

/** A Block Moon panel that folds to its title bar, so the world stays visible. */
function Fold({ side, title, summary, defaultOpen, children }: { side: 'left' | 'right'; title: string; summary?: ReactNode; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className={`float float-${side} blk-panel blk-fold${open ? '' : ' is-closed'}`} aria-labelledby={`${id}-h`}>
      <div className="blk-fold-head">
        <h2 id={`${id}-h`} className="blk-h">
          {title}
        </h2>
        {!open && summary}
        <button type="button" className="blk-icon" aria-expanded={open} aria-controls={`${id}-b`} aria-label={`${open ? 'Hide' : 'Show'} ${title}`} onClick={() => setOpen(!open)}>
          {open ? '−' : '+'}
        </button>
      </div>
      <div id={`${id}-b`} hidden={!open} className="blk-fold-body">
        {children}
      </div>
    </section>
  )
}

function Places() {
  const masks = useMasks().data
  const selection = useApp((s) => s.selection)
  const select = useApp((s) => s.select)
  const sites = masks?.doc.sites.filter((s) => s.lat <= -60) ?? []
  const groups: { title: string; items: StaticSite[] }[] = [
    { title: 'Landers', items: sites.filter((s) => kindOf(s) === 'lander') },
    { title: 'Mountains and craters', items: sites.filter((s) => kindOf(s) !== 'lander') },
  ]
  const chosen = selection.kind === 'site' ? sites.find((s) => s.id === selection.id)?.name : `${fmtLat(selection.lat)}, ${fmtLon(selection.lon)}`
  return (
    <Fold side="left" title="Places" defaultOpen={false} summary={chosen && <span className="blk-fold-sum">{shortName(chosen)}</span>}>
      <p className="blk-sub">Near the Moon’s south pole, or anywhere you click.</p>
      {groups.map((g) => (
        <div key={g.title} className="blk-group">
          <h3>{g.title}</h3>
          <div className="blk-tiles">
            {g.items.map((s) => {
              const on = sameSelection(selection, { kind: 'site', id: s.id })
              return (
                <button
                  key={s.id}
                  type="button"
                  className="blk-tile"
                  aria-pressed={on}
                  aria-label={s.name}
                  title={s.name}
                  onClick={() => select({ kind: 'site', id: s.id })}
                >
                  <PixelIcon kind={kindOf(s)} />
                  <span>{shortName(s.name)}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <div className="blk-group">
        <h3>Your own spot</h3>
        {selection.kind === 'point' ? (
          <div className="blk-tile blk-tile-wide" aria-current="true">
            <PixelIcon kind="point" />
            <span>
              {fmtLat(selection.lat)}, {fmtLon(selection.lon)}
            </span>
          </div>
        ) : (
          <p className="blk-hint">Choose “Whole Moon” and click anywhere on it.</p>
        )}
      </div>
    </Fold>
  )
}

function sunWhy(el: number, fraction: number, terrain: boolean): string {
  if (fraction >= 1) return terrain ? 'The whole Sun is above the hills.' : 'The whole Sun is above the horizon.'
  if (fraction > 0) return terrain ? 'Only part of the Sun peeks over the hills.' : 'Only part of the Sun is above the horizon.'
  if (el > 0 && terrain) return 'The Sun is a little above flat ground, but the hills around are taller, so they hide it.'
  return 'The Sun is below the horizon.'
}

function earthWhy(el: number, contact: boolean, terrain: boolean): string {
  if (contact) return 'Earth is in the sky, so a lander here could radio home directly.'
  if (el > 0 && terrain) return 'Earth is up there, but behind the hills. Radio goes in straight lines, so a lander has to wait.'
  return 'Earth is below the horizon: no direct radio call until it comes back.'
}

function Sky() {
  const { view, info, outOfRange } = useNow()
  const params = useParams()
  const deg = (v: number) => `${v.toFixed(2)}°`
  const terrain = view?.horizonKind === 'terrain'
  return (
    <section className="float float-right blk-panel blk-sky" aria-labelledby="blk-sky">
      <h2 id="blk-sky" className="blk-h">
        The sky now
      </h2>
      {info && (
        <p className="blk-sub">
          {info.name}
          {view && <span className="blk-time"> · {formatUtc(view.tMs)}</span>}
        </p>
      )}
      {outOfRange && (
        <p className="error" role="alert">
          This date is outside the Sun and Earth tables (2025–2035).
        </p>
      )}
      {view && (
        <>
          <div className="blk-answers" aria-live="polite">
            <div className="blk-answer blk-sun">
              <p className="blk-q">Is the Sun up?</p>
              <p className="blk-a">{view.sun.fraction >= 1 ? 'YES' : view.sun.fraction > 0 ? 'PARTLY' : 'NO'}</p>
              {view.nextSun && (
                <p className="blk-when">
                  {view.nextSun.kind === 'rise' ? 'Back in' : 'Sets in'} <strong>{simpleDuration(view.nextSun.inMs)}</strong>
                </p>
              )}
            </div>
            <div className="blk-answer blk-earth">
              <p className="blk-q">Can we see Earth?</p>
              <p className="blk-a">{view.earth.fraction >= params.commsMinFraction ? 'YES' : 'NO'}</p>
              {view.nextEarth && (
                <p className="blk-when">
                  {view.nextEarth.kind === 'rise' ? 'Back in' : 'Sets in'} <strong>{simpleDuration(view.nextEarth.inMs)}</strong>
                </p>
              )}
            </div>
          </div>
          {!terrain && (
            <p className="blk-note">
              Nobody has measured the skyline here, so these answers pretend the Moon is smooth. Real hills could change them.
            </p>
          )}
          <details className="blk-real">
            <summary>Why? And the real numbers</summary>
            <p className="blk-why">{sunWhy(view.sun.el, view.sun.fraction, terrain)}</p>
            <p className="blk-why">{earthWhy(view.earth.el, view.earth.fraction >= params.commsMinFraction, terrain)}</p>
            <p className="blk-legend-sky">
              <span className="blk-dot blk-dot-sun" aria-hidden="true" /> Gold ball: the Sun
              <span className="blk-dot blk-dot-earth" aria-hidden="true" /> Blue ball: the Earth
            </p>
            <dl>
              <dt>Sun</dt>
              <dd>
                elevation {deg(view.sun.el)}, azimuth {view.sun.az.toFixed(1)}°, {Math.round(view.sun.fraction * 100)} % of the disc visible
              </dd>
              <dt>Earth</dt>
              <dd>
                elevation {deg(view.earth.el)}, azimuth {view.earth.az.toFixed(1)}°, {Math.round(view.earth.fraction * 100)} % of the disc visible
              </dd>
              <dt>Horizon</dt>
              <dd>
                {terrain ? `LOLA terrain horizon, ${view.mastUsedM} m mast` : `smooth sphere (no terrain mask here), ${view.mastUsedM} m mast`} ·{' '}
                {view.source === 'api' ? 'API' : 'browser engine'}
              </dd>
            </dl>
          </details>
        </>
      )}
    </section>
  )
}

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function NextDays() {
  const { series } = useNow()
  const params = useParams()
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const tMs = useApp((s) => s.tMs)
  const playing = useApp((s) => s.playing)
  const { setPlaying, setTime } = useApp.getState()
  const days = Math.min(60, Math.max(1, Math.ceil(durationH / 24)))
  const blocks = series ? dayBlocks(series.t, series.samples.map(isSunlit), series.samples.map((s) => hasComms(s, params)), startMs, days) : []
  const today = Math.floor((tMs - startMs) / MS_PER_DAY)
  const fill = (v: number, on: string) => (Number.isNaN(v) ? 'is-none' : v >= 0.999 ? on : v > 0 ? `${on}-part` : 'is-off')
  const sunDays = blocks.filter((b) => b.sun > 0).length
  const earthDays = blocks.filter((b) => b.earth > 0).length
  const label = (b: (typeof blocks)[number], d: number) =>
    `${fmtDay(b.startMs)}: Sun ${Number.isNaN(b.sun) ? 'unknown' : `${Math.round(b.sun * 100)} %`} of the day, Earth ${Number.isNaN(b.earth) ? 'unknown' : `${Math.round(b.earth * 100)} %`}${d === today ? ' (now)' : ''}`

  return (
    <div className="float float-bottom blk-bottom">
      <section className="blk-panel" aria-labelledby="blk-days">
        <div className="blk-days-head">
          <h2 id="blk-days" className="blk-h">
            The next {days} days
          </h2>
          <div className="blk-play">
            <button type="button" onClick={() => setTime(tMs - MS_PER_DAY)} aria-label="One day back">
              ◂ Day
            </button>
            <button type="button" className="blk-play-main" aria-pressed={playing} onClick={() => setPlaying(!playing)}>
              {playing ? 'Pause' : 'Play the days'}
            </button>
            <button type="button" onClick={() => setTime(tMs + MS_PER_DAY)} aria-label="One day forward">
              Day ▸
            </button>
          </div>
        </div>
        {blocks.length > 0 && (
          <div className="blk-rows">
            {(['sun', 'earth'] as const).map((row) => (
              <div key={row} className="blk-row">
                <span className={`blk-row-name blk-${row}-t`}>{row === 'sun' ? 'Sun' : 'Earth'}</span>
                <div className="blk-cells">
                  {blocks.map((b, d) => (
                    <button
                      key={d}
                      type="button"
                      className={`blk-cell ${fill(b[row], row === 'sun' ? 'is-sun' : 'is-earth')}${d === today ? ' is-today' : ''}`}
                      aria-label={label(b, d)}
                      aria-current={d === today ? 'date' : undefined}
                      onClick={() => setTime(b.startMs + 12 * MS_PER_HOUR)}
                    />
                  ))}
                </div>
              </div>
            ))}
            <div className="blk-row blk-dates" aria-hidden="true">
              <span className="blk-row-name" />
              <span>{fmtDay(startMs)}</span>
              <span>{fmtDay(startMs + (days - 1) * MS_PER_DAY)}</span>
            </div>
          </div>
        )}
        <p className="blk-legend">
          1 block = 1 day (striped: part of the day). Sun on {sunDays} of {days} days, Earth on {earthDays}.
        </p>
      </section>
    </div>
  )
}

export function BlockPanels() {
  return (
    <>
      <Places />
      <Sky />
      <StoryCard />
      <NextDays />
    </>
  )
}
