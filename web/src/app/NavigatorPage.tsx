/**
 * The planner's screen: the map fills the window and only small tools float over it.
 *   - Top left: where and when. In study mode a site search (catalogue and missions) with a coordinates button;
 *     in both modes the date pill (start and duration).
 *   - Next to them, the tool bar (Adobe-style options bar): mission filters in mission mode, then the active map
 *     view's own tools (zoom, view, layers), which it puts there through ToolPortal, then the place tools:
 *     Multiselect and, for a single place, its sections (Power, Horizon, Earth link).
 *   - Right: a side panel only on demand. The open section of the single place, or, with Multiselect on and two
 *     or more places picked, the comparison. With neither, the map keeps the whole screen.
 *   - Bottom: the bare timeline.
 * A right click on a place (or its ⋯ button in the panels) opens a small menu: rename it, choose its pointer
 * colour, or remove it (a toast offers to undo the removal).
 * The panels report the space they cover so the map centres the Moon in the free area.
 *
 * Two systems share these top bars: the planner (the map, the place panel, the timeline) and Educational mode, the
 * educational world of cubes (blocks/, SW-2). Loading and caching:
 *   - The planner stays mounted once loaded. While Educational mode is on it is paused (its canvas draws no frames),
 *     hidden and out of the tab order, so coming back is instant: same camera, tiles still in memory, no new WebGL.
 *   - Educational mode's code is a lazy chunk, fetched the first time (and prefetched when the pointer or the focus
 *     reaches its switch). It unmounts when switched off and frees its GPU memory; the heights it builds from
 *     (globe, tileset, overview) stay in the shared React Query cache, so turning it on again downloads nothing.
 */
import { type ReactNode, Suspense, lazy, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { loadBlockMode } from '../blocks/preload'
import { ComparePanel } from '../compare/ComparePanel'
import { Timeline } from '../charts/Timeline'
import { DatePill } from '../panels/DatePill'
import { PlaceMenu } from '../panels/PlaceMenu'
import { PlaceTools, SectionDrawer } from '../panels/PlacePanel'
import { CoordsButton, SiteSearch } from '../panels/SiteSearch'
import { NowProvider } from '../panels/useNow'
import { useInsets } from '../state/layout'
import { useAreas } from '../state/areas'
import { useCinematic } from '../state/cinematic'
import { usePanels } from '../state/panels'
import { useApp } from '../state/store'
import { useUrlSync } from '../state/useUrlSync'
import { GlobeView } from '../globe/GlobeView'
import { DiveTarget } from '../horizon/DiveTarget'
import { HorizonView } from '../horizon/HorizonView'
import { PlannerPanel } from '../mission/PlannerPanel'
import { ResultsPanel } from '../mission/ResultsPanel'
import { DIVE_MS, type HorizonPhase as Phase, RETURN_MS, useHorizonTransition } from '../state/horizon'
import { TerrainView } from '../terrain/TerrainView'
import { useClock } from '../time/useClock'
import { QuestPanel } from '../learn/QuestPanel'
import { ToolSlotContext } from '../ui/toolSlotContext'
import { CinematicExit } from './Cinematic'

/**
 * Map → horizon: the map camera flies to the place, comes down and tilts toward the horizon, and fades (DIVE_MS);
 * then the horizon view finishes the descent. Horizon → map: the map camera flies back (RETURN_MS).
 * The phase is shared (state/horizon) so the map views can drive their cameras.
 */
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Educational mode, loaded the first time it is switched on (the same promise as the switch's prefetch). */
const BlockMode = lazy(loadBlockMode)

export function NavigatorPage() {
  const { restoredFromCorruptLink } = useUrlSync()
  useClock()
  const mode = useApp((s) => s.mode)
  const scale = useApp((s) => s.scale)
  const section = usePanels((s) => s.section)
  const resultsOpen = usePanels((s) => s.resultsOpen)
  // a new answer from the planner shows the "Candidate sites" panel again after it was closed
  const areasResult = useAreas((s) => s.suit)
  useEffect(() => {
    if (areasResult) usePanels.getState().setResultsOpen(true)
  }, [areasResult])
  const comparing = useApp((s) => s.compareMode && s.compare.length >= 2)
  const blocks = useApp((s) => s.blocks)
  // cinematic mode: only the turning Moon and a button to leave (app/Cinematic.tsx); not with Educational mode
  const cinematic = useCinematic((s) => s.on) && !blocks
  // With no place chosen there is nothing for the bottom bar (the place's sunlight and Earth over the window) or
  // the place's sections to show: they wait until a place is picked on the map or in the search.
  const hasPlace = useApp((s) => s.selection !== null)
  // the horizon view belongs to the planner: it waits (section kept) while Educational mode is on
  const horizonOn = section === 'horizon' && !blocks && hasPlace
  const root = useRef<HTMLDivElement>(null)
  // Transition between the map and the horizon view, derived from the section while rendering (no effect needed
  // to start it); timers only end a phase.
  const [prevSection, setPrevSection] = useState(section)
  const [phase, setPhase] = useState<Phase>(section === 'horizon' ? 'horizon' : 'map')
  if (prevSection !== section) {
    setPrevSection(section)
    if (section === 'horizon') setPhase(reducedMotion() ? 'horizon' : 'diving')
    else if (prevSection === 'horizon') setPhase(reducedMotion() ? 'map' : 'returning')
  }
  useLayoutEffect(() => useHorizonTransition.getState().setPhase(phase), [phase])
  useEffect(() => {
    if (phase !== 'diving' && phase !== 'returning') return
    const t = setTimeout(() => setPhase(phase === 'diving' ? 'horizon' : 'map'), phase === 'diving' ? DIVE_MS : RETURN_MS)
    return () => clearTimeout(t)
  }, [phase])
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  useMeasureInsets(root)

  const mission = !blocks && mode === 'mission'
  return (
    <NowProvider>
      <DiveTarget />
      <ToolSlotContext.Provider value={slot}>
        <div
          className={`navigator${horizonOn ? ' is-horizon' : ''}${blocks ? ' is-blocks' : ''}${mission ? ' is-mission' : ''}${cinematic ? ' is-cinematic' : ''}${!blocks && phase === 'diving' ? ' is-diving' : ''}${!blocks && phase === 'returning' ? ' is-returning' : ''}`}
          ref={root}
        >
          <h1 className="sr-only">Lunar Landing Site Navigator</h1>
          {cinematic && <CinematicExit />}
          {/* The map stays mounted (and keeps its camera and tiles) under the horizon view and under Educational mode:
              paused, hidden and out of the tab order. */}
          <div
            className={`map-layer${blocks ? ' is-dormant' : ''}`}
            inert={horizonOn || blocks ? true : undefined}
            aria-hidden={horizonOn || blocks ? true : undefined}
          >
            {scale === 'globe' ? <GlobeView /> : <TerrainView />}
          </div>
          {horizonOn && phase === 'horizon' && <HorizonView animate={!reducedMotion()} />}
          {blocks && (
            <Suspense
              fallback={
                <p className="map-loading" role="status">
                  Loading Educational mode…
                </p>
              }
            >
              <BlockMode />
            </Suspense>
          )}
          {restoredFromCorruptLink && (
            <p className="toast" role="alert">
              The shared link could not be read; the default scenario is shown.
            </p>
          )}
          <div className="top-left">
            {/* In mission mode the date lives inside the planner panel (PlannerBasics), not up here. */}
            {!mission && (
              <div className="where-when" role="group" aria-label={blocks || mode === 'study' ? 'Where and when' : 'When'}>
                {(blocks || mode === 'study') && (
                  <>
                    <SiteSearch />
                    <CoordsButton />
                  </>
                )}
                <DatePill />
              </div>
            )}
            <div className="toolstrip" role="toolbar" aria-label="Map tools">
              <div className="toolslot" ref={setSlot} />
              {!blocks && <PlaceTools />}
            </div>
          </div>
          {/* Always on the left in mission mode (3.1): no popover, so it never covers the timeline (P2). */}
          {mission && <PlannerPanel />}
          {/* Educational mode brings its own panels ("The sky now", the days along the bottom) */}
          {!blocks && (
            <>
              {comparing ? (
                <SidePanel wide>{(titleId) => <ComparePanel titleId={titleId} />}</SidePanel>
              ) : mission ? (
                resultsOpen && <SidePanel>{(titleId) => <ResultsPanel titleId={titleId} />}</SidePanel>
              ) : (
                section && hasPlace && <SidePanel wide={section === 'power'}>{(titleId) => <SectionDrawer titleId={titleId} />}</SidePanel>
              )}
              <RemovedToast />
              <PlaceMenu />
              <QuestPanel />
              {(hasPlace || comparing) && (
                <div className="float float-bottom">
                  <Timeline />
                </div>
              )}
            </>
          )}
        </div>
      </ToolSlotContext.Provider>
    </NowProvider>
  )
}

/** The on-demand side panel: a region named by its content's heading (the content brings its own close button). */
function SidePanel({ wide, children }: { wide?: boolean; children: (titleId: string) => ReactNode }) {
  const id = useId()
  return (
    <section className={`float float-right side-panel${wide ? ' is-wide' : ''}`} aria-labelledby={`${id}-t`}>
      <div className="float-body">{children(`${id}-t`)}</div>
    </section>
  )
}

/** "Removed X · Undo" after a right click on the map; it goes away by itself after a few seconds. */
function RemovedToast() {
  const removed = useApp((s) => s.lastRemoved)
  const undo = useApp((s) => s.undoRemove)
  const [expired, setExpired] = useState<number | null>(null)
  useEffect(() => {
    if (!removed) return
    const t = window.setTimeout(() => setExpired(removed.seq), 7000)
    return () => window.clearTimeout(t)
  }, [removed])
  if (!removed || expired === removed.seq) return null
  return (
    <div className="toast toast-undo" role="status">
      Removed {removed.name}
      <button type="button" className="link" onClick={undo}>
        Undo
      </button>
    </div>
  )
}

/**
 * Measures the floating panels and the top bar and publishes how much of each window edge they cover. A panel
 * hugging the left or right edge covers that side; a wide one near the bottom covers the bottom.
 */
function useMeasureInsets(root: { current: HTMLDivElement | null }) {
  const setInsets = useInsets((s) => s.setInsets)
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    // What this element was last given. Compared with this, not with the store: the store outlives the navigator
    // (it keeps the last insets while another page is open), and a new element starts with none of the CSS
    // variables set, so equal numbers in the store must not skip writing them.
    let applied: { left: number; right: number; top: number; bottom: number } | null = null
    const measure = () => {
      const W = window.innerWidth
      const H = window.innerHeight
      const ins = { left: 0, right: 0, top: 0, bottom: 0 }
      const bar = document.querySelector('.topbar')?.getBoundingClientRect()
      if (bar) ins.top = Math.max(0, bar.bottom)
      // On a phone the panels sit below the map, not over it.
      const stacked = getComputedStyle(el.querySelector('.float') ?? el).position === 'static'
      for (const f of stacked ? [] : el.querySelectorAll<HTMLElement>('.float')) {
        const r = f.getBoundingClientRect()
        // the bottom bar always counts as bottom, however narrow the side panels leave it and however short it
        // is: the panels and the captions above it are sized and placed from this inset
        const bottomBar = f.classList.contains('float-bottom')
        // a folded panel is only its title bar: it does not hide the map
        if (r.width === 0 || (!bottomBar && r.height < 80)) continue
        const side = !bottomBar && r.width < W * 0.85
        if (side && r.left < 40) ins.left = Math.max(ins.left, r.right)
        else if (side && r.right > W - 40) ins.right = Math.max(ins.right, W - r.left)
        else if (bottomBar || r.top > H / 2) ins.bottom = Math.max(ins.bottom, H - r.top)
      }
      if (applied && applied.left === ins.left && applied.right === ins.right && applied.top === ins.top && applied.bottom === ins.bottom) return
      applied = ins
      setInsets(ins)
      el.style.setProperty('--inset-left', `${ins.left}px`)
      el.style.setProperty('--inset-right', `${ins.right}px`)
      el.style.setProperty('--inset-top', `${ins.top}px`)
      el.style.setProperty('--inset-bottom', `${ins.bottom}px`)
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    const observe = () => el.querySelectorAll('.float').forEach((f) => ro?.observe(f))
    observe()
    const mo = new MutationObserver(() => {
      observe()
      measure()
    })
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] })
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [root, setInsets])
}
