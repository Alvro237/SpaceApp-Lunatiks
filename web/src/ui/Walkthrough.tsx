/**
 * The walkthrough: a "Tour" button at the end of the top bar that leads the user through the real screen, one
 * control at a time. Each step dims the page, cuts a spotlight around the control it explains and puts a small card
 * next to it with what the control does, Back / Next and the step count. The last step offers the full written guide
 * (GuideDialog), which keeps every detail and the data sources.
 *
 * The tour works on the navigator: started from another page it goes there first. It shows the planner, so it turns
 * Educational mode off for its length, and it switches to Mission planner for the step on the mission filters; both
 * are put back as they were when the tour ends. A step whose control is not on screen is skipped, the step count
 * covers only the steps shown, so it never jumps, and Back returns to the step shown before.
 *
 * Accessibility: the card is a modal dialog (the app behind it is inert), focus moves to its Next button, Escape ends
 * the tour, the arrow keys move between steps, and the card says "Step n of N". The spotlight is decorative; the
 * card names the control it points at. Reduced motion turns the spotlight's glide off.
 */
import { type CSSProperties, type KeyboardEvent, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { type AppState, useApp } from '../state/store'
import { GuideDialog, openDialog } from './GuideDialog'
import { IconClose, IconHelp } from './icons'
import './guide.css'

type Saved = Pick<AppState, 'mode' | 'blocks'>

interface Step {
  /** CSS selector of the control the step explains; none for a step about the whole screen. */
  target?: string
  title: string
  text: string
  /** Puts the app in the state the step needs (the saved state is restored at the end). */
  enter?: (set: AppState['set']) => void
}

export const STEPS: Step[] = [
  {
    title: 'Welcome to the Navigator',
    text: 'This tool shows where the Sun and the Earth are over the real horizon of any place on the Moon, at any date. This short tour points at each part of the screen. Use Next, or the arrow keys; Escape leaves at any time.',
    enter: (set) => set({ mode: 'study' }),
  },
  {
    target: '.mode-switch',
    title: 'Two ways to work',
    text: 'Site explorer: you choose the places and study them. Mission planner: you set filters (slope, light, Earth contact…) and the tool paints the areas where all of them pass.',
  },
  {
    target: '.site-search',
    title: 'Choose where',
    text: 'Type the name of a landing site, a past mission or a polar feature. Arrow keys move through the list, Enter picks. The place appears on the map.',
  },
  {
    target: 'button[aria-label="Coordinates"]',
    title: 'Any point',
    text: 'Enter a latitude and longitude to study a point that is not in the catalogue. You can also click the ground on the map.',
  },
  {
    target: '.pill-btn',
    title: 'Choose when',
    text: 'The start date (UTC) and the length of the window, from 1 to 365 days. The timeline, the panels and the comparison all follow it.',
  },
  {
    target: '.toolslot',
    title: 'Map tools',
    text: 'Zoom, tilt into 3D relief, switch between the whole Moon and the south-polar map, and choose the map colour: slope, mean sunlight, Earth visibility, permanent shadow or the photo.',
  },
  {
    target: '.place-tools',
    title: 'Study the place',
    text: 'Power: solar power, battery and a colony model. Horizon: stand on the place and look around. Earth link: when it can talk to the Earth. Multiselect: pick several places to compare them side by side.',
  },
  {
    title: 'The map',
    text: 'Click a site to choose it. Right click a place to rename it, change its colour or remove it. Drag to move or turn, the wheel to zoom. The light on the ground is the Sun at the chosen instant.',
  },
  {
    target: '.navigator > .float-bottom',
    title: 'The timeline',
    text: 'Drag through the window or press Play (Space). The strips show when the place is sunlit and when it sees the Earth. The map and every panel follow the clock.',
  },
  {
    target: 'button[aria-label="Mission filters"]',
    title: 'Mission filters',
    text: 'In Mission planner: place a search region, switch on the filters your mission needs and set their limits. A spot that fails any filter is out. The areas that pass are painted on the map and listed, ready to study.',
    enter: (set) => set({ mode: 'mission' }),
  },
  {
    target: '.block-toggle',
    title: 'Educational mode',
    text: 'The same place and time as a world of cubes, with plain answers (is the Sun up? can we see Earth?) and small missions for young learners.',
    enter: (set) => set({ mode: 'study' }),
  },
  {
    target: 'nav a[href$="data"]',
    title: 'Where the numbers come from',
    text: 'Every NASA dataset behind the tool, how it was processed, how it was checked against JPL Horizons, what is still missing, and how AI was used.',
  },
  {
    title: 'You are ready',
    text: 'Start by choosing a place and a date. The Tour button replays this tour; the full guide lists every control with its data source.',
  },
]

const PAD = 6
const GAP = 12
const CARD_W = 340

/** Whether step `i` is shown: it has no control, it changes the app (and decides its own target once applied), or
 * its control is on screen. */
function isShown(i: number): boolean {
  const t = STEPS[i].target
  return !t || !!STEPS[i].enter || document.querySelector(t) !== null
}

/** How many steps after `from` the tour will show, with the screen as it is now. */
function countAhead(from: number): number {
  let n = 0
  for (let i = from + 1; i < STEPS.length; i++) if (isShown(i)) n++
  return n
}

/** The step to show after `from`, skipping steps whose control is not on screen. */
function nextShown(from: number): number | null {
  for (let i = from + 1; i < STEPS.length; i++) if (isShown(i)) return i
  return null
}

export function TourButton() {
  const [step, setStep] = useState<number | null>(null)
  const saved = useRef<Saved | null>(null)
  const guide = useRef<HTMLDialogElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const start = () => {
    const s = useApp.getState()
    saved.current = { mode: s.mode, blocks: s.blocks }
    s.setPlaying(false)
    if (s.blocks) s.set({ blocks: false })
    if (pathname !== '/') navigate('/')
    setStep(0)
  }
  const end = useCallback((then?: () => void) => {
    setStep(null)
    if (saved.current) useApp.getState().set(saved.current)
    saved.current = null
    if (then) then()
    else btn.current?.focus()
  }, [])

  return (
    <>
      <button ref={btn} type="button" className="guide-btn" onClick={start} aria-haspopup="dialog" aria-label="Tour" title="A step-by-step tour of the screen">
        <IconHelp size={18} />
        <span>Tour</span>
      </button>
      {step !== null && <Tour step={step} setStep={setStep} onEnd={end} onGuide={() => end(() => window.setTimeout(() => openDialog(guide.current)))} />}
      <GuideDialog ref={guide} />
    </>
  )
}

function Tour({
  step,
  setStep,
  onEnd,
  onGuide,
}: {
  step: number
  setStep: (i: number) => void
  onEnd: () => void
  onGuide: () => void
}) {
  const id = useId()
  const s = STEPS[step]
  const card = useRef<HTMLDivElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [cardH, setCardH] = useState(200)
  // The count covers only the steps shown, so it never jumps over a skipped one (the timeline is hidden until a place
  // is chosen, for example). The steps behind are the ones actually visited, so a later mode switch that hides their
  // controls does not move the count back; Back returns to exactly those steps. The steps ahead are counted on the
  // screen as it is, kept up to date while the tour runs.
  const [visited, setVisited] = useState<number[]>([])
  const [ahead, setAhead] = useState(() => countAhead(step))
  const last = nextShown(step) === null
  const first = visited.length === 0
  const pos = visited.length + 1
  const total = pos + ahead

  // the app behind the card is inert while the tour runs
  useEffect(() => {
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    return () => root?.removeAttribute('inert')
  }, [])

  // apply the step's state, then follow its control (it moves when panels open, the window resizes or the bar wraps).
  // A layout effect: the spotlight is measured before the new card is painted, so the two never disagree, even when
  // the map makes frames slow.
  useLayoutEffect(() => {
    s.enter?.(useApp.getState().set)
    let raf = 0
    let prev = ''
    let prevAhead = -1
    const track = () => {
      const el = s.target ? document.querySelector(s.target) : null
      const r = el?.getBoundingClientRect() ?? null
      const key = r ? `${r.x},${r.y},${r.width},${r.height}` : ''
      if (key !== prev) {
        prev = key
        setRect(r && r.width > 0 ? r : null)
      }
      const n = countAhead(step)
      if (n !== prevAhead) {
        prevAhead = n
        setAhead(n)
      }
      raf = requestAnimationFrame(track)
    }
    track()
    return () => cancelAnimationFrame(raf)
  }, [s, step])

  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight)
    next.current?.focus()
  }, [step])

  const go = (dir: 1 | -1) => {
    if (dir === -1) {
      const back = visited.at(-1)
      if (back === undefined) return
      setVisited(visited.slice(0, -1))
      setStep(back)
      return
    }
    const i = nextShown(step)
    if (i === null) return onEnd()
    setVisited([...visited, step])
    setStep(i)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onEnd()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(-1)
    } else if (e.key === 'Tab') {
      // keep the focus in the card
      const items = card.current?.querySelectorAll<HTMLElement>('button')
      if (!items?.length) return
      const a = items[0]
      const z = items[items.length - 1]
      const wrapTo = e.shiftKey ? (document.activeElement === a ? z : null) : document.activeElement === z ? a : null
      if (wrapTo) {
        e.preventDefault()
        wrapTo.focus()
      }
    }
  }

  const W = window.innerWidth
  const H = window.innerHeight
  const cw = Math.min(CARD_W, W - 32)
  let cardStyle: CSSProperties
  if (!rect) cardStyle = { left: (W - cw) / 2, top: Math.max(16, (H - cardH) / 2), width: cw }
  else {
    const below = rect.bottom + PAD + GAP
    const above = rect.top - PAD - GAP - cardH
    const top = below + cardH < H - 16 ? below : above > 16 ? above : Math.max(16, H - cardH - 16)
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - cw / 2), W - cw - 16)
    cardStyle = { left, top, width: cw }
  }

  return createPortal(
    <div className="tour" onKeyDown={onKey}>
      {/* the dim layer: catches clicks so the tour is not changed under the user; with a target, the spotlight dims */}
      <div className={`tour-dim${rect ? ' has-spot' : ''}`} aria-hidden="true" />
      {rect && (
        <div
          className="tour-spot"
          aria-hidden="true"
          style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      )}
      <div ref={card} className="tour-card" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} style={cardStyle}>
        <div className="tour-top">
          <span className="tour-count">
            Step {pos} of {total}
          </span>
          <button type="button" className="icon tour-x" onClick={onEnd} aria-label="End the tour" title="End the tour (Esc)">
            <IconClose size={16} />
          </button>
        </div>
        <h2 id={`${id}-t`}>{s.title}</h2>
        <p id={`${id}-d`}>{s.text}</p>
        <div className="tour-dots" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={i === pos - 1 ? 'is-on' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          {last ? (
            <button type="button" onClick={onGuide}>
              Read the full guide
            </button>
          ) : (
            <button type="button" className="link" onClick={onEnd}>
              Skip the tour
            </button>
          )}
          <span className="tour-nav">
            {!first && (
              <button type="button" onClick={() => go(-1)}>
                Back
              </button>
            )}
            <button ref={next} type="button" className="primary" onClick={() => go(1)}>
              {last ? 'Done' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
