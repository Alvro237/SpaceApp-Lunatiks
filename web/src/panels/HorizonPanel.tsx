/**
 * The Horizon section, kept narrow: the map gives way to the first-person horizon view (horizon/HorizonView), and
 * this panel only steers it. Height of the camera (the horizon mask's mast), the camera mode (free look, follow
 * the Sun, follow the Earth), the positions as numbers, and the horizon itself as a table (the text equivalent of
 * the view).
 */
import { type ReactNode, useId } from 'react'
import { DataTable } from '../charts/DataTable'
import { useEffectiveCamera } from '../horizon/useEffectiveCamera'
import { compass16 } from '../horizon/project'
import { type CameraMode, useHorizonCam } from '../state/horizon'
import { IconCrosshair, IconGlobe, IconSun } from '../ui/icons'
import { Tip } from '../ui/Tip'
import { HeightSetting } from './Settings'
import { useNow } from './useNow'

const MODES: { id: CameraMode; label: string; icon: ReactNode }[] = [
  { id: 'free', label: 'Free', icon: <IconCrosshair size={15} /> },
  { id: 'sun', label: 'Sun', icon: <IconSun size={15} /> },
  { id: 'earth', label: 'Earth', icon: <IconGlobe size={15} /> },
]

const vis = (f: number) => (f >= 0.999 ? 'visible' : f > 0 ? `${Math.round(f * 100)} % visible` : 'hidden')

export function HorizonPanel() {
  const id = useId()
  const { view, info } = useNow()
  const mode = useHorizonCam((s) => s.mode)
  const setMode = useHorizonCam((s) => s.setMode)
  const cam = useEffectiveCamera()

  return (
    <div className="panel-section horizon-panel">
      <HeightSetting />
      <div className="ios-list setting">
        <div className="ios-row stack">
          <div className="ios-row-top">
            <span className="ios-icon ios-icon-gray">
              <IconCrosshair size={16} />
            </span>
            <span id={`${id}-cam`} className="ios-label">
              Camera
            </span>
            <Tip label="the camera">
              The view stands on the place and looks at its real horizon. Free: drag or use the arrow keys. Sun or Earth: the view turns to keep it in the centre while
              time plays. S, E and F switch from the keyboard; Escape goes back to the map.
            </Tip>
          </div>
          <div className="seg seg-icons" role="radiogroup" aria-labelledby={`${id}-cam`}>
            {MODES.map((m) => (
              <label key={m.id} className={`seg-item${mode === m.id ? ' is-on' : ''}`}>
                <input type="radio" name={`${id}-mode`} checked={mode === m.id} onChange={() => setMode(m.id)} />
                <span className="seg-ico">{m.icon}</span>
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {view && (
        <dl className="hz-readout" aria-live="off">
          <div className="hz-sun">
            <dt>Sun</dt>
            <dd>
              {view.sun.az.toFixed(0)}° {compass16(view.sun.az)} · {view.sun.el.toFixed(1)}° <span className="hz-state">{vis(view.sun.fraction)}</span>
            </dd>
          </div>
          <div className="hz-earth">
            <dt>Earth</dt>
            <dd>
              {view.earth.az.toFixed(0)}° {compass16(view.earth.az)} · {view.earth.el.toFixed(1)}° <span className="hz-state">{vis(view.earth.fraction)}</span>
            </dd>
          </div>
          <div>
            <dt>Facing</dt>
            <dd>
              {cam.yaw.toFixed(0)}° {compass16(cam.yaw)} · field {cam.fov.toFixed(0)}°
            </dd>
          </div>
        </dl>
      )}

      {info && (
        <DataTable
          summary="Horizon table"
          caption={`Horizon elevation around ${info.name}, every 15° of azimuth (${info.model.horizon.kind === 'terrain' ? 'LOLA terrain mask' : 'smooth sphere'})`}
          head={['Azimuth', 'Direction', 'Horizon']}
          rows={Array.from({ length: 24 }, (_, i) => i * 15).map((az) => [`${az}°`, compass16(az), `${info.model.horizon.at(az).toFixed(2)}°`])}
        />
      )}
    </div>
  )
}
