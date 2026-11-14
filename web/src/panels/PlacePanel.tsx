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
 * The Sun and Earth over the horizon stay on screen in the sky dial; their numbers (elevation, azimuth, time to the
 * next set or rise) are in the Horizon section.
 */
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { HorizonChart } from '../charts/HorizonChart'
import { type SectionId, usePanels } from '../state/panels'
import { useApp } from '../state/store'
import { formatUtc } from '../time/clock'
import { SourceTag } from '../ui/ApiStatus'
import { IconAntenna, IconBolt, IconClose, IconHorizon, IconMulti } from '../ui/icons'
import { fmtLat, fmtLon } from './format'
import { LinkPanel } from './LinkPanel'
import { ContactSetting, HeightSetting } from './Settings'
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
  const heading = useRef<HTMLHeadingElement>(null)
  const active = SECTIONS.find((s) => s.id === section)

  // Focus the heading when a section opens; give it back to the section's button when the drawer closes.
  useEffect(() => {
    if (!section) return
    heading.current?.focus()
    return () => {
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`.place-tools [data-section='${section}']`)?.focus())
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
        <button type="button" className="icon" onClick={close} aria-label={`Close ${active.title}`} title="Close (Esc)">
          <IconClose size={18} />
        </button>
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
            {view.horizonKind === 'terrain' ? `LOLA horizon · ${view.mastUsedM} m` : `Smooth sphere · ${view.mastUsedM} m`}
          </span>
          <SourceTag source={view.source} />
        </p>
      )}
      <div className="drawer-body">
        {active.id === 'power' && <PowerPanel />}
        {active.id === 'horizon' && (
          <>
            {view && <NowCards view={view} />}
            <HeightSetting />
            {info && view ? <HorizonChart info={info} sun={view.sun} earth={view.earth} tMs={view.tMs} /> : <p className="muted">Loading…</p>}
          </>
        )}
        {active.id === 'link' && (
          <>
            <ContactSetting />
            <LinkPanel />
          </>
        )}
      </div>
    </div>
  )
}
