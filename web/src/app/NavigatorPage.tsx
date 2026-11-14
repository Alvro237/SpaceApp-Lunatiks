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
 * A right click on a place removes it; a toast offers to undo it.
 * The panels report the space they cover so the map centres the Moon in the free area.
 */
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ComparePanel } from '../compare/ComparePanel'
import { SkyDial } from '../charts/SkyDial'
import { Timeline } from '../charts/Timeline'
import { DatePill } from '../panels/DatePill'
import { MissionPanel } from '../panels/MissionPanel'
import { PlaceTools, SectionDrawer } from '../panels/PlacePanel'
import { CoordsButton, SiteSearch } from '../panels/SiteSearch'
import { NowProvider } from '../panels/useNow'
import { useInsets } from '../state/layout'
import { usePanels } from '../state/panels'
import { useApp } from '../state/store'
import { useUrlSync } from '../state/useUrlSync'
import { GlobeView } from '../globe/GlobeView'
import { DiveTarget } from '../horizon/DiveTarget'
import { HorizonView } from '../horizon/HorizonView'
import { DIVE_MS, type HorizonPhase as Phase, RETURN_MS, useHorizonTransition } from '../state/horizon'
import { TerrainView } from '../terrain/TerrainView'
import { useClock } from '../time/useClock'
import { QuestPanel } from '../learn/QuestPanel'
import { IconFilter } from '../ui/icons'
import { Popover } from '../ui/Popover'
import { ToolSlotContext } from '../ui/toolSlotContext'

/**
 * Map → horizon: the map camera flies to the place, comes down and tilts toward the horizon, and fades (DIVE_MS);
 * then the horizon view finishes the descent. Horizon → map: the map camera flies back (RETURN_MS).
 * The phase is shared (state/horizon) so the map views can drive their cameras.
 */
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function NavigatorPage() {
  const { restoredFromCorruptLink } = useUrlSync()
  useClock()
  const mode = useApp((s) => s.mode)
  const scale = useApp((s) => s.scale)
  const section = usePanels((s) => s.section)
  const comparing = useApp((s) => s.compareMode && s.compare.length >= 2)
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

  return (
    <NowProvider>
      <DiveTarget />
      <ToolSlotContext.Provider value={slot}>
        <div className={`navigator${section === 'horizon' ? ' is-horizon' : ''}${phase === 'diving' ? ' is-diving' : ''}${phase === 'returning' ? ' is-returning' : ''}`} ref={root}>
          <h1 className="sr-only">Lunar Landing Site Navigator</h1>
          {/* the map stays mounted (and keeps its camera) under the horizon view, paused and out of the tab order */}
          <div className="map-layer" inert={section === 'horizon' ? true : undefined} aria-hidden={section === 'horizon' ? true : undefined}>
            {scale === 'globe' ? <GlobeView /> : <TerrainView />}
          </div>
          {section === 'horizon' && phase === 'horizon' && <HorizonView animate={!reducedMotion()} />}
          {restoredFromCorruptLink && (
            <p className="toast" role="alert">
              The shared link could not be read; the default scenario is shown.
            </p>
          )}
          <SkyDial />
          <div className="top-left">
            <div className="where-when" role="group" aria-label={mode === 'study' ? 'Where and when' : 'When'}>
              {mode === 'study' && (
                <>
                  <SiteSearch />
                  <CoordsButton />
                </>
              )}
              <DatePill />
            </div>
            <div className="toolstrip" role="toolbar" aria-label="Map tools">
              {mode === 'mission' && (
                <Popover label="Mission filters" button={<IconFilter size={18} />} buttonClass="tool-btn" align="left" className="mission-pop">
                  <h2 className="pop-title">
                    <IconFilter size={18} /> Mission filters
                  </h2>
                  <MissionPanel />
                </Popover>
              )}
              <div className="toolslot" ref={setSlot} />
              <PlaceTools />
            </div>
          </div>
          {comparing ? (
            <SidePanel wide>{(titleId) => <ComparePanel titleId={titleId} />}</SidePanel>
          ) : (
            section && <SidePanel wide={section === 'power'}>{(titleId) => <SectionDrawer titleId={titleId} />}</SidePanel>
          )}
          <RemovedToast />
          <QuestPanel />
          <div className="float float-bottom">
            <Timeline />
          </div>
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
        // a folded panel is only its title bar: it does not hide the map
        if (r.width === 0 || r.height < 80) continue
        // the bottom bar always counts as bottom, however narrow the side panels leave it
        const side = !f.classList.contains('float-bottom') && r.width < W * 0.85
        if (side && r.left < 40) ins.left = Math.max(ins.left, r.right)
        else if (side && r.right > W - 40) ins.right = Math.max(ins.right, W - r.left)
        else if (r.top > H / 2) ins.bottom = Math.max(ins.bottom, H - r.top)
      }
      const prev = useInsets.getState()
      if (prev.left === ins.left && prev.right === ins.right && prev.top === ins.top && prev.bottom === ins.bottom) return
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
