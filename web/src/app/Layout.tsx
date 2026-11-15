import { useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useApp } from '../state/store'
import { BlockToggle } from '../blocks/BlockToggle'
import { GraphicsToggle } from '../ui/GraphicsToggle'
import { BrandMark } from '../ui/BrandMark'
import { TourButton } from '../ui/Walkthrough'
import { useCinematic } from '../state/cinematic'
import { CinematicButton } from './Cinematic'

const TITLES: Record<string, string> = { '/': 'Navigator', '/data': 'Data & methods', '/learn': 'Learn' }

export function Layout() {
  const { pathname } = useLocation()
  const mode = useApp((s) => s.mode)
  const set = useApp((s) => s.set)
  const blocks = useApp((s) => s.blocks)
  const onMap = pathname === '/'
  const cinematic = useCinematic((s) => s.on) && onMap
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)

  // Title per view, and focus moved to the content when the view changes (not on first load).
  useEffect(() => {
    document.title = `${TITLES[pathname] ?? 'Navigator'} · Lunar Landing Site Navigator`
    if (first.current) first.current = false
    else main.current?.focus()
  }, [pathname])

  return (
    <div className={`app${onMap ? ' on-map' : ''}${onMap && blocks ? ' blocks-on' : ''}${cinematic ? ' is-cinematic' : ''}`}>
      <a className="skip" href="#main" onClick={(e) => (e.preventDefault(), main.current?.focus())}>
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <BrandMark />
          </span>
          <span>
            <span className="brand-name">Lunar Landing Site Navigator</span>
            <span className="tagline">{onMap && blocks ? 'Educational · missions and simple answers' : 'Sun and Earth over the real lunar horizon'}</span>
          </span>
        </div>
        {onMap && (
          <div className="bar-tools">
            {!blocks && (
              <div className="mode-switch" role="radiogroup" aria-label="Mode">
                <button type="button" role="radio" aria-checked={mode === 'study'} onClick={() => set({ mode: 'study' })}>
                  Site explorer
                </button>
                <button type="button" role="radio" aria-checked={mode === 'mission'} onClick={() => set({ mode: 'mission' })}>
                  Mission planner
                </button>
              </div>
            )}
            <BlockToggle />
            {!blocks && <GraphicsToggle />}
            {!blocks && <CinematicButton />}
          </div>
        )}
        <div className="bar-end">
          <nav aria-label="Main">
            <ul>
              <li>
                <NavLink to="/" end>
                  Navigator
                </NavLink>
              </li>
              <li>
                <NavLink to="/data">Data & methods</NavLink>
              </li>
            </ul>
          </nav>
          <TourButton />
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1}>
        <Outlet />
      </main>
      {!onMap && (
        <footer className="footer">
          NASA Space Apps Challenge 2026 · team Lunatiks · NASA LRO/LOLA, JPL SPICE, USGS data · Built with AI assistance (see Data & methods)
        </footer>
      )}
    </div>
  )
}
