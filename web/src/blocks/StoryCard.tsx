/**
 * The mission log on screen: each chapter sets the world where a real mission was, tells what happened (with its
 * source), gives a task that ticks itself from what the learner does, asks one question, and answers with the
 * engine's numbers. The checklist reads the same state as everything else (place, view, time, the engine's
 * answers), so nothing is typed by hand.
 */
import { useEffect, useId, useLayoutEffect, useState } from 'react'
import { useNow } from '../panels/useNow'
import { useApp } from '../state/store'
import { evaluateWindow, useEphemeris, useMasks, useParams, useSiteNames } from '../time/hooks'
import { isSunlit } from '../time/engine'
import { CHAPTERS, type StoryCtx, chapterDone, firstDay, questionReady, stepsOf } from './story'
import { useHud, useStory } from './useStory'

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
    tMs,
    windowDays: Math.round(durationH / 24),
    metrics: series?.metrics ?? null,
    memory,
    names: (id) => names.get(id) ?? masks?.site(id)?.name ?? id,
  }
}

/** Sets each chapter's scene, records the sites visited, ticks steps off and pauses playback when they are done. */
function useStoryEffects(ctx: StoryCtx) {
  const { chapter, stage, started, setStage, remember, markDone } = useStory()
  const { view: now, series, info } = useNow()
  const masks = useMasks().data
  const eph = useEphemeris().data
  const params = useParams()
  const ch = CHAPTERS[chapter]
  const selection = useApp((s) => s.selection)

  // 1. move the place, date and view
  useEffect(() => {
    if (!started || stage !== 'apply') return
    const app = useApp.getState()
    const { scene } = ch
    app.setPlaying(false)
    if (scene.site) app.select({ kind: 'site', id: scene.site })
    if (scene.atMs !== undefined) app.setStart(scene.atMs)
    else if (app.startMs < PRESENT_TABLES_MS) app.setStart(Math.floor(Date.now() / H) * H)
    if (scene.view) app.set({ blockView: scene.view })
    if (scene.speed) app.setSpeed(scene.speed)
    setStage('settle')
  }, [started, stage, ch, setStage])

  // 2. once the engine has the new place and time, record where the chapter starts
  useEffect(() => {
    if (!started || stage !== 'settle' || !now || !series || !info) return
    const app = useApp.getState()
    const { scene } = ch
    const expected = scene.site ? masks?.site(scene.site)?.name : null
    if (expected && info.name !== expected) return
    if (Math.abs(now.tMs - app.tMs) > 60_000) return
    let startTMs = app.tMs
    let startSunUp = now.sun.fraction > 0
    let startSunEl = now.sun.el
    let targetMs: number | null = null
    if (scene.atSunrise && eph) {
      // a series of its own around the date, so a full lunar day (sunrise to sunset) is always inside it
      const around = evaluateWindow(eph.table, info.model, app.tMs - 35 * 24 * H, 75 * 24, 20, params)
      const day = around && firstDay(around.t, around.samples.map(isSunlit))
      if (around && day) {
        app.setStart(around.t[day.rise])
        startTMs = useApp.getState().tMs
        startSunUp = true
        startSunEl = around.samples[day.rise].sun.el
        targetMs = around.t[day.set]
      }
    }
    // look from the Sun's side, so the Sun is behind the camera and has to be found
    if (scene.lookAway) useHud.setState((h) => ({ lookSeq: h.lookSeq + 1, lookFromAz: now.sun.az, sunOnScreen: false, earthOnScreen: false }))
    remember({ startTMs, startSunUp, startSunEl, startSel: app.selection, targetMs })
    setStage(null)
  }, [started, stage, now, series, info, masks, eph, params, ch, remember, setStage])

  // the sunlight and Earth contact of each catalogue site the learner opens, for the comparison chapter
  useEffect(() => {
    if (!started || stage !== null || selection.kind !== 'site' || !series) return
    const visited = useStory.getState().memory.visited
    if (visited[selection.id]) return
    remember({ visited: { ...visited, [selection.id]: { sunPct: series.metrics.sunlightPct, earthPct: series.metrics.commsPct } } })
  }, [started, stage, selection, series, remember])

  const live = ch.steps(ctx)
  const steps = stepsOf(ch, ctx)
  const ready = started && stage === null

  // a step reached stays ticked for the rest of the chapter
  useEffect(() => {
    if (!ready) return
    const latched = useStory.getState().memory.latched
    const fresh = live.flatMap((s, i) => (s.done && !latched.includes(i) ? [i] : []))
    if (fresh.length) remember({ latched: [...latched, ...fresh] })
  })
  const stepsDone = ready && steps.every((s) => s.done)
  // the steps end while time is playing (a sunset, a day gone by): stop, so the learner sees the moment
  useEffect(() => {
    if (!stepsDone) return
    const app = useApp.getState()
    if (app.playing) app.setPlaying(false)
    // playback overshoots: go back to the sunset itself
    const target = useStory.getState().memory.targetMs
    if (target !== null && app.tMs > target) app.setTime(target)
  }, [stepsDone])
  const complete = ready && chapterDone(ch, ctx)
  useEffect(() => {
    if (complete) markDone(ch.id)
  }, [complete, ch.id, markDone])
  return { steps, complete, ready }
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

/** A small lander drawn in blocks: the mission log's badge. */
function LanderBadge() {
  return (
    <span className="blk-badge" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 8 8" shapeRendering="crispEdges">
        <path d="M2 2h4v3H2z" fill="#ffb547" />
        <path d="M3 3h2v1H3z" fill="#6cb2ff" />
        <path d="M1 5h1v2H1zM6 5h1v2H6z" fill="#cfccc4" />
        <path d="M3.5 0h1v2h-1z" fill="#cfccc4" />
      </svg>
    </span>
  )
}

export function StoryCard() {
  const ctx = useStoryCtx()
  const { chapter, done, started, open, begin, goTo, setOpen, restart, remember } = useStory()
  const { steps, complete, ready } = useStoryEffects(ctx)
  const [hint, setHint] = useState(false)
  const headingId = useId()
  const top = useBelowTopBars()
  const place = top === undefined ? undefined : { top, maxHeight: `calc(100vh - ${top}px - var(--inset-bottom) - 20px)` }
  const ch = CHAPTERS[chapter]
  const last = chapter === CHAPTERS.length - 1
  const doneCount = steps.filter((s) => s.done).length + (ch.question && ctx.memory.answer !== null ? 1 : 0)
  const total = steps.length + (ch.question ? 1 : 0)
  const asking = ready && questionReady(ch, ctx) && ctx.memory.answer === null
  const right = ch.question && ctx.memory.answer !== null ? ctx.memory.answer === ch.question.answer(ctx) : null
  const open1 = (i: number) => {
    setHint(false)
    goTo(i)
  }

  if (!started) {
    return (
      <section className="blk-story" style={place} aria-labelledby={headingId}>
        <div className="blk-story-top">
          <LanderBadge />
          <div className="blk-story-head">
            <p className="blk-kicker">Mission log · {CHAPTERS.length} chapters</p>
            <h2 id={headingId} className="blk-title">
              Why the Sun and the Earth decide
            </h2>
          </div>
        </div>
        <p className="blk-intro">
          Stand where real missions landed and find out, with NASA data, how the Sun and the Earth shaped what happened to them. Then plan a landing of
          your own.
        </p>
        <ol className="blk-intro-list">
          {CHAPTERS.map((c) => (
            <li key={c.id}>
              {c.tag}: {c.title}
            </li>
          ))}
        </ol>
        <div className="blk-story-actions">
          <button type="button" className="blk-big" onClick={begin}>
            Start the first mission
          </button>
        </div>
      </section>
    )
  }

  if (!open) {
    return (
      <section className="blk-story is-closed" style={place} aria-labelledby={headingId}>
        <div className="blk-story-top">
          <LanderBadge />
          <h2 id={headingId} className="blk-story-mini">
            {ch.title}
            <span className="blk-kicker">{complete ? 'done' : `${doneCount} of ${total}`}</span>
          </h2>
          <button type="button" className="icon" aria-expanded={false} aria-label="Show the mission log" onClick={() => setOpen(true)}>
            +
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="blk-story" style={place} aria-labelledby={headingId}>
      <div className="blk-story-top">
        <LanderBadge />
        <div className="blk-story-head">
          <p className="blk-kicker">
            {chapter + 1} of {CHAPTERS.length} · {ch.tag}
          </p>
          <h2 id={headingId} className="blk-title">
            {ch.title}
          </h2>
        </div>
        <button type="button" className="icon" aria-expanded={true} aria-label="Hide the mission log" onClick={() => setOpen(false)}>
          −
        </button>
      </div>
      <nav className="blk-chapters" aria-label="Chapters">
        {CHAPTERS.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={`blk-chapter${done.includes(c.id) ? ' is-done' : ''}`}
            aria-current={i === chapter ? 'step' : undefined}
            aria-label={`Chapter ${i + 1}: ${c.title}${done.includes(c.id) ? ' (done)' : ''}`}
            title={`${c.tag}: ${c.title}`}
            onClick={() => open1(i)}
          >
            {done.includes(c.id) ? '✓' : i + 1}
          </button>
        ))}
      </nav>

      <p className="blk-fact">
        {ch.fact(ctx)}{' '}
        <a className="blk-source" href={ch.source.url} target="_blank" rel="noreferrer">
          Source: {ch.source.label}
        </a>
      </p>

      {!ready ? (
        <p className="blk-meta" role="status">
          Moving to the place and date…
        </p>
      ) : (
        <>
          <h3 className="blk-task-h">Your task</h3>
          <ol className="blk-tasks">
            {steps.map((s, i) => (
              <li key={i} className={s.done ? 'is-done' : ''}>
                <span className="blk-check" aria-hidden="true">
                  {s.done ? '✓' : ''}
                </span>
                <span>
                  {s.text}
                  <span className="sr-only">{s.done ? ' (done)' : ' (to do)'}</span>
                </span>
              </li>
            ))}
          </ol>
          {asking && ch.question && (
            <>
              <p className="blk-question">{ch.question.text}</p>
              <div className="blk-choices" role="group" aria-label={ch.question.text}>
                {ch.question.choices.map((c) => (
                  <button key={c.id} type="button" onClick={() => remember({ answer: c.id })}>
                    {c.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {!complete && (
            <>
              <button type="button" className="blk-link" aria-expanded={hint} onClick={() => setHint(!hint)}>
                {hint ? 'Hide the hint' : 'Need a hint?'}
              </button>
              {hint && <p className="blk-hint-text">{ch.hint}</p>}
            </>
          )}
        </>
      )}

      <div role="status" aria-live="polite">
        {complete && (
          <div className="blk-found">
            <p className="blk-found-h">{right === null ? 'What the data says' : right ? 'Right! What the data says' : 'Not quite. What the data says'}</p>
            <p>{ch.found(ctx)}</p>
          </div>
        )}
      </div>

      {complete && (
        <p className="blk-lesson">
          <strong>Remember:</strong> {ch.lesson}
        </p>
      )}

      {complete && last && (
        <div className="blk-found">
          <p className="blk-found-h">Mission log complete. You found out that:</p>
          <ul>
            {CHAPTERS.map((c) => (
              <li key={c.id}>{c.lesson}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="blk-story-actions">
        {complete && !last && (
          <button type="button" className="blk-big" onClick={() => open1(chapter + 1)}>
            Next: {CHAPTERS[chapter + 1].title}
          </button>
        )}
        {complete && last && (
          <button type="button" className="blk-big" onClick={restart}>
            Start again
          </button>
        )}
      </div>
    </section>
  )
}
