/**
 * The planner's screen: the map fills the window and the panels float over it. Where and when on the left,
 * the chosen place on the right, playback along the bottom, and the live comparison above it when on.
 * The panels report the space they cover so the map centres the Moon in the free area.
 */
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'
import { CompareLive } from '../compare/CompareLive'
import { Timeline } from '../charts/Timeline'
import { MissionPanel } from '../panels/MissionPanel'
import { PlacePanel } from '../panels/PlacePanel'
import { SitePicker } from '../panels/SitePicker'
import { NowProvider } from '../panels/useNow'
import { WhenPanel } from '../panels/WhenPanel'
import { useInsets } from '../state/layout'
import { useApp } from '../state/store'
import { useUrlSync } from '../state/useUrlSync'
import { GlobeView } from '../globe/GlobeView'
import { TerrainView } from '../terrain/TerrainView'
import { useClock } from '../time/useClock'

const narrow = () => typeof window !== 'undefined' && window.innerWidth < 760

export function NavigatorPage() {
  const { restoredFromCorruptLink } = useUrlSync()
  useClock()
  const mode = useApp((s) => s.mode)
  const compareMode = useApp((s) => s.compareMode)
  const scale = useApp((s) => s.scale)
  const root = useRef<HTMLDivElement>(null)
  useMeasureInsets(root)

  return (
    <NowProvider>
      <div className="navigator" ref={root}>
        <h1 className="sr-only">Lunar Landing Site Navigator</h1>
        {scale === 'globe' ? <GlobeView /> : <TerrainView />}
        {restoredFromCorruptLink && (
          <p className="toast" role="alert">
            The shared link could not be read; the default scenario is shown.
          </p>
        )}
        <Float side="left" title={mode === 'study' ? 'Where and when' : 'Mission filters'} defaultOpen={!narrow()}>
          {mode === 'study' ? <SitePicker /> : <MissionPanel />}
          <WhenPanel />
        </Float>
        <Float side="right" title="Place" defaultOpen>
          <PlacePanel />
        </Float>
        <div className="float float-bottom">
          {compareMode && <CompareLive />}
          <Timeline />
        </div>
      </div>
    </NowProvider>
  )
}

function Float({ side, title, defaultOpen, children }: { side: 'left' | 'right'; title: string; defaultOpen: boolean; children: ReactNode }) {
  const id = useId()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`float float-${side}${open ? '' : ' is-closed'}`} aria-labelledby={`${id}-h`}>
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
        const side = r.width < W * 0.6
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
