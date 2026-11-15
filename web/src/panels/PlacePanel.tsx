/**
 * The chosen place without a permanent side panel. Two parts:
 *
 *   PlaceTools: buttons that sit in the map tool bar next to the map layers. Multiselect (pick several places to
 *   compare; the comparison opens on its own once two are picked), and, for a single place, its sections: Power,
 *   Horizon and Earth link. A section button opens that section and pressing it again closes it.
 *
 *   SectionDrawer: the side panel that shows the open section, with the place's name, the horizon it is computed
 *   over, and a close button. Escape closes it and focus goes back to its button.
 *
 * With no section open the map keeps the whole screen and the timeline shows when the place is sunlit and sees
 * the Earth. Horizon opens the first-person horizon view over the map (NavigatorPage); its panel steers that view
 * and adds the Sun and Earth cards with the time to the next set or rise.
 */
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { type SectionId, usePanels } from '../state/panels'
import { useApp } from '../state/store'
import { formatUtc } from '../time/clock'
import { SourceTag } from '../ui/ApiStatus'
import { IconAntenna, IconBolt, IconHorizon, IconMore, IconMulti } from '../ui/icons'
import { BackButton, CloseButton } from '../ui/PanelNav'
import { openMenuFrom } from './PlaceMenu'
import { fmtLat, fmtLon } from './format'
import { LinkPanel } from './LinkPanel'
import { HorizonPanel } from './HorizonPanel'
import { NowCards } from './NowPanel'
import { PowerPanel } from './PowerPanel'
import { useNow } from './useNow'

const SECTIONS: { id: SectionId; title: string; icon: (size: number) => ReactNode }[] = [
  { id: 'power', title: 'Power', icon: (s) => <IconBolt size={s} /> },
  { id: 'horizon', title: 'Horizon', icon: (s) => <IconHorizon size={s} /> },
  { id: 'link', title: 'Earth link', icon: (s) => <IconAntenna size={s} /> },
]

/** Multiselect and the single-place sections, for the map tool bar. */
export function PlaceTools() {
  const compareMode = useApp((s) => s.compareMode)
  const count = useApp((s) => s.compare.length)
  const setCompareMode = useApp((s) => s.setCompareMode)
  const section = usePanels((s) => s.section)
  const setSection = usePanels((s) => s.setSection)
  // the sections are about one place: they wait until one is chosen
  const hasPlace = useApp((s) => s.selection !== null)

  return (
    <div className="place-tools" role="group" aria-label="Place tools">
      <button
        type="button"
        className={`tool-btn multi-btn${compareMode ? ' is-on' : ''}`}
        aria-pressed={compareMode}
        aria-label="Multiselect"
        title={compareMode ? 'Multiselect on: pick places to compare, right click to remove one' : 'Multiselect: pick several places to compare them'}
        onClick={() => setCompareMode(!compareMode)}
      >
        <IconMulti size={18} />
        {compareMode && (
          <span className="multi-count" aria-hidden="true">
            {count}
          </span>
        )}
      </button>
      {compareMode ? (
        count < 2 && (
          <span className="multi-hint" role="status">
            Pick {count === 0 ? 'two places' : 'another place'} on the map or in the search
          </span>
        )
      ) : (
        hasPlace && (
        <>
          <span className="tool-sep" aria-hidden="true" />
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              data-section={s.id}
              className={`tool-btn sec-btn sec-${s.id}${section === s.id ? ' is-on' : ''}`}
              aria-pressed={section === s.id}
              onClick={() => setSection(section === s.id ? null : s.id)}
            >
              {s.icon(17)}
              <span>{s.title}</span>
            </button>
          ))}
        </>
        )
      )}
    </div>
  )
}

/** The open section of the single place, in the side panel. */
export function SectionDrawer({ titleId }: { titleId: string }) {
  const id = useId()
  const { view, info, outOfRange } = useNow()
  const section = usePanels((s) => s.section)
  const setSection = usePanels((s) => s.setSection)
  const back = usePanels((s) => s.back)
  const trail = usePanels((s) => s.trail)
  // the section shown before this one, for the Back button
  const prev = SECTIONS.find((s) => s.id === trail[trail.length - 1])
  const heading = useRef<HTMLHeadingElement>(null)
  const active = SECTIONS.find((s) => s.id === section)

  // Focus the heading when a section opens (the horizon view takes the focus itself: it is driven by the keyboard);
  // give it back to the section's button when the drawer closes.
  useEffect(() => {
    if (!section) return
    if (section !== 'horizon') heading.current?.focus()
    return () => {
      // only when the drawer closes: going Back or to another section keeps the focus in the drawer
      requestAnimationFrame(() => {
        if (!usePanels.getState().section) document.querySelector<HTMLButtonElement>(`.place-tools [data-section='${section}']`)?.focus()
      })
    }
  }, [section])

  if (!active) return null
  const close = () => setSection(null)

  return (
    <div
      className="drawer"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          close()
        }
      }}
    >
      {prev && (
        <div className="panel-nav">
          <BackButton label={`Back to ${prev.title}`} onClick={back}>
            {prev.title}
          </BackButton>
        </div>
      )}
      <div className="drawer-head">
        <span className={`ios-icon ios-icon-${active.id}`}>{active.icon(18)}</span>
        <div className="drawer-titles">
          <h2 id={titleId} className="drawer-title" tabIndex={-1} ref={heading}>
            {active.title}
          </h2>
          {info && (
            <p className="drawer-place" id={`${id}-place`}>
              {info.name} · {fmtLat(info.model.lat)}, {fmtLon(info.model.lon)}
            </p>
          )}
        </div>
        {info && (
          <button
            type="button"
            className="icon"
            aria-haspopup="dialog"
            aria-label={`Options for ${info.name}`}
            title="Rename, pointer colour, remove"
            onClick={(e) => {
              const sel = useApp.getState().selection
              if (sel) openMenuFrom(e.currentTarget, { sel, name: info.name })
            }}
          >
            <IconMore size={18} />
          </button>
        )}
        <CloseButton label={`Close ${active.title}`} onClick={close} />
      </div>
      {outOfRange && (
        <p className="error" role="alert">
          Outside the Sun and Earth tables (2025–2035, 1969–1972).
        </p>
      )}
      {view && (
        <p className="meta-line">
          <span>{formatUtc(view.tMs)}</span>
          <span className={`badge badge-${view.horizonKind}`}>
            {info?.horizonSource === 'traced'
              ? `Traced horizon · ${info.demCellM ?? '?'} m DEM · ${view.mastUsedM} m`
              : view.horizonKind === 'terrain'
                ? `LOLA horizon · ${view.mastUsedM} m`
                : `Smooth sphere · ${view.mastUsedM} m`}
          </span>
          <SourceTag source={view.source} />
        </p>
      )}
      <div className="drawer-body">
        {active.id === 'power' && <PowerPanel />}
        {active.id === 'horizon' && (
          <>
            {view && <NowCards view={view} />}
            <HorizonPanel />
          </>
        )}
        {active.id === 'link' && <LinkPanel />}
      </div>
    </div>
  )
}
