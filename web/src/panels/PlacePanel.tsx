/**
 * The chosen place: Sun and Earth over its horizon at the chosen instant (the challenge's one obligation), then
 * one navigation row per section (horizon, power, link) with a live value and a chevron, in the grouped-list
 * style of iOS Settings, so the panel stays short. A section opens in place of the list with a back button
 * named after the place; focus follows. All text, so it is also the accessible
 * equivalent of the map.
 */
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { type SectionId, usePanels } from '../state/panels'
import { sameSelection, useApp } from '../state/store'
import { formatUtc } from '../time/clock'
import { SourceTag } from '../ui/ApiStatus'
import { ComparePanel } from '../compare/ComparePanel'
import { IconAntenna, IconBack, IconBolt, IconChevron, IconCompare, IconHorizon } from '../ui/icons'
import { fmtLat, fmtLon } from './format'
import { LinkPanel } from './LinkPanel'
import { HorizonPanel } from './HorizonPanel'
import { ContactSetting } from './Settings'
import { NowCards } from './NowPanel'
import { PowerPanel } from './PowerPanel'
import { useNow } from './useNow'

export function PlacePanel() {
  const id = useId()
  const { view, info, outOfRange } = useNow()
  const selection = useApp((s) => s.selection)
  const compare = useApp((s) => s.compare)
  const { addCompare, setCompareMode } = useApp.getState()
  const compared = compare.some((c) => sameSelection(c, selection))
  const open = usePanels((s) => s.section)
  const setOpen = usePanels.getState().setSection
  const lastOpened = useRef<SectionId | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const tiles = useRef<HTMLDivElement>(null)

  // A section left open must not survive leaving the navigator.
  useEffect(() => () => usePanels.getState().setSection(null), [])
  // Focus goes to the section heading when one opens, and back to its button when it closes.
  useEffect(() => {
    // the horizon view takes the focus itself (it is driven by the keyboard); other sections focus their heading
    if (open && open !== 'horizon') heading.current?.focus()
    else if (lastOpened.current) tiles.current?.querySelector<HTMLButtonElement>(`[data-section='${lastOpened.current}']`)?.focus()
  }, [open])

  const sections: { id: SectionId; title: string; icon: ReactNode; value: string; body: ReactNode }[] = [
    {
      id: 'horizon',
      title: 'Horizon',
      icon: <IconHorizon size={18} />,
      value: view ? `Sun ${view.sun.el.toFixed(1)}°` : '…',
      body: <HorizonPanel />,
    },
    {
      id: 'power',
      title: 'Power',
      icon: <IconBolt size={18} />,
      value: view ? `${view.power.toFixed(0)} W/m²` : '…',
      body: <PowerPanel />,
    },
    {
      id: 'link',
      title: 'Earth link',
      icon: <IconAntenna size={18} />,
      value: view ? `Earth ${Math.round(view.earth.fraction * 100)} %` : '…',
      body: (
        <>
          <ContactSetting />
          <LinkPanel />
        </>
      ),
    },
    {
      id: 'compare',
      title: 'Compare',
      icon: <IconCompare size={18} />,
      value: compare.length === 0 ? 'Add places' : `${compare.length} ${compare.length === 1 ? 'place' : 'places'}`,
      body: <ComparePanel />,
    },
  ]
  const active = sections.find((s) => s.id === open)

  return (
    <>
      {info && (
        <div className="place-head">
          <p className="place-name">{info.name}</p>
          <p className="muted">
            {fmtLat(info.model.lat)}, {fmtLon(info.model.lon)}
          </p>
          <button
            type="button"
            className="small"
            aria-pressed={compared}
            disabled={compared}
            onClick={() => {
              setCompareMode(true)
              addCompare(selection)
            }}
          >
            {compared ? 'In comparison' : '+ Compare'}
          </button>
        </div>
      )}
      {outOfRange && (
        <p className="error" role="alert">
          Outside the Sun and Earth tables (2025–2035, 1969–1972).
        </p>
      )}
      {view && (
        <>
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
          {!active && <NowCards view={view} />}
        </>
      )}
      {!view && !outOfRange && <p className="muted">Loading…</p>}

      {active ? (
        <section className="section-view" aria-labelledby={`${id}-sec`}>
          <button type="button" className="back" onClick={() => setOpen(null)} aria-label="All sections">
            <IconBack size={18} /> <span aria-hidden="true">{info?.name ?? 'Place'}</span>
          </button>
          <h3 id={`${id}-sec`} className="section-title" tabIndex={-1} ref={heading}>
            <span className={`ios-icon ios-icon-${active.id}`}>{active.icon}</span> {active.title}
          </h3>
          {active.body}
        </section>
      ) : (
        <div className="ios-list nav-list" role="group" aria-label="Sections" ref={tiles}>
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className="ios-row nav-row"
              data-section={s.id}
              onClick={() => {
                lastOpened.current = s.id
                setOpen(s.id)
              }}
            >
              <span className={`ios-icon ios-icon-${s.id}`}>{s.icon}</span>
              <span className="nav-title">{s.title}</span>
              <span className="nav-value">{s.value}</span>
              <span className="nav-chevron">
                <IconChevron size={16} />
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}
