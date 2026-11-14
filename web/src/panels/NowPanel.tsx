/** Sun and Earth cards: elevation, azimuth, visible share of the disc, next set or rise, power on the panel. */
import { useApp } from '../state/store'
import { formatDuration, formatUtc } from '../time/clock'
import type { BodyView, NowView } from './useNow'

const pct = (f: number) => `${Math.round(f * 100)} %`
const compass = (az: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8]

/** Visible, partly or hidden as a symbol and a word, never colour alone. */
function visibility(f: number): { symbol: string; word: string } {
  if (f >= 0.999) return { symbol: '●', word: 'above the horizon' }
  if (f > 0) return { symbol: '◐', word: `partly visible (${pct(f)})` }
  return { symbol: '○', word: 'below the horizon' }
}

function BodyCard({ title, kind, body, next, labels }: { title: string; kind: 'sun' | 'earth'; body: BodyView; next: NowView['nextSun']; labels: [string, string] }) {
  const v = visibility(body.fraction)
  const rising = next ? next.kind === 'rise' : body.fraction <= 0
  return (
    <article className={`card card-${kind}`} aria-label={title}>
      <h3>
        <span aria-hidden="true">{v.symbol}</span> {title} <span className="card-lead">{v.word}</span>
      </h3>
      <dl>
        <div>
          <dt>Elevation</dt>
          <dd>{body.el.toFixed(2)}°</dd>
        </div>
        <div>
          <dt>Azimuth</dt>
          <dd>
            {body.az.toFixed(1)}° {compass(body.az)}
          </dd>
        </div>
        <div>
          <dt>{rising ? labels[1] : labels[0]}</dt>
          <dd title={next ? formatUtc(next.atMs) : undefined}>{next ? formatDuration(next.inMs) : '> 45 d'}</dd>
        </div>
      </dl>
    </article>
  )
}

export function NowCards({ view }: { view: NowView }) {
  const playing = useApp((s) => s.playing)
  return (
    <div className="cards" aria-live={playing ? 'off' : 'polite'}>
      <BodyCard title="Sun" kind="sun" body={view.sun} next={view.nextSun} labels={['Sunset in', 'Sunrise in']} />
      <BodyCard title="Earth" kind="earth" body={view.earth} next={view.nextEarth} labels={['Earthset in', 'Earthrise in']} />
      <p className="power-line">
        Sunlight on the panel <strong>{view.power.toFixed(0)} W/m²</strong> of {view.irradiance.toFixed(0)}
        {view.eclipse > 0 && <span> · Earth eclipse ({view.eclipse === 2 ? 'total' : 'partial'})</span>}
      </p>
    </div>
  )
}
