/**
 * The missions on screen, built for children: one thing at a time, pictures first and few words.
 *   - The mission map: every mission as a big picture button, in three groups, with a star on the ones done, the
 *     explorer's rank, and one big button for the next mission.
 *   - A mission: first its story as a comic strip (a big picture and a few words per beat, with where, when and the
 *     source), then the things to do. The step to do now is the highlighted one, with its picture, its tip and,
 *     where the tool can do it, one big button (play, fly to a place, stand here). Steps tick themselves from what
 *     the child does, with a pop. Then one question as big picture tiles (a wrong pick shakes, is crossed out and
 *     the child tries again), and a confetti win with the engine's numbers.
 * Pictures are emoji, hidden from screen readers: the words next to them always say the same thing.
 * The checklist reads the same state as everything else (place, view, time, the engine's answers), so nothing is
 * typed by hand.
 */
import { type CSSProperties, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useNow } from '../panels/useNow'
import { useApp } from '../state/store'
import { evaluateWindow, useEphemeris, useMasks, useParams, useSiteNames } from '../time/hooks'
import { evaluateAt, isSunlit } from '../time/engine'
import { IconBack, IconPause, IconPlay } from '../ui/icons'
import { MissionIcon } from './MissionIcon'
import { CHAPTERS, GROUPS, type Chapter, type Step, type StepAction, type StoryCtx, chapterDone, eclipseSpan, firstDay, questionReady, rankOf, stepsOf } from './story'
import { nextMission, useHud, useStory } from './useStory'

const H = 3_600_000
/** Chapters without a date of their own run in the present tables (2025–2035), not in an Apollo year. */
const PRESENT_TABLES_MS = Date.UTC(2025, 0, 1)

function useStoryCtx(): StoryCtx {
  const selection = useApp((s) => s.selection)
  const view = useApp((s) => s.blockView)
  const tMs = useApp((s) => s.tMs)
  const durationH = useApp((s) => s.durationH)
  const { view: now, series, info } = useNow()
  const params = useParams()
  const masks = useMasks().data
  const names = useSiteNames()
  const sunOnScreen = useHud((s) => s.sunOnScreen)
  const earthOnScreen = useHud((s) => s.earthOnScreen)
  const memory = useStory((s) => s.memory)
  const sunElMax = series && series.samples.length ? series.samples.reduce((m, s) => Math.max(m, s.sun.el), -90) : null
  return {
    view,
    selection,
    placeName: info?.name ?? null,
    horizonKind: now?.horizonKind ?? null,
    sunUp: now ? now.sun.fraction > 0 : null,
    earthContact: now ? now.earth.fraction >= params.commsMinFraction : null,
    sunEl: now?.sun.el ?? null,
    sunElMax,
    sunOnScreen,
    earthOnScreen,
    eclipse: now?.eclipse ?? null,
    tMs,
    windowDays: Math.round(durationH / 24),
    metrics: series?.metrics ?? null,
    memory,
    names: (id) => names.get(id) ?? masks?.site(id)?.name ?? id,
  }
}

/** Sets each mission's scene, records the sites visited, ticks steps off and pauses playback when they are done. */
function useStoryEffects(ctx: StoryCtx) {
  const { chapter, stage, screen, phase, setStage, remember, markDone } = useStory()
  const { view: now, series, info } = useNow()
  const masks = useMasks().data
  const eph = useEphemeris().data
  const params = useParams()
  const ch = CHAPTERS[chapter]
  const selection = useApp((s) => s.selection)
  const active = screen === 'mission'

  // 1. move the place, date and view
  useEffect(() => {
    if (!active || stage !== 'apply') return
    const app = useApp.getState()
    const { scene } = ch
    app.setPlaying(false)
    if (scene.site) app.select({ kind: 'site', id: scene.site })
    if (scene.atMs !== undefined) app.setStart(scene.atMs)
    else if (app.startMs < PRESENT_TABLES_MS) app.setStart(Math.floor(Date.now() / H) * H)
    if (scene.view) app.set({ blockView: scene.view })
    if (scene.speed) app.setSpeed(scene.speed)
    setStage('settle')
  }, [active, stage, ch, setStage])

  // 2. once the engine has the new place and time, record where the mission starts
  useEffect(() => {
    if (!active || stage !== 'settle' || !now || !series || !info) return
    const app = useApp.getState()
    const { scene } = ch
    const expected = scene.site ? masks?.site(scene.site)?.name : null
    if (expected && info.name !== expected) return
    if (Math.abs(now.tMs - app.tMs) > 60_000) return
    // the sky at the moment the mission starts: now, or the sunrise it jumps to
    let at: { tMs: number; sun: { az: number; el: number; fraction: number }; earth: { az: number; el: number } } = { tMs: app.tMs, sun: now.sun, earth: now.earth }
    let targetMs: number | null = null
    let eclipse: { totalH: number; anyH: number } | null = null
    if (scene.atSunrise && eph) {
      // a series of its own around the date, so a full lunar day (sunrise to sunset) is always inside it
      const around = evaluateWindow(eph.table, info.model, app.tMs - 35 * 24 * H, 75 * 24, 20, params)
      const day = around && firstDay(around.t, around.samples.map(isSunlit))
      if (around && day) {
        app.setStart(around.t[day.rise] + (scene.afterSunriseH ?? 0) * H)
        const tMs = useApp.getState().tMs
        const first = scene.afterSunriseH ? evaluateAt(eph.table, info.model, tMs, params) : around.samples[day.rise]
        at = { tMs, sun: first.sun, earth: first.earth }
        targetMs = around.t[day.set]
      }
    }
    if (scene.until === 'eclipse' && eph) {
      // five-minute samples over the next two days: the eclipse's middle and its length, to five minutes
      const fine = evaluateWindow(eph.table, info.model, app.tMs, 48, 5, params)
      const span = fine && eclipseSpan(fine.t, fine.samples.map((s) => s.eclipse))
      if (span) {
        targetMs = span.midMs
        eclipse = { totalH: span.totalH, anyH: span.anyH }
      }
    }
    // look from the Sun's side, so the Sun is behind the camera and has to be found; and tip the camera up far enough
    // that the body to find comes into the picture by turning alone
    const find = scene.find ?? (scene.lookAway ? 'sun' : null)
    useHud.setState((h) => ({
      lookSeq: h.lookSeq + 1,
      lookFromAz: scene.lookAway ? at.sun.az : null,
      lookEl: find ? at[find].el : null,
      ...(scene.lookAway ? { sunOnScreen: false, earthOnScreen: false } : {}),
    }))
    remember({ startTMs: at.tMs, startSunUp: at.sun.fraction > 0, startSunEl: at.sun.el, startEarthEl: at.earth.el, startSel: app.selection, targetMs, eclipse })
    setStage(null)
  }, [active, stage, now, series, info, masks, eph, params, ch, remember, setStage])

  /** The scene is set: the world is at the mission's place and time. */
  const sceneSet = active && stage === null
  // the sunlight and Earth contact of each catalogue site the explorer opens, for the missions that compare places
  useEffect(() => {
    if (!sceneSet || selection.kind !== 'site' || !series) return
    const visited = useStory.getState().memory.visited
    if (visited[selection.id]) return
    remember({ visited: { ...visited, [selection.id]: { sunPct: series.metrics.sunlightPct, earthPct: series.metrics.commsPct } } })
  }, [sceneSet, selection, series, remember])

  const live = ch.steps(ctx)
  const steps = stepsOf(ch, ctx)
  // steps only count once the story has been read and the mission started
  const ready = sceneSet && phase === 'play'

  // a step reached stays ticked for the rest of the mission
  useEffect(() => {
    if (!ready) return
    const latched = useStory.getState().memory.latched
    const fresh = live.flatMap((s, i) => (s.done && !latched.includes(i) ? [i] : []))
    if (fresh.length) remember({ latched: [...latched, ...fresh] })
  })
  const stepsDone = ready && steps.every((s) => s.done)
  // the steps end while time is playing (a sunset, an eclipse, some days gone by): stop, so the child sees the moment
  useEffect(() => {
    if (!stepsDone) return
    const app = useApp.getState()
    if (app.playing) app.setPlaying(false)
    // playback overshoots: go back to the moment itself
    const target = useStory.getState().memory.targetMs
    if (target !== null && app.tMs > target) app.setTime(target)
  }, [stepsDone])
  const complete = ready && chapterDone(ch, ctx)
  useEffect(() => {
    if (complete) markDone(ch.id)
  }, [complete, ch.id, markDone])
  return { steps, complete, ready, sceneSet }
}

/**
 * Where the card starts: just under the top bars, which wrap to two rows on a narrow window. Returns a CSS `top`
 * in px, or undefined until measured (the stylesheet's default applies).
 */
function useBelowTopBars(): number | undefined {
  const [top, setTop] = useState<number>()
  useLayoutEffect(() => {
    const bars = document.querySelector('.top-left')
    const nav = document.querySelector('.navigator')
    if (!bars || !nav) return
    const measure = () => {
      const kids = Array.from(bars.children).map((k) => k.getBoundingClientRect().bottom)
      const bottom = Math.max(bars.getBoundingClientRect().top, ...kids)
      setTop(Math.round(bottom - nav.getBoundingClientRect().top + 10))
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(bars)
    Array.from(bars.children).forEach((k) => ro?.observe(k))
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  return top
}

/** The mission's own picture in the card's corner. */
function Badge({ id }: { id: string }) {
  return (
    <span className="blk-badge" aria-hidden="true">
      <MissionIcon id={id} size={28} />
    </span>
  )
}

/** One mission on the map: its picture and short name, a star once it is done, "Next" on the one to do next. */
function MissionTile({ ch, done, next, onPick }: { ch: Chapter; done: boolean; next: boolean; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        className={`blk-mission${done ? ' is-done' : ''}${next ? ' is-next' : ''}`}
        // the visible name first (WCAG 2.5.3), without saying it twice when the title already starts with it
        aria-label={`${ch.title.startsWith(ch.short) ? ch.title : `${ch.short}: ${ch.title}`}${done ? ', done' : next ? ', next' : ''}`}
        title={`${ch.tag}: ${ch.title}`}
        onClick={onPick}
      >
        <span className="blk-mission-icon">
          <MissionIcon id={ch.id} size={30} />
        </span>
        <span className="blk-mission-name">{ch.short}</span>
        {done ? (
          <span className="blk-mission-star" aria-hidden="true">
            ★
          </span>
        ) : (
          next && (
            <span className="blk-mission-next" aria-hidden="true">
              Next
            </span>
          )
        )}
      </button>
    </li>
  )
}

/** The mission map: the stars and the rank, one big button for the next mission, and every mission by group. */
function MissionMap({ done, headingId, onPick, onHide, onReset }: { done: string[]; headingId: string; onPick: (i: number) => void; onHide: () => void; onReset: () => void }) {
  const total = CHAPTERS.length
  const stars = CHAPTERS.filter((c) => done.includes(c.id)).length
  const all = stars === total
  const next = nextMission(done)
  return (
    <>
      <div className="blk-story-top">
        <Badge id="apollo-11" />
        <div className="blk-story-head">
          <p className="blk-kicker">{total} Moon missions</p>
          <h2 id={headingId} className="blk-title">
            Be a Moon explorer!
          </h2>
        </div>
        <button type="button" className="icon" aria-expanded={true} aria-label="Hide the missions" onClick={onHide}>
          −
        </button>
      </div>
      <p className="blk-intro">
        <span aria-hidden="true">🚀 </span>Go where real landers went!
      </p>

      <div className="blk-rank">
        <span className="blk-rank-star" aria-hidden="true">
          ★
        </span>
        <p className="blk-rank-text">
          <strong>
            {stars} of {total} stars
          </strong>
          <span>{rankOf(stars, total)}</span>
        </p>
        <div className="blk-meter" role="progressbar" aria-label="Missions done" aria-valuemin={0} aria-valuemax={total} aria-valuenow={stars}>
          <span style={{ width: `${(stars / total) * 100}%` }} />
        </div>
      </div>

      {all ? (
        <div className="blk-win">
          <p className="blk-win-h">Every mission done!</p>
          <p>You found out that:</p>
          <ul>
            {CHAPTERS.map((c) => (
              <li key={c.id}>{c.lesson}</li>
            ))}
          </ul>
        </div>
      ) : (
        <button type="button" className="blk-big blk-wide" onClick={() => onPick(next)}>
          <IconPlay size={18} />
          <span>
            {stars ? 'Next mission' : 'Start'}: {CHAPTERS[next].title}
          </span>
        </button>
      )}

      <nav aria-label="Missions">
        {GROUPS.map((g) => (
          <section key={g.id} className="blk-group" aria-labelledby={`${headingId}-${g.id}`}>
            <h3 id={`${headingId}-${g.id}`} className="blk-group-h">
              <MissionIcon id={g.icon} size={18} />
              <span>{g.title}</span>
              <span className="blk-group-blurb">{g.blurb}</span>
            </h3>
            <ul className="blk-missions">
              {CHAPTERS.map((c, i) =>
                c.group === g.id ? <MissionTile key={c.id} ch={c} done={done.includes(c.id)} next={!all && i === next} onPick={() => onPick(i)} /> : null,
              )}
            </ul>
          </section>
        ))}
      </nav>
      {all && (
        <div className="blk-story-actions">
          <button type="button" className="blk-big" onClick={onReset}>
            Play again
          </button>
        </div>
      )}
    </>
  )
}

/** The one big button of a step: the tool does the step's action for the child. */
function StepButton({ action, onLook }: { action: StepAction; onLook: () => void }) {
  const playing = useApp((s) => s.playing)
  if (action.kind === 'play') {
    return (
      <button type="button" className="blk-do" aria-pressed={playing} onClick={() => useApp.getState().setPlaying(!playing)}>
        {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
        <span>{playing ? 'Pause' : 'Play'}</span>
      </button>
    )
  }
  const run = () => {
    const app = useApp.getState()
    if (action.kind === 'site') app.select({ kind: 'site', id: action.id })
    else if (action.kind === 'view') app.set({ blockView: action.view })
    else onLook()
  }
  return (
    <button type="button" className="blk-do" onClick={run}>
      {action.label}
    </button>
  )
}

/** The things to do, in order: done ones ticked, the one to do now opened with its tip and its button. */
function Steps({ steps, onLook }: { steps: Step[]; onLook: (i: number) => void }) {
  const now = steps.findIndex((s) => !s.done)
  return (
    <ol className="blk-tasks">
      {steps.map((s, i) => (
        <li key={i} className={s.done ? 'is-done' : i === now ? 'is-now' : 'is-later'} aria-current={i === now ? 'step' : undefined}>
          <span className="blk-check" aria-hidden="true">
            {s.done ? '✓' : i === now ? s.icon : i + 1}
          </span>
          <div className="blk-task-body">
            <p className="blk-task-text">
              {s.text}
              <span className="sr-only">{s.done ? ' (done)' : i === now ? ' (do this now)' : ' (later)'}</span>
            </p>
            {i === now && (
              <>
                <p className="blk-tip">{s.tip}</p>
                {s.action && <StepButton action={s.action} onLook={() => onLook(i)} />}
              </>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

/** A burst of confetti over the win box: decoration only, still under reduced motion (the stylesheet hides it). */
const CONFETTI = ['#ffb547', '#6cb2ff', '#7ee2a8', '#ff7aa8', '#ffffff', '#c39bff']
function Confetti() {
  return (
    <span className="blk-confetti" aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => (
        <span
          key={i}
          style={
            {
              '--x': `${((i * 37) % 100) - 50}`,
              '--d': `${(i % 7) * 40}ms`,
              '--r': `${(i * 53) % 360}deg`,
              background: CONFETTI[i % CONFETTI.length],
            } as CSSProperties
          }
        />
      ))}
    </span>
  )
}

export function StoryCard() {
  const ctx = useStoryCtx()
  const { chapter, done, screen, phase, open, begin, start, home, setOpen, reset, remember } = useStory()
  const { steps, complete, ready, sceneSet } = useStoryEffects(ctx)
  const headingId = useId()
  const top = useBelowTopBars()
  const place: CSSProperties | undefined = top === undefined ? undefined : { top, maxHeight: `calc(100vh - ${top}px - var(--inset-bottom) - 20px)` }
  const ch = CHAPTERS[chapter]
  const total = CHAPTERS.length
  const stars = CHAPTERS.filter((c) => done.includes(c.id)).length
  const { memory } = ctx
  const parts = steps.length + (ch.question ? 1 : 0)
  const partsDone = steps.filter((s) => s.done).length + (ch.question && memory.answer !== null ? 1 : 0)
  const asking = ready && questionReady(ch, ctx) && memory.answer === null
  const found = complete ? ch.found(ctx) : null
  // the next mission to offer: the next one not done after this one, else any one not done
  const open2 = (i: number) => !done.includes(CHAPTERS[i].id) && i !== chapter
  const after = CHAPTERS.findIndex((_, i) => i > chapter && open2(i))
  const nextUp = after >= 0 ? after : CHAPTERS.findIndex((_, i) => open2(i))
  // the question, then the answer and the "Next" button, appear at the foot of a card that may be taller than the
  // window: bring them into view rather than leave them below the fold
  const foot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!asking && !complete) return
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    foot.current?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [asking, complete])
  const goHome = () => {
    useApp.getState().setPlaying(false)
    home()
  }
  const pick = (id: string) => {
    if (!ch.question) return
    if (id === ch.question.answer(ctx)) remember({ answer: id })
    else if (!memory.wrong.includes(id)) remember({ wrong: [...memory.wrong, id] })
  }
  const look = (i: number) => {
    const latched = useStory.getState().memory.latched
    if (!latched.includes(i)) remember({ latched: [...latched, i] })
  }

  if (!open) {
    const onMap = screen === 'map'
    return (
      <section className="blk-story is-closed" style={place} aria-labelledby={headingId}>
        <div className="blk-story-top">
          <Badge id={onMap ? 'apollo-11' : ch.id} />
          <h2 id={headingId} className="blk-story-mini">
            {onMap ? 'Moon missions' : ch.title}
            <span className="blk-kicker">{onMap ? `${stars} of ${total} stars` : complete ? 'done' : phase === 'story' ? 'the story' : `${partsDone} of ${parts}`}</span>
          </h2>
          <button type="button" className="icon" aria-expanded={false} aria-label="Show the missions" onClick={() => setOpen(true)}>
            +
          </button>
        </div>
      </section>
    )
  }

  if (screen === 'map') {
    return (
      <section className="blk-story blk-map" style={place} aria-labelledby={headingId}>
        <MissionMap done={done} headingId={headingId} onPick={begin} onHide={() => setOpen(false)} onReset={reset} />
      </section>
    )
  }

  const story = (
    <>
      <ol className={`blk-strip n${ch.story.length}`}>
        {ch.story.map((b, i) => (
          <li key={b.text} style={{ '--i': i } as CSSProperties}>
            <span className="blk-strip-icon" aria-hidden="true">
              {b.icon}
            </span>
            <span className="blk-strip-text">{b.text}</span>
          </li>
        ))}
      </ol>
      <dl className="blk-chips">
        <div>
          <dt>
            <span aria-hidden="true">📍</span>
            <span className="sr-only">Where</span>
          </dt>
          <dd>{ch.where}</dd>
        </div>
        <div>
          <dt>
            <span aria-hidden="true">📅</span>
            <span className="sr-only">When</span>
          </dt>
          <dd>{ch.when}</dd>
        </div>
      </dl>
      <a className="blk-source" href={ch.source.url} target="_blank" rel="noreferrer">
        Source: {ch.source.label}
      </a>
    </>
  )

  return (
    <section className="blk-story" style={place} aria-labelledby={headingId}>
      <div className="blk-story-bar">
        <button type="button" className="blk-back" onClick={goHome}>
          <IconBack size={16} />
          <span>All missions</span>
        </button>
        <button type="button" className="icon" aria-expanded={true} aria-label="Hide the missions" onClick={() => setOpen(false)}>
          −
        </button>
      </div>
      <div className="blk-story-top">
        <Badge id={ch.id} />
        <div className="blk-story-head">
          <p className="blk-kicker">
            Mission {chapter + 1} of {total} · {ch.tag}
          </p>
          <h2 id={headingId} className="blk-title">
            {ch.title}
          </h2>
        </div>
      </div>

      {phase === 'story' ? (
        <>
          {story}
          <div className="blk-story-actions">
            <button type="button" className="blk-big blk-wide" onClick={start}>
              <IconPlay size={18} />
              <span>Start the mission</span>
            </button>
          </div>
          <p className="blk-meta" role="status">
            {sceneSet ? '' : 'Flying there…'}
          </p>
        </>
      ) : (
        <>
          <div className="blk-pips" role="img" aria-label={`${partsDone} of ${parts} done`}>
            {Array.from({ length: parts }, (_, i) => (
              <span key={i} className={i < partsDone ? 'is-on' : ''} />
            ))}
            <span className={`blk-pip-star${complete ? ' is-on' : ''}`}>★</span>
          </div>
          {!ready ? (
            <p className="blk-meta" role="status">
              Flying there…
            </p>
          ) : (
            <>
              <h3 className="blk-task-h">{complete ? 'What you did' : 'What to do'}</h3>
              <Steps steps={steps} onLook={look} />
              {asking && ch.question && (
                <div className="blk-ask">
                  <p className="blk-question" id={`${headingId}-q`}>
                    {ch.question.text}
                  </p>
                  <div className={`blk-choices n${ch.question.choices.length}`} role="group" aria-labelledby={`${headingId}-q`}>
                    {ch.question.choices.map((c) => {
                      const wrong = memory.wrong.includes(c.id)
                      return (
                        <button key={c.id} type="button" className={wrong ? 'is-wrong' : ''} disabled={wrong} onClick={() => pick(c.id)}>
                          <span className="blk-choice-icon" aria-hidden="true">
                            {c.icon}
                          </span>
                          <span className="blk-choice-label">
                            {c.label}
                            {wrong && <span className="sr-only"> (not this one)</span>}
                          </span>
                          {wrong && (
                            <span className="blk-choice-x" aria-hidden="true">
                              ✗
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  <p className="blk-try" role="status">
                    {memory.wrong.length > 0 ? 'Oops! Try again!' : ''}
                  </p>
                </div>
              )}
            </>
          )}

          <div role="status" aria-live="polite">
            {complete && (
              <div className="blk-win">
                <Confetti />
                <p className="blk-win-h">
                  <span className="blk-win-star" aria-hidden="true">
                    ★
                  </span>
                  Mission complete!
                  <span className="blk-win-plus" aria-hidden="true">
                    +1 ★
                  </span>
                </p>
                {found && found.stats.length > 0 && (
                  <>
                    <p className="blk-found-h">NASA data says</p>
                    <ul className="blk-stats">
                      {found.stats.map((s, i) => (
                        <li key={s.label} style={{ '--i': i } as CSSProperties}>
                          <span className="blk-stat-icon" aria-hidden="true">
                            {s.icon}
                          </span>
                          <span className="blk-stat-v">{s.value}</span>
                          <span className="blk-stat-l">{s.label}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {found && <p className="blk-found-note">{found.note}</p>}
                <p className="blk-lesson">
                  <span aria-hidden="true">💡 </span>
                  <strong>Remember:</strong> {ch.lesson}
                </p>
              </div>
            )}
          </div>

          <div className="blk-story-actions" ref={foot}>
            {complete && nextUp >= 0 && (
              <button type="button" className="blk-big blk-wide" onClick={() => begin(nextUp)}>
                <IconPlay size={18} />
                <span>Next mission: {CHAPTERS[nextUp].title}</span>
              </button>
            )}
            {complete && (
              <button type="button" className={nextUp >= 0 ? 'blk-ghost' : 'blk-big blk-wide'} onClick={goHome}>
                {nextUp >= 0 ? 'All missions' : 'See all my stars'}
              </button>
            )}
          </div>

          <details className="blk-again">
            <summary>Read the story again</summary>
            {story}
          </details>
        </>
      )}
    </section>
  )
}
