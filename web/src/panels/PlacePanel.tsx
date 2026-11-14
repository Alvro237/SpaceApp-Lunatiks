/**
 * The chosen place: Sun and Earth over its horizon at the chosen instant (the challenge's one obligation), then
 * the horizon chart, power and link on demand. All text, so it is also the accessible equivalent of the map.
 */
import { HorizonChart } from '../charts/HorizonChart'
import { sameSelection, useApp } from '../state/store'
import { formatUtc } from '../time/clock'
import { SourceTag } from '../ui/ApiStatus'
import { fmtLat, fmtLon } from './format'
import { LinkPanel } from './LinkPanel'
import { NowCards } from './NowPanel'
import { PowerPanel } from './PowerPanel'
import { useNow } from './useNow'

export function PlacePanel() {
  const { view, info, outOfRange } = useNow()
  const selection = useApp((s) => s.selection)
  const compare = useApp((s) => s.compare)
  const { addCompare, setCompareMode } = useApp.getState()
  const compared = compare.some((c) => sameSelection(c, selection))

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
              {view.horizonKind === 'terrain' ? `LOLA horizon · ${view.mastUsedM} m` : `Smooth sphere · ${view.mastUsedM} m`}
            </span>
            <SourceTag source={view.source} />
          </p>
          <NowCards view={view} />
          <details className="section">
            <summary>Horizon</summary>
            {info && <HorizonChart info={info} sun={view.sun} earth={view.earth} tMs={view.tMs} />}
          </details>
        </>
      )}
      <details className="section">
        <summary>Power</summary>
        <PowerPanel />
      </details>
      <details className="section">
        <summary>Link to Earth</summary>
        <LinkPanel />
      </details>
      {!view && !outOfRange && <p className="muted">Loading…</p>}
    </>
  )
}
