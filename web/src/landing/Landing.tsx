/**
 * Landing page: what the Lunar Landing Site Navigator is, the 30-second demo, four sections on what it gives, and
 * a way into the tool from the top bar and from the end of the page. Behind it, a live render of the Moon that
 * travels from the whole disc down to the south pole as the reader scrolls (moonScene.ts).
 *
 * Every number quoted here is measured and comes from docs/submission.md (validation against JPL Horizons and the
 * Apollo surface journal, the sweep timing, the mission-search agreement).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { API_DOCS_URL, APP_URL, BACKGROUND_VIDEO, BACKGROUND_VIDEO_CREDIT, DEMO_YOUTUBE_ID, REPO_URL } from './links'
import { createMoonScene } from './moonScene'

const SECTIONS = [
  { id: 'top', label: 'Start' },
  { id: 'demo', label: 'Demo' },
  { id: 'horizon', label: 'Sun and Earth' },
  { id: 'compare', label: 'Compare' },
  { id: 'mission', label: 'Mission planning' },
  { id: 'data', label: 'NASA data' },
  { id: 'start', label: 'Open the navigator' },
] as const

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Scroll position as a section index with a fraction: 2.5 = halfway from the third section to the fourth. */
function sectionProgress(): number {
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
  const y = window.scrollY
  const tops = SECTIONS.map(({ id }) => {
    const el = document.getElementById(id)
    return el ? Math.min(el.getBoundingClientRect().top + y, maxScroll) : maxScroll
  })
  for (let i = 0; i < tops.length - 1; i++) {
    if (y < tops[i + 1]) return i + Math.max(0, (y - tops[i]) / Math.max(1, tops[i + 1] - tops[i]))
  }
  return tops.length - 1
}

function useScrollProgress(onChange: (sectionX: number, target: number) => void) {
  const cb = useRef(onChange)
  useEffect(() => {
    cb.current = onChange
  })
  useEffect(() => {
    let target = sectionProgress()
    let current = target
    let raf = 0
    const still = reducedMotion()
    const tick = () => {
      current = still ? target : current + (target - current) * 0.09
      if (Math.abs(target - current) < 1e-4) current = target
      cb.current(current, target)
      raf = current === target ? 0 : requestAnimationFrame(tick)
    }
    const onScroll = () => {
      target = sectionProgress()
      if (!raf) raf = requestAnimationFrame(tick)
    }
    tick()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])
}

function Background({ onSection }: { onSection: (i: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const scene = useRef<ReturnType<typeof createMoonScene>>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (BACKGROUND_VIDEO || !canvas.current) return
    scene.current = createMoonScene(canvas.current, `${import.meta.env.BASE_URL}data/`, () => setReady(true))
    return () => {
      scene.current?.dispose()
      scene.current = null
    }
  }, [])

  useScrollProgress((x, target) => {
    const p = x / (SECTIONS.length - 1)
    scene.current?.setProgress(p)
    const v = video.current
    if (v && v.duration) v.currentTime = p * (v.duration - 0.05)
    onSection(Math.round(target))
  })

  return (
    <div className={`bg${ready || BACKGROUND_VIDEO ? ' is-ready' : ''}`} aria-hidden="true">
      {BACKGROUND_VIDEO ? (
        <>
          <video ref={video} className="bg-media" src={BACKGROUND_VIDEO} muted playsInline preload="auto" />
          <p className="ai-mark">{BACKGROUND_VIDEO_CREDIT}</p>
        </>
      ) : (
        <canvas ref={canvas} className="bg-media" />
      )}
      <div className="bg-veil" />
    </div>
  )
}

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.6 19.4 L8.6 17.4 L11.3 18.6 L14.5 15 L17.5 17.8 L20.3 16.4 L23.8 18.8 L27.4 18.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="22.8" cy="15.3" r="2.6" fill="var(--sun)" />
    </svg>
  )
}

function Nav({ active }: { active: number }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  return (
    <header className={`nav${scrolled ? ' is-scrolled' : ''}`}>
      <a className="nav-brand" href="#top" aria-label="Lunar Landing Site Navigator, back to the top">
        <Mark />
        <span>
          Lunar Landing <span className="nav-brand-2">Site Navigator</span>
        </span>
      </a>
      <nav aria-label="Sections">
        <ul>
          <li>
            <a href="#demo" aria-current={active === 1 ? 'true' : undefined}>Demo</a>
          </li>
          <li>
            <a href="#horizon" aria-current={active >= 2 && active <= 4 ? 'true' : undefined}>Features</a>
          </li>
          <li>
            <a href="#data" aria-current={active === 5 ? 'true' : undefined}>Data</a>
          </li>
        </ul>
      </nav>
      <a className="btn btn-primary btn-sm" href={APP_URL}>
        Open the navigator <Arrow />
      </a>
    </header>
  )
}

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Rail({ active }: { active: number }) {
  return (
    <nav className="rail" aria-label="Page progress">
      <ol>
        {SECTIONS.map((s, i) => (
          <li key={s.id}>
            <a href={`#${s.id}`} aria-current={active === i ? 'step' : undefined} title={s.label}>
              <span className="sr-only">{s.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function Demo() {
  const [playing, setPlaying] = useState(false)
  if (!DEMO_YOUTUBE_ID) {
    return (
      <div className="video video-empty">
        <p>The 30-second demo will appear here.</p>
      </div>
    )
  }
  return (
    <div className="video">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${DEMO_YOUTUBE_ID}?autoplay=1&rel=0&cc_load_policy=1`}
          title="Lunar Landing Site Navigator: 30-second demo"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : (
        <button type="button" className="video-poster" onClick={() => setPlaying(true)} style={{ backgroundImage: `url(https://i.ytimg.com/vi/${DEMO_YOUTUBE_ID}/maxresdefault.jpg)` }}>
          <span className="play" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 28 28">
              <path d="M9 6.5v15l12.5-7.5z" fill="currentColor" />
            </svg>
          </span>
          <span className="sr-only">Play the 30-second demo (YouTube)</span>
        </button>
      )}
    </div>
  )
}

interface FeatureProps {
  id: string
  index: string
  kicker: string
  title: string
  children: ReactNode
  stat: { value: string; label: string }
  art: ReactNode
  side?: 'left' | 'right'
}

function Feature({ id, index, kicker, title, children, stat, art, side = 'left' }: FeatureProps) {
  return (
    <section id={id} className={`section feature feature-${side}`} aria-labelledby={`${id}-title`}>
      <div className="card reveal">
        <p className="kicker">
          <span className="mono">{index}</span> {kicker}
        </p>
        <h2 id={`${id}-title`}>{title}</h2>
        <div className="feature-body">{children}</div>
        <div className="feature-foot">
          <div className="art">{art}</div>
          <p className="stat">
            <span className="stat-value mono">{stat.value}</span>
            <span className="stat-label">{stat.label}</span>
          </p>
        </div>
      </div>
    </section>
  )
}

/* Small line drawings in the navigator's own visual language: amber is the Sun, blue is the Earth. */
const ArtHorizon = () => (
  <svg viewBox="0 0 240 110" role="img" aria-label="A terrain skyline with the Sun half above it and the Earth higher up">
    <path d="M0 78 L22 70 L40 74 L62 58 L80 66 L104 52 L126 64 L150 60 L172 72 L196 62 L218 70 L240 66 L240 110 L0 110 Z" fill="var(--terrain-fill)" />
    <path d="M0 78 L22 70 L40 74 L62 58 L80 66 L104 52 L126 64 L150 60 L172 72 L196 62 L218 70 L240 66" fill="none" stroke="var(--line)" strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="60" cy="56" r="9" fill="var(--sun)" />
    <path d="M51 58 L62 58" stroke="var(--line)" strokeWidth="1.6" />
    <circle cx="176" cy="34" r="12" fill="none" stroke="var(--earth)" strokeWidth="2" />
    <path d="M176 22 a12 12 0 0 1 0 24 a6 12 0 0 0 0 -24" fill="var(--earth)" />
    <path d="M0 92 H240" stroke="var(--grid)" strokeDasharray="3 4" />
  </svg>
)

const ArtCompare = () => (
  <svg viewBox="0 0 240 110" role="img" aria-label="Three timeline strips comparing sunlight and Earth contact at three sites">
    {[0, 1, 2].map((r) => (
      <g key={r} transform={`translate(0 ${10 + r * 34})`}>
        <rect x="0" y="0" width="240" height="10" rx="2" fill="var(--track)" />
        <rect x={[8, 40, 0][r]} y="0" width={[150, 96, 210][r]} height="10" rx="2" fill="var(--sun)" />
        <rect x="0" y="14" width="240" height="6" rx="2" fill="var(--track)" />
        <rect x={[30, 0, 120][r]} y="14" width={[120, 200, 90][r]} height="6" rx="2" fill="var(--earth)" />
      </g>
    ))}
  </svg>
)

const ArtMission = () => {
  const pass = new Set(['2,1', '3,1', '2,2', '3,2', '4,2', '3,3', '4,3', '7,3', '8,3', '7,4'])
  const cells = []
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 12; x++)
      cells.push(<rect key={`${x},${y}`} x={x * 20 + 1} y={y * 18 + 1} width="18" height="16" rx="2" fill={pass.has(`${x},${y}`) ? 'var(--pass)' : 'var(--track)'} opacity={pass.has(`${x},${y}`) ? 0.9 : 1} />)
  return (
    <svg viewBox="0 0 240 110" role="img" aria-label="A grid of terrain cells; two connected groups of cells pass every filter">
      {cells}
      <path d="M41 19 H81 V37 H101 V73 H61 V55 H41 Z" fill="none" stroke="var(--line)" strokeWidth="1.6" />
      <circle cx="70" cy="46" r="3.5" fill="var(--line)" />
    </svg>
  )
}

const DATASETS = [
  'LOLA topography (LRO)',
  'JPL SPICE DE440 ephemerides',
  'LROC WAC global mosaic',
  'LRO CRaTER cosmic-ray dose',
  'Lunar Prospector hydrogen',
  'Robbins crater catalogue',
  'PGDA illumination & Earth visibility',
  'DSN, ESA & JAXA ground stations',
]

export function Landing() {
  const [active, setActive] = useState(0)

  // fade the cards in as they enter the view (skipped with reduced motion: CSS shows them at once)
  useEffect(() => {
    const els = document.querySelectorAll('.reveal')
    if (!('IntersectionObserver' in window) || reducedMotion()) {
      els.forEach((e) => e.classList.add('is-in'))
      return
    }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add('is-in')), { threshold: 0.15 })
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Background onSection={setActive} />
      <Nav active={active} />
      <Rail active={active} />

      <main id="main">
        <section id="top" className="section hero" aria-labelledby="hero-title">
          <div className="hero-inner">
            <p className="eyebrow">NASA Space Apps Challenge 2026 · Team Lunatiks</p>
            <h1 id="hero-title">
              Know where the Sun rises <span className="nowrap">and the Earth stays</span> <em>before you land.</em>
            </h1>
            <p className="lead">
              Lunar Landing Site Navigator shows the Sun and the Earth over the real lunar horizon at any site and date, so mission planners,
              educators and the public can compare landing sites and dates at a glance and replan in seconds when a schedule slips.
            </p>
            <div className="actions">
              <a className="btn btn-primary" href={APP_URL}>
                Open the navigator <Arrow />
              </a>
              <a className="btn btn-ghost" href="#demo">
                Watch the 30-second demo
              </a>
            </div>
            <dl className="hero-facts">
              <div>
                <dt className="mono">0.000026°</dt>
                <dd>largest difference from JPL Horizons</dd>
              </div>
              <div>
                <dt className="mono">21</dt>
                <dd>curated sites, or any coordinates</dd>
              </div>
              <div>
                <dt className="mono">2025–2035</dt>
                <dd>Sun and Earth, hour by hour</dd>
              </div>
            </dl>
          </div>
          <a className="scroll-cue" href="#demo">
            <span>Scroll to descend to the south pole</span>
            <span className="scroll-line" aria-hidden="true" />
          </a>
        </section>

        <section id="demo" className="section demo" aria-labelledby="demo-title">
          <div className="demo-inner reveal">
            <p className="kicker">
              <span className="mono">00</span> The demo
            </p>
            <h2 id="demo-title">Thirty seconds on the Moon’s south pole</h2>
            <Demo />
          </div>
        </section>

        <Feature
          id="horizon"
          index="01"
          kicker="Sun and Earth over the horizon"
          title="See the sky from the ground"
          stat={{ value: '0.000026°', label: 'largest difference from JPL Horizons over 352 Sun and Earth directions at 11 sites' }}
          art={<ArtHorizon />}
        >
          <p>
            Pick a site and a date and see where the Sun and the Earth sit against the <strong>real terrain skyline</strong>, ray-traced
            over NASA LOLA topography on 720 azimuths. Both are treated as discs, not points, so a Sun half hidden behind a ridge counts as half.
          </p>
          <ul className="ticks">
            <li>Solar elevation, sunlight hours and time to the next sunset</li>
            <li>Earth visibility windows, longest blackout and time to Earthset</li>
            <li>A first-person horizon view with the Sun and Earth tracks and the real stars</li>
          </ul>
        </Feature>

        <Feature
          id="compare"
          index="02"
          kicker="Sites and dates"
          title="Compare sites and dates at a glance"
          side="right"
          stat={{ value: '≈1 s', label: 'to sweep 21 places × 365 landing dates when a launch slips' }}
          art={<ArtCompare />}
        >
          <p>
            Start from 21 curated sites, from Apollo 11 to IM-2, Blue Ghost 1, Chandrayaan-3, SLIM and the south-polar ridges, or type any
            coordinates. Put them side by side and play the mission window on one timeline.
          </p>
          <ul className="ticks">
            <li>Sunlight and Earth contact as a fraction of time and as exact time ranges</li>
            <li>Changes across lunar days and seasons, month by month</li>
            <li>A shareable link that carries the whole scenario</li>
          </ul>
        </Feature>

        <Feature
          id="mission"
          index="03"
          kicker="Mission planning"
          title="Find where a lander can go at all"
          stat={{ value: '9', label: 'filter families: terrain, light and power, Earth contact, temperature, radiation and more' }}
          art={<ArtMission />}
        >
          <p>
            Mission mode searches a whole region instead of testing points one by one. Set the limits, and it paints every cell that passes
            them all, outlines the connected areas and opens the best spot for study.
          </p>
          <ul className="ticks">
            <li>Hard limits first: slope, continuous light, Earth contact, battery, dose, temperature</li>
            <li>Then a score with weights you can see and change</li>
            <li>Solar power from sunlight on the panel to a colony’s energy budget</li>
            <li>What no dataset can answer, such as rocks, is shown as unknown, never guessed</li>
          </ul>
        </Feature>

        <section id="data" className="section feature feature-right" aria-labelledby="data-title">
          <div className="card reveal">
            <p className="kicker">
              <span className="mono">04</span> NASA data, open methods
            </p>
            <h2 id="data-title">Built on NASA data, checked in the open</h2>
            <div className="feature-body">
              <p>
                Every number comes from NASA and JPL data through a documented REST API, with the source and the transformation of each
                dataset on record. An Educational mode turns the same places and times into missions for classrooms and the public.
              </p>
              <ul className="chips" aria-label="Datasets">
                {DATASETS.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
            <div className="feature-foot">
              <p className="stat">
                <span className="stat-value mono">0.066°</span>
                <span className="stat-label">largest Sun elevation difference over 43 events of six Apollo missions</span>
              </p>
              <p className="stat">
                <span className="stat-value mono">13</span>
                <span className="stat-label">south-polar sites with LOLA horizon masks from 10 to 240 m maps</span>
              </p>
            </div>
          </div>
        </section>

        <section id="start" className="section cta" aria-labelledby="start-title">
          <div className="cta-inner reveal">
            <h2 id="start-title">Pick your landing site.</h2>
            <p className="lead">The whole Moon, the south pole in 3D, and the Sun and the Earth over every horizon. No login, nothing to install.</p>
            <div className="actions actions-center">
              <a className="btn btn-primary btn-lg" href={APP_URL}>
                Open the navigator <Arrow />
              </a>
            </div>
            <ul className="cta-links">
              <li>
                <a href={`${APP_URL}#/data`}>Data &amp; methods</a>
              </li>
              {API_DOCS_URL && (
                <li>
                  <a href={API_DOCS_URL}>API documentation</a>
                </li>
              )}
              {REPO_URL && (
                <li>
                  <a href={REPO_URL}>Source code</a>
                </li>
              )}
            </ul>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>
          NASA Space Apps Challenge 2026 · Team Lunatiks · Data: NASA LRO (LOLA, LROC, CRaTER), JPL SPICE, Lunar Prospector, USGS.
        </p>
        <p>
          {BACKGROUND_VIDEO
            ? `${BACKGROUND_VIDEO_CREDIT}, marked on screen. `
            : 'The Moon behind this page is rendered live from the LROC WAC global mosaic (NASA/GSFC/Arizona State University, via Moon Trek) over the NASA SVS star map; it is not AI-generated. '}
          Code was written with AI assistance (Claude), as declared in Data &amp; methods.
        </p>
      </footer>
    </>
  )
}
