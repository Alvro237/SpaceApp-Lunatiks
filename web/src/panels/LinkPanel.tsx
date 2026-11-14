/**
 * Radio link levels (AERO-2, POST /api/v1/link; team decision 2026-11-14). Level 1 is geometric contact: the
 * site sees the Earth AND a selected ground antenna sees the Moon. Level 2 is the link budget. The engine gives
 * the site half of level 1 (the Earth's disc above the local horizon), shown here; ground stations and the link
 * budget need the AERO-2 model and its cited parameters, so until it is merged the panel says so instead of
 * estimating.
 */
import { formatDuration } from '../time/clock'
import { useNow } from './useNow'

export function LinkPanel() {
  const { series: local, view } = useNow()

  return (
    <div className="panel-section link-body">
      {view && local ? (
        <dl className="kv">
          <div>
            <dt>Earth disc visible now</dt>
            <dd>{Math.round(view.earth.fraction * 100)} %</dd>
          </div>
          <div>
            <dt>Distance to the Earth</dt>
            <dd>{Math.round(view.earth.distKm).toLocaleString('en')} km</dd>
          </div>
          <div>
            <dt>{view.nextEarth?.kind === 'rise' ? 'Next Earthrise' : 'Next Earthset'}</dt>
            <dd>{view.nextEarth ? `in ${formatDuration(view.nextEarth.inMs)}` : 'no change within 45 days'}</dd>
          </div>
          <div>
            <dt>Contact in window</dt>
            <dd>{local.metrics.commsPct.toFixed(1)} %</dd>
          </div>
          <div>
            <dt>Longest blackout</dt>
            <dd>{local.metrics.longestBlackoutH.toFixed(1)} h</dd>
          </div>
        </dl>
      ) : (
        <p className="muted">Loading…</p>
      )}
      <p className="muted small">
        Line of sight to the Earth only. Ground-station visibility (level 1) and the link budget (level 2) are
        pending the AERO-2 model.
      </p>
    </div>
  )
}
