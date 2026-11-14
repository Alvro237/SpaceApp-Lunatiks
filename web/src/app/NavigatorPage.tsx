/**
 * The planner's screen: the map fills the window and only small tools float over it.
 *   - Top left: where and when. In study mode a site search (catalogue and missions) with a coordinates button;
 *     in both modes the date pill (start and duration).
 *   - Next to them, the tool bar (Adobe-style options bar): mission filters in mission mode, then the active map
 *     view's own tools (zoom, view, layers), which it puts there through ToolPortal.
 *   - Right: the chosen place and its sections (the engine parameters live in the section they change).
 *   - Bottom: the bare timeline.
 * The panels report the space they cover so the map centres the Moon in the free area.
 */
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'
import { SkyDial } from '../charts/SkyDial'
import { Timeline } from '../charts/Timeline'
import { DatePill } from '../panels/DatePill'
import { MissionPanel } from '../panels/MissionPanel'
import { PlacePanel } from '../panels/PlacePanel'
import { CoordsButton, SiteSearch } from '../panels/SiteSearch'
import { NowProvider } from '../panels/useNow'
import { useInsets } from '../state/layout'
import { usePanels } from '../state/panels'
import { useApp } from '../state/store'
import { useUrlSync } from '../state/useUrlSync'
import { GlobeView } from '../globe/GlobeView'
import { HorizonView } from '../horizon/HorizonView'
import { TerrainView } from '../terrain/TerrainView'
import { useClock } from '../time/useClock'
import { QuestPanel } from '../learn/QuestPanel'
import { IconFilter } from '../ui/icons'
import { Popover } from '../ui/Popover'
import { ToolSlotContext } from '../ui/toolSlotContext'

export function NavigatorPage() {
  const { restoredFromCorruptLink } = useUrlSync()
  useClock()
  const mode = useApp((s) => s.mode)
  const scale = useApp((s) => s.scale)
  const section = usePanels((s) => s.section)
  const root = useRef<HTMLDivElement>(null)
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  useMeasureInsets(root)

  return (
    <NowProvider>
      <ToolSlotContext.Provider value={slot}>
        <div className={`navigator${section === 'horizon' ? ' is-horizon' : ''}`} ref={root}>
          <h1 className="sr-only">Lunar Landing Site Navigator</h1>
          {/* the map stays mounted (and keeps its camera) under the horizon view, paused and out of the tab order */}
          <div className="map-layer" inert={section === 'horizon' ? true : undefined} aria-hidden={section === 'horizon' ? true : undefined}>
            {scale === 'globe' ? <GlobeView /> : <TerrainView />}
          </div>
          {section === 'horizon' && <HorizonView />}
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
            </div>
          </div>
          <Float side="right" title="Place" wide={section !== null && section !== 'horizon'}>
            <PlacePanel />
          </Float>
          <QuestPanel />
          <div className="float float-bottom">
            <Timeline />
          </div>
        </div>
      </ToolSlotContext.Provider>
    </NowProvider>
  )
}

/** The place panel: folds to its title with its own button, and widens while a section is open. */
function Float({ side, title, wide, children }: { side: 'left' | 'right'; title: string; wide?: boolean; children: ReactNode }) {
  const id = useId()
  const [open, setOpen] = useState(true)
  return (
    <section className={`float float-${side}${open ? '' : ' is-closed'}${wide ? ' is-wide' : ''}`} aria-labelledby={`${id}-h`}>
      <div className="float-head">
        <h2 id={`${id}-h`}>{title}</h2>
        <button type="button" className="icon" aria-expanded={open} aria-controls={`${id}-b`} onClick={() => setOpen(!open)} aria-label={`${open ? 'Hide' : 'Show'} ${title}`}>
          {open ? (side === 'left' ? '‹' : '›') : side === 'left' ? '›' : '‹'}
        </button>
      </div>
      <div id={`${id}-b`} className="float-body" hidden={!open}>
        {children}
      </div>
    </section>
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
