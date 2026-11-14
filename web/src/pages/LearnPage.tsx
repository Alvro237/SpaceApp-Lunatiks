/**
 * Learn: the Lunar Quest challenges (each one opens the navigator on a real scene and asks one question whose
 * answer the engine computes), then the ideas behind them for educators and the public.
 */
import { useNavigate } from 'react-router-dom'
import { QUESTS } from '../learn/quests'
import { useQuest } from '../learn/useQuest'

export function LearnPage() {
  const navigate = useNavigate()
  const done = useQuest((s) => s.done)
  const start = useQuest((s) => s.start)
  const reset = useQuest((s) => s.reset)
  const solved = QUESTS.filter((q) => done[q.id]).length

  const play = (id: string) => {
    start(id)
    navigate('/')
  }

  return (
    <article className="page prose learn">
      <h1>Learn</h1>
      <p className="intro">
        Five short challenges inside the real tool. Each one opens the navigator on a real place and date and asks one question; the answer is worked out
        live from NASA's LOLA terrain and JPL ephemerides, the same numbers mission planners see.
      </p>

      <section aria-labelledby="quest-h" className="quest-hub">
        <div className="quest-hub-head">
          <h2 id="quest-h">Lunar Quest</h2>
          <p className="quest-progress">
            <span className="mono">
              {solved}/{QUESTS.length}
            </span>{' '}
            solved
            {solved > 0 && (
              <button type="button" className="link" onClick={reset}>
                Reset
              </button>
            )}
          </p>
        </div>
        <div className="progress-track" role="img" aria-label={`${solved} of ${QUESTS.length} challenges solved`}>
          <div className="progress-fill" style={{ width: `${(100 * solved) / QUESTS.length}%` }} />
        </div>
        <ol className="quest-grid">
          {QUESTS.map((q, i) => (
            <li key={q.id} className={`quest-tile${done[q.id] ? ' is-done' : ''}`}>
              <span className="quest-num mono" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3>{q.title}</h3>
              <p>{q.teaser}</p>
              <p className="quest-meta">
                <span className="tag-pill">{q.kind}</span>
                {done[q.id] && <span className="quest-done">Solved</span>}
              </p>
              <button type="button" className={done[q.id] ? '' : 'primary'} onClick={() => play(q.id)} aria-label={`${done[q.id] ? 'Play again' : 'Play'}: ${q.title}`}>
                {done[q.id] ? 'Play again' : 'Play'}
              </button>
            </li>
          ))}
        </ol>
      </section>

      <h2>A Sun that skims the horizon</h2>
      <p>
        The Moon's axis is tilted only about 1.5° from upright, so near the poles the Sun never climbs high: it circles the sky a few degrees above or below
        the horizon. A small hill or crater rim is enough to hide it. Some crater floors have not seen sunlight for billions of years (permanent shadow),
        while some ridges are lit most of the time.
      </p>

      <h2>An Earth that rises and sets</h2>
      <p>
        From the near side the Earth hangs almost still in the sky. Near the south pole it sits close to the horizon and rocks up and down by several degrees
        over the month (libration), so a lander can lose direct radio contact for days. Planners need to know both: when the Sun sets for power, and when the
        Earth sets for communication.
      </p>

      <h2>Discs, not points</h2>
      <p>
        The Sun looks about half a degree wide and the Earth almost two degrees. When they graze the terrain, a share of the disc can be hidden: this tool
        reports the visible share, not just above or below.
      </p>

      <h2>No air, sharp shadows</h2>
      <p>
        The Moon has no atmosphere to bend light or scatter it into twilight. A place is lit only by the part of the Sun it can see directly, which is why the
        horizon decides everything.
      </p>

      <h2>Words used in the tool</h2>
      <dl className="glossary">
        <dt>Azimuth</dt>
        <dd>Direction along the horizon, measured clockwise from north (90° is east).</dd>
        <dt>Elevation</dt>
        <dd>Angle above the flat horizontal; negative means below it.</dd>
        <dt>Horizon mask</dt>
        <dd>The height of the skyline in every direction, computed from LOLA laser altimetry of the real terrain.</dd>
        <dt>Mast</dt>
        <dd>Height of the solar panel or antenna above the ground; a taller mast sees over nearby bumps.</dd>
        <dt>UTC</dt>
        <dd>Coordinated Universal Time, used for every date in the tool.</dd>
      </dl>
    </article>
  )
}
