/**
 * Educational mode's panels, laid out like the navigator's: the place search and the date sit in the shared top bars
 * (NavigatorPage), the sky now on the right, the days along the bottom, and the missions over the map on the
 * left. Every answer comes from the same engine and data as the planner's panels; "Why? And the real numbers"
 * opens them.
 */
import { useId, useState } from 'react'
import { useNow } from '../panels/useNow'
import { useApp } from '../state/store'
import { MS_PER_DAY, MS_PER_HOUR, hasComms, isSunlit } from '../time/engine'
import { SPEEDS } from '../time/clock'
import { useParams } from '../time/hooks'
import { IconBack, IconChevron, IconPause, IconPlay, IconSpeed } from '../ui/icons'
import { StoryCard } from './StoryCard'
import { dayBlocks, simpleDuration } from './voxels'
import './blocks.css'

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

/** The sky now, on the right: two plain answers (is the Sun up, can we see Earth) and when they change. */
function Sky() {
  const { view, info, outOfRange } = useNow()
  const params = useParams()
  const [open, setOpen] = useState(true)
  const id = useId()
  const deg = (v: number) => `${v.toFixed(2)}°`
  const terrain = view?.horizonKind === 'terrain'
  const sunUp = view ? (view.sun.fraction >= 1 ? 'Yes' : view.sun.fraction > 0 ? 'Partly' : 'No') : '–'
  const earthUp = view ? (view.earth.fraction >= params.commsMinFraction ? 'Yes' : 'No') : '–'
  return (
    <section className={`float float-right blk-sky${open ? '' : ' is-closed'}`} aria-labelledby={`${id}-h`}>
      <div className="float-head">
        <h2 id={`${id}-h`}>The sky now</h2>
        {!open && view && (
          <span className="blk-sky-mini" aria-hidden="true">
            <span className="blk-mini-sun">Sun {sunUp}</span> · <span className="blk-mini-earth">Earth {earthUp}</span>
          </span>
        )}
        <button
          type="button"
          className="icon"
          aria-expanded={open}
          aria-controls={`${id}-b`}
          aria-label={`${open ? 'Hide' : 'Show'} the sky now`}
          onClick={() => setOpen(!open)}
        >
          {open ? '›' : '‹'}
        </button>
      </div>
      <div id={`${id}-b`} className="float-body" hidden={!open}>
        {info && (
          <p className="blk-place">
            <span className="blk-place-name">{info.name}</span>
            {view && <span className="blk-time">{fmtMoment(view.tMs)}</span>}
          </p>
        )}
        {outOfRange && (
          <p className="error" role="alert">
            This date is outside the Sun and Earth tables (2025–2035, and 1969–1972 for Apollo).
          </p>
        )}
        {view && (
          <>
            <div className="blk-answers" aria-live="polite">
              <div className="blk-answer blk-answer-sun">
                <p className="blk-q">Is the Sun up?</p>
                <p className="blk-a">{sunUp}</p>
                {view.nextSun && (
                  <p className="blk-when">
                    {view.nextSun.kind === 'rise' ? 'Rises in' : 'Sets in'} <strong>{simpleDuration(view.nextSun.inMs)}</strong>
                  </p>
                )}
              </div>
              <div className="blk-answer blk-answer-earth">
                <p className="blk-q">Can we see Earth?</p>
                <p className="blk-a">{earthUp}</p>
                {view.nextEarth && (
                  <p className="blk-when">
                    {view.nextEarth.kind === 'rise' ? 'Rises in' : 'Sets in'} <strong>{simpleDuration(view.nextEarth.inMs)}</strong>
                  </p>
                )}
              </div>
            </div>
            {view.eclipse > 0 && (
              <p className="blk-eclipse" role="status">
                {view.eclipse === 2 ? 'Eclipse! The Earth is hiding the whole Sun.' : 'Eclipse! The Earth is hiding part of the Sun.'}
              </p>
            )}
            {!terrain && (
              <p className="blk-note">Nobody has measured the skyline here, so these answers treat the Moon as smooth. Real hills could change them.</p>
            )}
            <details className="blk-real">
              <summary>Why? And the real numbers</summary>
              <p className="blk-why">{sunWhy(view.sun.el, view.sun.fraction, terrain)}</p>
              <p className="blk-why">{earthWhy(view.earth.el, view.earth.fraction >= params.commsMinFraction, terrain)}</p>
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
      </div>
    </section>
  )
}

/** The date and time as a child reads them: "17 Oct 2026, 17:15" (Earth's clock, no time-zone letters). */
const fmtMoment = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** The days of the window along the bottom: one block per day for the Sun and one for the Earth. */
function NextDays() {
  const { series } = useNow()
  const params = useParams()
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const tMs = useApp((s) => s.tMs)
  const playing = useApp((s) => s.playing)
  const speed = useApp((s) => s.speed)
  const { setPlaying, setSpeed, setTime } = useApp.getState()
  const speedAt = SPEEDS.findIndex((s) => s.id === speed)
  const id = useId()
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
      <section className="blk-days" aria-labelledby={`${id}-h`}>
        <div className="blk-days-head">
          <h2 id={`${id}-h`} className="blk-days-title">
            Day by day
            <span className="blk-days-sum">
              Some Sun on {sunDays} of {days} days · Earth seen on {earthDays}
            </span>
          </h2>
          <div className="tl-icons" role="group" aria-label="Playback">
            <button type="button" className="tl-btn" onClick={() => setTime(tMs - MS_PER_DAY)} aria-label="One day back" title="One day back">
              <IconBack size={18} />
            </button>
            <button
              type="button"
              className="tl-btn blk-play-main"
              aria-pressed={playing}
              aria-label={playing ? 'Pause' : 'Play the days'}
              title={playing ? 'Pause' : 'Play the days'}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
            </button>
            <button type="button" className="tl-btn" onClick={() => setTime(tMs + MS_PER_DAY)} aria-label="One day forward" title="One day forward">
              <IconChevron size={18} />
            </button>
            <button
              type="button"
              className="tl-btn blk-speed"
              aria-label={`Speed: ${SPEEDS[speedAt].label}. Change`}
              title={`Speed: ${SPEEDS[speedAt].label}`}
              onClick={() => setSpeed(SPEEDS[(speedAt + 1) % SPEEDS.length].id)}
            >
              <IconSpeed size={18} />
              <span>{SPEEDS[speedAt].label.replace('/ s', 'a second')}</span>
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
                      title={label(b, d)}
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
        <p className="blk-legend">One block is one day: full when the Sun (or Earth) is up all day, striped for part of the day, dark when not at all.</p>
      </section>
    </div>
  )
}

export function BlockPanels() {
  return (
    <>
      <Sky />
      <StoryCard />
      <NextDays />
    </>
  )
}
