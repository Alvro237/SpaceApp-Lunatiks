/**
 * Pip's journey on screen: the chapter's story, its task as a checklist that ticks itself, and what Pip found.
 * The checklist reads the same state as everything else (place, view, time, the engine's answers), so nothing is
 * typed by hand: the numbers in "What Pip found" are the engine's.
 */
import { useEffect, useId, useMemo, useState } from 'react'
import { useNow } from '../panels/useNow'
import { useApp } from '../state/store'
import { useMasks, useParams, useSiteNames } from '../time/hooks'
import { CHAPTERS, type StoryCtx, chapterDone, stepsOf } from './story'
import { useHud, useStory } from './useStory'

const H = 3_600_000

function useStoryCtx(): StoryCtx {
  const selection = useApp((s) => s.selection)
  const view = useApp((s) => s.blockView)
  const tMs = useApp((s) => s.tMs)
  const { view: now, series } = useNow()
  const params = useParams()
  const masks = useMasks().data
  const names = useSiteNames()
  const sunOnScreen = useHud((s) => s.sunOnScreen)
  const earthOnScreen = useHud((s) => s.earthOnScreen)
  const memory = useStory((s) => s.memory)
  const lat = selection.kind === 'point' ? selection.lat : (masks?.site(selection.id)?.lat ?? null)
  return {
    view,
    selection,
    lat,
    horizonKind: now?.horizonKind ?? null,
    sunUp: now ? now.sun.fraction > 0 : null,
    earthContact: now ? now.earth.fraction >= params.commsMinFraction : null,
    sunEl: now?.sun.el ?? null,
    sunOnScreen,
    earthOnScreen,
    tMs,
    metrics: series?.metrics ?? null,
    memory,
    names: (id) => names.get(id) ?? masks?.site(id)?.name ?? id,
  }
}

/** Runs a chapter's setup, records sites visited, ticks chapters off and pauses playback when a step is reached. */
function useStoryEffects(ctx: StoryCtx) {
  const { chapter, needsSetup, started, setupDone, remember, markDone } = useStory()
  const { view: now, series } = useNow()
  const ch = CHAPTERS[chapter]
  const selection = useApp((s) => s.selection)

  useEffect(() => {
    if (!started || !needsSetup || !now) return
    const app = useApp.getState()
    let startTMs = app.tMs
    let startSunUp = now.sun.fraction > 0
    if (ch.setup === 'land-im2') app.set({ blockView: 'moon' })
    // look from the Sun's side, so the Sun is behind the camera and has to be found
    if (ch.setup === 'look-away') useHud.setState((h) => ({ lookSeq: h.lookSeq + 1, lookFromAz: now.sun.az, sunOnScreen: false, earthOnScreen: false }))
    if (ch.setup === 'after-sunset' && startSunUp && now.nextSun?.kind === 'set') {
      // start the night just after the next sunset, so there is a sunrise to wait for
      startTMs = now.nextSun.atMs + 2 * H
      app.setTime(startTMs)
      startSunUp = false
    }
    app.setPlaying(false)
    remember({ startTMs, startSunUp })
    setupDone()
  }, [started, needsSetup, now, ch, remember, setupDone])

  // the sunlight and Earth contact of each catalogue site the learner opens, for "A better home"
  useEffect(() => {
    if (!started || selection.kind !== 'site' || !series) return
    const visited = useStory.getState().memory.visited
    if (visited[selection.id]) return
    remember({ visited: { ...visited, [selection.id]: { sunPct: series.metrics.sunlightPct, earthPct: series.metrics.commsPct } } })
  }, [started, selection, series, remember])

  const live = ch.steps(ctx)
  const steps = stepsOf(ch, ctx)

  // a step reached stays ticked for the rest of the chapter
  useEffect(() => {
    if (!started || needsSetup) return
    const latched = useStory.getState().memory.latched
    const fresh = live.flatMap((s, i) => (s.done && !latched.includes(i) ? [i] : []))
    if (fresh.length) remember({ latched: [...latched, ...fresh] })
  })
  const complete = started && !needsSetup && chapterDone(ch, ctx)
  useEffect(() => {
    if (!complete) return
    markDone(ch.id)
    // the chapter ends while time is playing: stop, so the learner sees the moment
    if (useApp.getState().playing) useApp.getState().setPlaying(false)
  }, [complete, ch.id, markDone])
  return { steps, complete }
}

function PipIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 8 8" aria-hidden="true" shapeRendering="crispEdges">
      <rect width="8" height="8" fill="#0b0c0e" />
      <path d="M2 2h4v3H2z" fill="#d9a441" />
      <path d="M3 3h2v1H3z" fill="#6cb2ff" />
      <path d="M1 5h1v2H1zM6 5h1v2H6z" fill="#cfccc4" />
      <path d="M0 1h2v1H0zM6 1h2v1H6z" fill="#3a6fb0" />
    </svg>
  )
}

/** What Pip says: a speech bubble next to Pip. */
function Bubble({ children }: { children: string }) {
  return (
    <div className="blk-bubble-row">
      <PipIcon />
      <p className="blk-bubble">
        <span className="sr-only">Pip says: </span>
        {children}
      </p>
    </div>
  )
}

export function StoryCard() {
  const ctx = useStoryCtx()
  const { chapter, done, started, open, begin, goTo, setOpen, restart, remember } = useStory()
  const { steps, complete } = useStoryEffects(ctx)
  const [hint, setHint] = useState(false)
  const headingId = useId()
  const ch = CHAPTERS[chapter]
  const choices = useMemo(() => ch.choices?.(ctx) ?? null, [ch, ctx])
  const last = chapter === CHAPTERS.length - 1
  const doneCount = steps.filter((s) => s.done).length
  const open1 = (i: number) => {
    setHint(false)
    goTo(i)
  }

  if (!started) {
    return (
      <section className="blk-panel blk-story" aria-labelledby={headingId}>
        <p className="blk-kicker">A story in {CHAPTERS.length} short chapters</p>
        <h2 id={headingId} className="blk-h blk-title">
          Pip’s Moon adventure
        </h2>
        <Bubble>Hi! I’m Pip, a little lander made of blocks. Will you help me explore the Moon?</Bubble>
        <button type="button" className="blk-big" onClick={begin}>
          Let’s go!
        </button>
      </section>
    )
  }

  if (!open) {
    return (
      <section className="blk-panel blk-story is-closed" aria-labelledby={headingId}>
        <div className="blk-story-top">
          <PipIcon />
          <h2 id={headingId} className="blk-story-mini">
            {ch.title}
            <span className="blk-kicker"> · {complete ? 'done!' : `${doneCount} of ${steps.length}`}</span>
          </h2>
          <button type="button" className="blk-icon" aria-expanded={false} aria-label="Show Pip’s story" onClick={() => setOpen(true)}>
            +
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="blk-panel blk-story" aria-labelledby={headingId}>
      <div className="blk-story-top">
        <div className="blk-story-head">
          <p className="blk-kicker">
            Chapter {chapter + 1} of {CHAPTERS.length}
          </p>
          <h2 id={headingId} className="blk-h blk-title">
            {ch.title}
          </h2>
        </div>
        <button type="button" className="blk-icon" aria-expanded={true} aria-label="Hide Pip’s story" onClick={() => setOpen(false)}>
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
            onClick={() => open1(i)}
          >
            {done.includes(c.id) ? '★' : i + 1}
          </button>
        ))}
      </nav>

      <div role="status" aria-live="polite">
        {complete ? <Bubble>{ch.found(ctx)}</Bubble> : null}
      </div>

      {!complete && (
        <>
          <Bubble>{ch.story}</Bubble>
          <h3 className="blk-task-h">Your mission</h3>
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
          {choices && ctx.memory.answer === null && (
            <div className="blk-choices" role="group" aria-label="Your answer">
              {choices.map((c) => (
                <button key={c.id} type="button" onClick={() => remember({ answer: c.id })}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="blk-link" aria-expanded={hint} onClick={() => setHint(!hint)}>
            {hint ? 'Hide the hint' : 'Need a hint?'}
          </button>
          {hint && <p className="blk-hint-text">{ch.hint}</p>}
        </>
      )}

      {complete && (
        <p className="blk-lesson">
          <strong>Remember:</strong> {ch.lesson}
        </p>
      )}

      {complete && last && (
        <div className="blk-found">
          <p className="blk-found-h">You did it, Mission Control! You learned that:</p>
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
            Next chapter ▸
          </button>
        )}
        {complete && last && (
          <button type="button" className="blk-big" onClick={restart}>
            Play again
          </button>
        )}
      </div>
    </section>
  )
}
