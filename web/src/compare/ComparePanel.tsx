/**
 * Multiselect comparison: the side panel that opens once two or more places are picked with Multiselect on.
 *
 *   1. One radar plot of the metrics that decide a landing site, every axis on an absolute 0..1 scale: each place
 *      picked is added on top of the others. Hovering (or focusing) an axis, its name or its spoke, opens a small
 *      pop-up with what the axis measures and which way is better and worse. A button opens the radar large in a
 *      window centred on the screen.
 *   2. Beside it, the places as the radar's legend (numbered as on the map, with the line pattern of their shape),
 *      each with its options and remove buttons (the keyboard route to what a right click on the map does).
 *      Hovering a place brings its shape to the front and fades the others.
 *
 * When each place is sunlit or sees the Earth is in the timeline under the map: in Multiselect it shows one strip
 * per place on the window's time axis, with a Sunlit / Earth switch.
 *
 * Same instant and window for every place, computed with the browser engine (the same tables and masks as the
 * rest of the navigator). The numbers behind the radar are in a table.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DataTable } from '../charts/DataTable'
import { RadarChart } from '../charts/RadarChart'
import { sameSelection, useApp } from '../state/store'
import { formatUtc } from '../time/clock'
import { SOLAR_CONSTANT_W_M2 } from '../time/engine'
import type { WindowSeries } from '../time/hooks'
import { IconClose, IconExpand, IconMore } from '../ui/icons'
import { openMenuFrom } from '../panels/PlaceMenu'
import { type ComparedPlace, useComparePlaces } from './useComparePlaces'

interface Axis {
  key: string
  label: string
  /** 0..1, outward is better, on an absolute scale (not relative to the places shown). */
  value: (w: WindowSeries) => number
  /** Full sentence for the table, the pop-up and the screen-reader summary. */
  text: (w: WindowSeries) => string
}

/** What a planner wants more of, each on a fixed scale that the label states. */
const AXES: Axis[] = [
  { key: 'sun', label: 'Sunlight', value: (w) => w.metrics.sunlightPct / 100, text: (w) => `${w.metrics.sunlightPct.toFixed(0)} % of the window` },
  { key: 'earth', label: 'Earth contact', value: (w) => w.metrics.commsPct / 100, text: (w) => `${w.metrics.commsPct.toFixed(0)} % of the window` },
  {
    key: 'night',
    label: 'Short nights',
    value: (w) => 1 - Math.min(1, w.metrics.longestDarkH / Math.max(1, w.metrics.windowHours)),
    text: (w) => `longest night ${w.metrics.longestDarkH.toFixed(0)} h`,
  },
  {
    key: 'blackout',
    label: 'Steady contact',
    value: (w) => 1 - Math.min(1, w.metrics.longestBlackoutH / Math.max(1, w.metrics.windowHours)),
    text: (w) => `longest blackout ${w.metrics.longestBlackoutH.toFixed(0)} h`,
  },
  {
    key: 'power',
    label: 'Power',
    value: (w) => Math.min(1, w.metrics.meanPowerWm2 / SOLAR_CONSTANT_W_M2),
    text: (w) => `${w.metrics.meanPowerWm2.toFixed(0)} W/m² mean`,
  },
]

/**
 * What each axis means and which way is better, shown in a small pop-up when the pointer is over an axis name of
 * the radar (or it has keyboard focus). `comms` is the share of the Earth's disc that counts as contact (the
 * analysis setting).
 */
const HELP: Record<string, { what: (comms: number) => string; better: string; worse: string }> = {
  sun: {
    what: () => 'Share of the window with any part of the Sun above the local horizon.',
    better: 'More sunlight: more solar power and warmth.',
    worse: 'Long stretches in shadow: batteries and heaters must carry the load.',
  },
  earth: {
    what: (c) => `Share of the window with at least ${Math.round(c * 100)} % of the Earth's disc above the horizon (direct radio link).`,
    better: 'More time talking to Earth directly.',
    worse: 'Little direct contact: a relay satellite is needed.',
  },
  night: {
    what: () => 'Longest continuous time without sunlight in the window. On the radar: 1 − longest night ÷ window length.',
    better: 'Short nights: a smaller battery survives them.',
    worse: 'Long nights: the battery and the thermal design must last through them.',
  },
  blackout: {
    what: () => 'Longest continuous time without the Earth in view. On the radar: 1 − longest blackout ÷ window length.',
    better: 'Short gaps: commands and data flow steadily.',
    worse: 'Long blackouts: the lander must work on its own for that long.',
  },
  power: {
    what: () => `Mean sunlight reaching the solar panel over the window, as a share of the solar constant (${SOLAR_CONSTANT_W_M2} W/m²).`,
    better: 'More energy per square metre of panel.',
    worse: 'Low mean power: larger panels are needed.',
  },
}


interface Tip {
  key: string
  /** Pop-up anchor in CSS pixels of the viewport. */
  left: number
  top: number
  /** Open above the anchor (when there is not enough room below). */
  above: boolean
  /** Where the pop-up is rendered: the large window (top layer) when the axis is in it, else <body>. */
  host: HTMLElement
}

const TIP_HALF = 125
/** Height the pop-up needs below its anchor before it opens above instead (CSS pixels). */
const TIP_ROOM = 250

export function ComparePanel({ titleId }: { titleId: string }) {
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const { setCompareMode } = useApp.getState()
  const places = useComparePlaces()
  const ready = places.filter((p) => p.win)
  const [big, setBig] = useState(false)

  return (
    <div className="multi">
      <div className="multi-head">
        <h2 id={titleId} className="multi-title" tabIndex={-1}>
          Comparing {places.length} places
        </h2>
        <button type="button" className="icon" onClick={() => setBig(true)} aria-label="Open the radar in a large window" title="Enlarge">
          <IconExpand size={18} />
        </button>
        <button type="button" className="icon" onClick={() => setCompareMode(false)} aria-label="Close comparison and leave multiselect" title="Leave multiselect">
          <IconClose size={18} />
        </button>
      </div>

      <RadarView places={places} actions />

      <DataTable
        summary="Table"
        caption={`Places compared over the window from ${formatUtc(startMs)} (${Math.round(durationH / 24)} days)`}
        head={['Place', ...AXES.map((a) => a.label)]}
        rows={ready.map((p) => [`${p.num} ${p.info.name}`, ...AXES.map((a) => a.text(p.win!))])}
      />

      {big && <BigRadar places={places} onClose={() => setBig(false)} />}
    </div>
  )
}

/**
 * The radar in a large window centred on the screen (a modal <dialog>: focus stays inside, Escape or the close
 * button or a click on the backdrop closes it, and the focus returns to the button that opened it).
 */
function BigRadar({ places, onClose }: { places: ComparedPlace[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    const opener = document.activeElement as HTMLElement | null
    if (typeof d.showModal === 'function') d.showModal()
    else d.setAttribute('open', '')
    return () => opener?.focus()
  }, [])
  return createPortal(
    <dialog
      ref={ref}
      className="cmp-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="cmp-dialog-body">
        <div className="multi-head">
          <h2 id={titleId} className="multi-title">
            Comparing {places.length} places
          </h2>
          <button type="button" className="icon" onClick={onClose} aria-label="Close the large radar">
            <IconClose size={18} />
          </button>
        </div>
        <RadarView places={places} big />
      </div>
    </dialog>,
    document.body,
  )
}

/**
 * One radar with every place on it and the places beside it as its legend. Hovering (or focusing) an axis opens
 * a small pop-up with what it measures, which way is better and worse, and each place's figure; hovering a place
 * brings its shape to the front. `actions` adds each place's options and remove buttons to the legend.
 */
function RadarView({ places, actions = false, big = false }: { places: ComparedPlace[]; actions?: boolean; big?: boolean }) {
  const comms = useApp((s) => s.commsMinFraction)
  const ready = places.filter((p) => p.win)
  const [hl, setHl] = useState<number | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const tipId = useId()

  // the pop-up floats over the page (fixed position) so no scrolling panel clips it; inside the large window it is
  // rendered in the <dialog> (the top layer), elsewhere in <body>
  const onAxis = (key: string | null, anchor: Element | null) => {
    if (!key || !anchor) return setTip(null)
    const r = anchor.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    const above = below < TIP_ROOM && r.top > below
    const left = Math.max(TIP_HALF + 8, Math.min(window.innerWidth - TIP_HALF - 8, r.left + r.width / 2))
    const host = (anchor.closest('dialog') as HTMLElement | null) ?? document.body
    setTip({ key, left, top: above ? r.top - 6 : r.bottom + 6, above, host })
  }

  const summary =
    `Radar of ${places.length} places over ${AXES.map((a) => a.label.toLowerCase()).join(', ')}, outward is better. ` +
    ready.map((p) => `${p.num} ${p.info.name}: ${AXES.map((a) => a.text(p.win!)).join(', ')}`).join('. ')
  const tipAxis = tip ? AXES.find((a) => a.key === tip.key)! : null

  return (
    <div className={`cmp-layout${big ? ' is-big' : ''}`}>
      <div className="cmp-radar-box">
        {ready.length >= 2 ? (
          <RadarChart
            axes={AXES}
            series={ready.map((p) => ({ num: p.num, name: p.info.name, values: AXES.map((a) => a.value(p.win!)) }))}
            summary={summary}
            highlight={hl}
            activeAxis={tip?.key ?? null}
            onAxis={onAxis}
            describedBy={tipId}
          />
        ) : (
          <p className="muted">Computing…</p>
        )}
      </div>
      {tip &&
        tipAxis &&
        createPortal(
          <div id={tipId} role="tooltip" className={`cmp-tip${tip.above ? ' is-above' : ''}`} style={{ left: tip.left, top: tip.top }}>
            <strong className="cmp-tip-title">{tipAxis.label}</strong>
            <p>{HELP[tip.key].what(comms)}</p>
            <p className="cmp-tip-good">
              <span aria-hidden="true">▲</span> <b>Better:</b> {HELP[tip.key].better}
            </p>
            <p className="cmp-tip-bad">
              <span aria-hidden="true">▼</span> <b>Worse:</b> {HELP[tip.key].worse}
            </p>
            {ready.length > 0 && (
              <ul className="cmp-tip-values">
                {ready.map((p) => (
                  <li key={p.num}>
                    <span className="num" aria-hidden="true">
                      {p.num}
                    </span>
                    {/* just the figure: "124 h", "83 %", "719 W/m² mean" (the title says what it is) */}
                    {tipAxis.text(p.win!).replace(' of the window', '').replace(/^[a-z ]+(?=\d)/, '')}
                  </li>
                ))}
              </ul>
            )}
          </div>,
          tip.host,
        )}

      <ol className="cmp-legend" aria-label={actions ? 'Places compared' : 'Legend'} onMouseLeave={() => setHl(null)}>
        {places.map((p) => (
          <LegendRow key={p.num} p={p} actions={actions} on={hl === p.num} onHover={setHl} />
        ))}
      </ol>
    </div>
  )
}

/** One place in the legend: its line pattern and number, name and, in the panel, its options and remove buttons. */
function LegendRow({ p, actions, on, onHover }: { p: ComparedPlace; actions: boolean; on: boolean; onHover: (n: number | null) => void }) {
  const selection = useApp((s) => s.selection)
  const { select, removePlace } = useApp.getState()
  const current = sameSelection(p.sel, selection)
  return (
    <li
      className={`cmp-row radar-key rs-${p.num}${current ? ' is-current' : ''}${on ? ' is-hl' : ''}${actions ? '' : ' is-plain'}`}
      onMouseEnter={() => onHover(p.num)}
      onFocus={() => onHover(p.num)}
    >
      <svg width="26" height="10" aria-hidden="true">
        <line x1="1" y1="5" x2="25" y2="5" />
      </svg>
      <span className="num" aria-hidden="true">
        {p.num}
      </span>
      <div className="cmp-row-main">
        {actions ? (
          <button type="button" className="multi-name" onClick={() => select(p.sel)} aria-current={current ? 'true' : undefined} title={p.info.name}>
            {p.info.name}
          </button>
        ) : (
          <span className="cmp-row-name">{p.info.name}</span>
        )}
        {p.info.model.horizon.kind === 'smooth_sphere' && <span className="tag-pill">smooth sphere</span>}
      </div>
      {actions && (
        <>
          <button
            type="button"
            className="icon small"
            aria-haspopup="dialog"
            aria-label={`Options for ${p.info.name}`}
            title="Rename, pointer colour, remove"
            onClick={(e) => openMenuFrom(e.currentTarget, { sel: p.sel, name: p.info.name })}
          >
            <IconMore size={14} />
          </button>
          <button type="button" className="icon small" onClick={() => removePlace(p.sel, p.info.name)} aria-label={`Remove ${p.info.name}`}>
            <IconClose size={14} />
          </button>
        </>
      )}
    </li>
  )
}
