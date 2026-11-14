/**
 * Radio link levels (AERO-2, POST /api/v1/link). Level 1, the Earth's disc above the local horizon, is in the
 * engine and shown here. Levels 2 (ground-station visibility) and 3 (link budget) need the AERO-2 model and
 * its cited parameters; until it is merged the panel says so instead of estimating.
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
      <p className="muted small">Ground stations and link budget: pending the AERO-2 model.</p>
    </div>
  )
}
