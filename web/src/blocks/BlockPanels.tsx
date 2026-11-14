/**
 * Block Moon's panels: three simple steps for learners (pick a place, look at the sky, the next days). Every
 * answer comes from the same engine and data as the planner's panels; "Show the real numbers" opens them.
 */
import { Link } from 'react-router-dom'
import { useNow } from '../panels/useNow'
import { sameSelection, useApp } from '../state/store'
import { MS_PER_DAY, MS_PER_HOUR } from '../time/engine'
import { hasComms, isSunlit } from '../time/engine'
import { useMasks, useParams } from '../time/hooks'
import type { StaticSite } from '../time/staticData'
import { dayBlocks, simpleDuration } from './voxels'
import './blocks.css'

/** Places the ground view can show: catalogue sites south of 60° S. */
function kindOf(s: StaticSite): 'mountain' | 'lander' | 'crater' {
  if (/^mons /i.test(s.name)) return 'mountain'
  if (s.group === 'Recent landers') return 'lander'
  return 'crater'
}

const ICONS = {
  mountain: 'M3 2h2v1H3zM2 3h4v1H2zM1 4h6v3H1z',
  crater: 'M0 2h2v5H0zM6 2h2v5H6zM2 5h4v2H2z',
  lander: 'M2 2h4v3H2zM1 5h1v2H1zM6 5h1v2H6z',
}
const KIND_TEXT = { mountain: 'A mountain', crater: 'A crater', lander: 'Where a lander went' }

function PixelIcon({ path, color }: { path: string; color: string }) {
  return (
    <svg width="28" height="28" viewBox="0 0 8 8" aria-hidden="true" shapeRendering="crispEdges">
      <rect width="8" height="8" fill="#0b0c0e" />
      <path d={path} fill={color} />
    </svg>
  )
}

function PickPlace() {
  const masks = useMasks().data
  const selection = useApp((s) => s.selection)
  const select = useApp((s) => s.select)
  const sites = masks?.doc.sites.filter((s) => s.lat <= -60) ?? []
  return (
    <section className="float float-left blk-panel" aria-labelledby="blk-pick">
      <h2 id="blk-pick" className="blk-h">
        <span aria-hidden="true">1</span> Pick a place
      </h2>
      <p className="blk-sub">Real places near the Moon's south pole.</p>
      <div className="blk-places">
        {sites.map((s) => {
          const k = kindOf(s)
          const on = sameSelection(selection, { kind: 'site', id: s.id })
          return (
            <button key={s.id} type="button" className="blk-place" aria-pressed={on} onClick={() => select({ kind: 'site', id: s.id })}>
              <PixelIcon path={ICONS[k]} color={k === 'lander' ? '#ffb547' : '#b2b3b7'} />
              <span>
                <span className="blk-place-name">{s.name}</span>
                <span className="blk-place-kind">{KIND_TEXT[k]}</span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="blk-fact">
        <p className="blk-fact-h">Why the south pole?</p>
        <p>
          Here the Sun never climbs high. It slides along the edge of the sky, so hilltops can stay sunny for days while some crater floors stay
          in shadow.
        </p>
      </div>
    </section>
  )
}

function sunWhy(el: number, fraction: number): string {
  if (fraction >= 1) return 'The whole Sun is above the hills.'
  if (fraction > 0) return 'Only part of the Sun peeks over the hills.'
  if (el > 0) return 'The Sun is a little above flat ground, but the hills around are taller, so they hide it.'
  return 'The Sun is below the horizon.'
}

function earthWhy(el: number, contact: boolean): string {
  if (contact) return 'Earth is above the hills, so a lander here could radio home directly.'
  if (el > 0) return 'Earth is up there, but behind the hills. Radio goes in straight lines, so the lander has to wait.'
  return 'Earth is below the horizon. No direct radio call until it comes back.'
}

function LookAtSky() {
  const { view, info, outOfRange } = useNow()
  const params = useParams()
  const deg = (v: number) => `${v.toFixed(2)}°`
  return (
    <section className="float float-right blk-panel" aria-labelledby="blk-sky">
      <h2 id="blk-sky" className="blk-h">
        <span aria-hidden="true">2</span> Look at the sky
      </h2>
      {info && <p className="blk-sub">At {info.name}</p>}
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
          <p className="blk-why">{sunWhy(view.sun.el, view.sun.fraction)}</p>
          <p className="blk-why">{earthWhy(view.earth.el, view.earth.fraction >= params.commsMinFraction)}</p>
          <p className="blk-tip">
            In the world of cubes, the <span className="blk-sun-t">gold cube</span> is the Sun and the <span className="blk-earth-t">blue cube</span> is the
            Earth. Choose “Stand here” and turn the view to find them.
          </p>
          <details className="blk-real">
            <summary>Show the real numbers</summary>
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
                {view.horizonKind === 'terrain' ? `LOLA terrain horizon, ${view.mastUsedM} m mast` : `smooth sphere (no terrain mask here), ${view.mastUsedM} m mast`} ·{' '}
                {view.source === 'api' ? 'API' : 'browser engine'}
              </dd>
            </dl>
          </details>
        </>
      )}
      <Link className="blk-quest" to="/learn">
        <span className="blk-quest-h">Try a challenge</span>
        <span>Which place gets more sunlight? Find out with the tool.</span>
      </Link>
    </section>
  )
}

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
    `Day ${d + 1}: Sun ${Number.isNaN(b.sun) ? 'unknown' : `${Math.round(b.sun * 100)} %`} of the day, Earth ${Number.isNaN(b.earth) ? 'unknown' : `${Math.round(b.earth * 100)} %`}`

  return (
    <div className="float float-bottom blk-bottom">
      <section className="blk-panel" aria-labelledby="blk-days">
        <div className="blk-days-head">
          <h2 id="blk-days" className="blk-h">
            <span aria-hidden="true">3</span> The next {days} days
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
          </div>
        )}
        <p className="blk-legend">
          One block = one Earth day (full colour: all day, light: part of the day). Sun seen on {sunDays} of {days} days, Earth on {earthDays}.
        </p>
      </section>
    </div>
  )
}

export function BlockPanels() {
  return (
    <>
      <PickPlace />
      <LookAtSky />
      <NextDays />
    </>
  )
}
