/**
 * The full written guide: a modal page saying what each part of the screen does, where its numbers come from and
 * how to read them. Opened from the last step of the walkthrough (Walkthrough.tsx).
 *
 * Laid out like the screen it explains: a small diagram of the navigator with numbered zones, then one section per
 * zone, numbered the same way, listing every control with its icon. The diagram is decorative (the numbered
 * headings carry the same structure), so nothing depends on seeing it.
 *
 * A native <dialog> opened with showModal(): focus moves into it and stays there, Escape closes it, the page behind
 * is inert, and focus returns to where it was on close. A contents list jumps to each section.
 */
import { type MouseEvent, type ReactNode, type Ref, useId } from 'react'
import {
  IconAntenna,
  IconBolt,
  IconCalendar,
  IconClose,
  IconCompare,
  IconCrosshair,
  IconCube,
  IconFilter,
  IconGlobe,
  IconHelp,
  IconHorizon,
  IconLayers,
  IconMore,
  IconMulti,
  IconPin,
  IconPlay,
  IconPlus,
  IconPole,
  IconSearch,
  IconSpeed,
} from './icons'
import './guide.css'

interface Item {
  icon?: ReactNode
  name: string
  /** What it does, in one or two sentences. */
  does: ReactNode
  /** Where its numbers come from, when it shows numbers. */
  data?: ReactNode
}

interface Zone {
  id: string
  num: number
  title: string
  intro: ReactNode
  items: Item[]
}

const ZONES: Zone[] = [
  {
    id: 'top-bar',
    num: 1,
    title: 'Top bar',
    intro: 'Chooses how you use the tool. It stays at the top of every view.',
    items: [
      {
        name: 'Site explorer',
        does: 'Study chosen places: pick sites or points, then read the Sun, the Earth, power and the radio link for each, or compare several.',
      },
      {
        name: 'Mission planner',
        does: 'Let the tool find the places for you: draw a search region, switch on the mission filters you need, and the areas where every filter passes are painted on the map.',
      },
      {
        name: 'Educational',
        does: 'The same place and time drawn as a world of cubes, with plain answers (is the Sun up? can we see Earth?) and small missions for young learners.',
      },
      {
        name: 'Data & methods',
        does: 'Every NASA dataset behind the numbers, how it was processed, the validation against JPL Horizons, the known gaps, and how AI was used.',
      },
      { icon: <IconHelp size={18} />, name: 'Tour', does: 'A step-by-step tour of the screen; its last step opens this guide.' },
    ],
  },
  {
    id: 'where-when',
    num: 2,
    title: 'Where and when',
    intro: 'Top left. Every answer in the tool is for one place (or several) over one time window.',
    items: [
      {
        icon: <IconSearch size={18} />,
        name: 'Site search',
        does: 'Type a name to find a landing site, a past mission or a polar feature. Arrow keys move, Enter picks. The place is added to the map.',
        data: 'Catalogue with cited coordinates (NASA NSSDCA, LROC, USGS/IAU Gazetteer).',
      },
      {
        icon: <IconCrosshair size={18} />,
        name: 'Coordinates',
        does: 'Enter a latitude and longitude for any point of the Moon.',
        data: 'Latitude planetocentric, longitude east-positive, Moon Mean-Earth frame (the frame of LOLA).',
      },
      {
        icon: <IconCalendar size={18} />,
        name: 'Date pill',
        does: 'Shows the start (UTC) and the length of the analysis window, and opens a panel to change them (1 to 365 days). The timeline, the sections and the comparison all follow it.',
        data: 'Sun and Earth positions from JPL SPICE (DE440), hourly, 2025 to 2035.',
      },
    ],
  },
  {
    id: 'tool-bar',
    num: 3,
    title: 'Tool bar',
    intro: 'Next to "where and when". Tools for the map and for the chosen place.',
    items: [
      {
        icon: <IconFilter size={18} />,
        name: 'Mission filters',
        does: (
          <>
            Mission planner only. Place a search region, set the window, then switch on filters by family: search area, terrain and landing, light and
            power, Earth contact, temperature, radiation, mission window and science. Each switch reveals its threshold. A cell that fails any filter
            is out. The answer is painted on the map and listed as connected areas, each with <em>Show</em> and <em>Study</em>.
          </>
        ),
        data: 'No threshold is pre-filled; "Example mission" fills a worked example and says so. Filters the data cannot answer (rocks, link margin, solar storms) are listed with the reason.',
      },
      {
        icon: <IconLayers size={18} />,
        name: 'Map layers',
        does: 'Colour the map by slope, mean sunlight, mean Earth visibility or permanent shadow, or show the photo mosaic. Also: marker style, lighting, crater rims and relief exaggeration (×1, ×2, ×5). The legend chip gives the range, units and source.',
        data: 'LOLA slope and the 18.6-year illumination grids (NASA PGDA), LROC WAC mosaic, Robbins (2018) crater catalogue.',
      },
      {
        icon: <IconPlus size={18} />,
        name: 'Map view',
        does: 'Zoom in and out, back to the whole pole, tilt into 3D relief, and switch between the globe and the south-polar map.',
      },
      {
        icon: <IconMulti size={18} />,
        name: 'Multiselect',
        does: 'Pick several places to compare them. The comparison opens by itself once two are picked.',
      },
      {
        icon: <IconBolt size={18} />,
        name: 'Power · Horizon · Earth link',
        does: 'The sections of the single chosen place. A button opens its section in the side panel (zone 5); pressing it again closes it.',
      },
    ],
  },
  {
    id: 'map',
    num: 4,
    title: 'Map and globe',
    intro: 'Fills the window. Everything it shows is also given as text in the panels.',
    items: [
      {
        icon: <IconGlobe size={18} />,
        name: 'Globe',
        does: 'The whole Moon lit by the Sun at the chosen instant. Drag to turn it, the wheel to come closer. Zooming in over the south pole hands over to the detailed polar map.',
        data: 'Global LOLA topography; LROC WAC photo.',
      },
      {
        icon: <IconPole size={18} />,
        name: 'South-polar map',
        does: 'Top-down view south of 60° S that tilts into 3D relief over the same tiles. Arrows move, + and − zoom, T tilts, Q and E rotate, R resets.',
        data: 'LOLA elevation and slope, 20 m to 240 m cells (PGDA product 90).',
      },
      {
        icon: <IconPin size={18} />,
        name: 'Places',
        does: 'Click a site to choose it. In Site explorer a click on the ground marks a new point there. Each place is also a real button, reachable with Tab.',
      },
      {
        icon: <IconMore size={18} />,
        name: 'Place menu',
        does: 'Right click a place (or its ⋯ button in a panel) to rename it, choose its colour or remove it. A removal can be undone for a few seconds.',
      },
    ],
  },
  {
    id: 'side-panel',
    num: 5,
    title: 'Side panel',
    intro: 'Right side, only on demand. It shows one section of the chosen place, or the comparison.',
    items: [
      {
        icon: <IconBolt size={18} />,
        name: 'Power',
        does: (
          <>
            <em>At a glance</em> (no input needed): power on 1 m² of panel, solar elevation, sunlight duration, Earth visibility and cosmic-ray dose.
            Then three models you fill in: <em>Solar array</em>, <em>Battery balance</em> and <em>Colony</em> (heating, loads, survives or fails). The
            battery charge and the inside temperature are drawn on the timeline.
          </>
        ),
        data: 'Engine over the terrain horizon; dose from LRO CRaTER. No panel, battery or load value is pre-filled.',
      },
      {
        icon: <IconHorizon size={18} />,
        name: 'Horizon',
        does: 'Stand on the place and look around its real horizon in first person. The camera can look freely or follow the Sun or the Earth. Set the mast height; the horizon is also given as a table.',
        data: 'LOLA horizon masks (720 azimuths, 4 mast heights) or a horizon traced from LOLA for other points.',
      },
      {
        icon: <IconAntenna size={18} />,
        name: 'Earth link',
        does: 'How much of the Earth is visible now, its distance, the next Earthset or Earthrise, the share of the window in contact and the longest blackout.',
        data: 'Line of sight from the place to the Earth.',
      },
      {
        icon: <IconCompare size={18} />,
        name: 'Comparison',
        does: 'With Multiselect and two or more places: one card per place with a radar of the metrics that decide a landing site, each on a fixed 0 to 1 scale, the best of the group as an outline, and the numbers with a star for the best.',
      },
    ],
  },
  {
    id: 'timeline',
    num: 6,
    title: 'Timeline',
    intro: 'Bottom of the map. The analysis window as a time axis.',
    items: [
      {
        icon: <IconPlay size={18} />,
        name: 'Clock and playback',
        does: 'Drag the slider to any instant; the map, the sky and every panel follow. Play or pause with Space.',
      },
      {
        icon: <IconSpeed size={18} />,
        name: 'Speed',
        does: 'Changes how fast time runs while playing.',
      },
      {
        name: 'Sunlit and Link strips',
        does: 'When the place is sunlit and when it has a radio link with the Earth, across the whole window. With Multiselect: one strip per place, and a switch to show sunlight or link.',
        data: 'Each strip gives both forms of a time answer: the share of the window and the time ranges.',
      },
    ],
  },
]

const READING: { term: string; text: ReactNode }[] = [
  {
    term: 'Terrain / Smooth sphere',
    text: 'Every answer that depends on the horizon says which one it used. Terrain is the real skyline from LOLA. Smooth sphere is an estimate where no terrain horizon exists: real terrain can make light and contact shorter (in craters) or longer (on peaks), so it is not a bound either way.',
  },
  {
    term: 'API / Browser engine',
    text: 'Where a number was computed. Both use the same method, tables and horizon masks, validated against JPL Horizons to better than 0.01°.',
  },
  {
    term: '— or "unknown"',
    text: 'No dataset gives this value here (for example rocks at lander scale). The tool never guesses it.',
  },
  {
    term: 'Pass, fail, unknown',
    text: 'Always shown with a symbol and a word, never colour alone.',
  },
  {
    term: 'Sunlit, Earth in view',
    text: 'Sunlit means any part of the Sun’s disc is above the horizon. Earth in view means at least half of the Earth’s disc is above it (you can change this share in Earth link).',
  },
  {
    term: 'ⓘ and tables',
    text: 'The ⓘ buttons explain a field in place. Every chart has a table with its numbers behind it.',
  },
]

const KEYS: [string, string][] = [
  ['Arrow keys', 'Move the map; turn in the horizon view'],
  ['+ and −', 'Zoom'],
  ['T', 'Tilt into 3D'],
  ['Q and E', 'Rotate the polar map'],
  ['R', 'Back to the whole pole'],
  ['Space', 'Play or pause the timeline'],
  ['S, E, F', 'Horizon view: follow the Sun, follow the Earth, free look'],
  ['Escape', 'Close a panel, a menu or this guide'],
]

/** Opens the guide as a modal (a plain open dialog where showModal is missing: jsdom in tests, very old browsers). */
export function openDialog(d: HTMLDialogElement | null) {
  if (!d) return
  if (typeof d.showModal === 'function') d.showModal()
  else d.setAttribute('open', '')
  d.querySelector<HTMLElement>('.guide-body')?.scrollTo?.({ top: 0 })
}

export function GuideDialog({ ref }: { ref: Ref<HTMLDialogElement> }) {
  const id = useId()
  const close = (e: MouseEvent<HTMLElement>) => {
    const d = e.currentTarget.closest('dialog')
    if (!d) return
    if (typeof d.close === 'function') d.close()
    else d.removeAttribute('open')
  }
  const jump = (e: MouseEvent<HTMLAnchorElement>, target: string) => {
    // in-dialog anchors: scroll the dialog body, not the page, and keep the URL (it carries the scenario)
    e.preventDefault()
    const el = document.getElementById(target)
    el?.scrollIntoView({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    })
    el?.focus({ preventScroll: true })
  }
  const sid = (zone: string) => `${id}-${zone}`
  return (
    <dialog
      ref={ref}
      className="guide"
      aria-labelledby={`${id}-t`}
      // a click on the backdrop (the dialog element itself, outside its box) closes it
      onClick={(e) => {
        if (e.target === e.currentTarget) close(e)
      }}
    >
      <div className="guide-box">
        <header className="guide-head">
          <div>
            <h2 id={`${id}-t`}>Guide</h2>
            <p className="muted">What each part of the Lunar Landing Site Navigator does</p>
          </div>
          <button type="button" className="icon guide-close" onClick={close} aria-label="Close the guide" title="Close (Esc)">
            <IconClose size={18} />
          </button>
        </header>

        <div className="guide-body">
          <nav className="guide-toc" aria-label="Guide contents">
            <ol>
              <li>
                <a href={`#${sid('start')}`} onClick={(e) => jump(e, sid('start'))}>
                  In three steps
                </a>
              </li>
              {ZONES.map((z) => (
                <li key={z.id}>
                  <a href={`#${sid(z.id)}`} onClick={(e) => jump(e, sid(z.id))}>
                    <span className="guide-num" aria-hidden="true">
                      {z.num}
                    </span>
                    {z.title}
                  </a>
                </li>
              ))}
              <li>
                <a href={`#${sid('educational')}`} onClick={(e) => jump(e, sid('educational'))}>
                  Educational mode
                </a>
              </li>
              <li>
                <a href={`#${sid('reading')}`} onClick={(e) => jump(e, sid('reading'))}>
                  Reading the answers
                </a>
              </li>
              <li>
                <a href={`#${sid('keys')}`} onClick={(e) => jump(e, sid('keys'))}>
                  Keyboard
                </a>
              </li>
            </ol>
          </nav>

          <div className="guide-content">
            <section aria-labelledby={sid('start')}>
              <h3 id={sid('start')} tabIndex={-1}>
                In three steps
              </h3>
              <ol className="guide-steps">
                <li>
                  <strong>Choose where.</strong> Search a site, type coordinates or click the map. Or switch to Mission planner and let the filters
                  find the areas that work.
                </li>
                <li>
                  <strong>Choose when.</strong> Set the start and length of the window in the date pill, then move through it on the timeline.
                </li>
                <li>
                  <strong>Assess.</strong> Read when the place is sunlit and sees the Earth, then open Power, Horizon or Earth link, or compare places
                  side by side.
                </li>
              </ol>
              <ScreenDiagram />
            </section>

            {ZONES.map((z) => (
              <section key={z.id} aria-labelledby={sid(z.id)}>
                <h3 id={sid(z.id)} tabIndex={-1}>
                  <span className="guide-num" aria-hidden="true">
                    {z.num}
                  </span>
                  <span className="sr-only">Zone {z.num}: </span>
                  {z.title}
                </h3>
                <p className="muted">{z.intro}</p>
                <ul className="guide-items">
                  {z.items.map((it) => (
                    <li key={it.name}>
                      <span className="guide-ico" aria-hidden="true">
                        {it.icon}
                      </span>
                      <div>
                        <strong>{it.name}</strong>
                        <p>{it.does}</p>
                        {it.data && (
                          <p className="guide-data">
                            <span>Data:</span> {it.data}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <section aria-labelledby={sid('educational')}>
              <h3 id={sid('educational')} tabIndex={-1}>
                <span className="guide-ico" aria-hidden="true">
                  <IconCube size={18} />
                </span>
                Educational mode
              </h3>
              <p>
                Turned on with the <strong>Educational</strong> switch. The place search and the date stay at the top. <em>The sky now</em> (right)
                answers in plain words whether the Sun is up and whether we can see Earth, and when that changes. The days run along the bottom, and
                the missions sit on the left. The answers come from the same engine and data as the planner; the planner shows the exact numbers.
              </p>
            </section>

            <section aria-labelledby={sid('reading')}>
              <h3 id={sid('reading')} tabIndex={-1}>
                Reading the answers
              </h3>
              <dl className="guide-terms">
                {READING.map((r) => (
                  <div key={r.term}>
                    <dt>{r.term}</dt>
                    <dd>{r.text}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section aria-labelledby={sid('keys')}>
              <h3 id={sid('keys')} tabIndex={-1}>
                Keyboard
              </h3>
              <table className="guide-keys">
                <caption className="sr-only">Keyboard shortcuts</caption>
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">What it does</th>
                  </tr>
                </thead>
                <tbody>
                  {KEYS.map(([k, v]) => (
                    <tr key={k}>
                      <th scope="row">
                        <kbd>{k}</kbd>
                      </th>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">Every control is reachable with Tab; the map is never the only way to reach a value.</p>
            </section>
          </div>
        </div>
      </div>
    </dialog>
  )
}

/** A sketch of the navigator with the zones numbered as the sections below. Decorative: the headings carry it. */
function ScreenDiagram() {
  return (
    <figure className="guide-screen" aria-hidden="true">
      <div className="gs-frame">
        <div className="gs-zone gs-top">
          <span className="guide-num">1</span> Top bar
        </div>
        <div className="gs-zone gs-where">
          <span className="guide-num">2</span> Where · when
        </div>
        <div className="gs-zone gs-tools">
          <span className="guide-num">3</span> Tools
        </div>
        <div className="gs-map">
          <span className="guide-num">4</span> Map / globe
        </div>
        <div className="gs-zone gs-side">
          <span className="guide-num">5</span> Side panel
        </div>
        <div className="gs-zone gs-time">
          <span className="guide-num">6</span> Timeline
        </div>
      </div>
    </figure>
  )
}
