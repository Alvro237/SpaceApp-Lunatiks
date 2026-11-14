/**
 * Sky above the chosen site, seen from above with north up: the real horizon (LOLA mask or smooth sphere) as the
 * ground ring, and the Sun and the Earth at their azimuth and elevation at the active instant. It follows playback.
 *
 * Polar sites see the Sun and the Earth within a few degrees of the horizon, so the radial scale is stretched near
 * it: the outer 60 % of the radius spans −5° to 15°, the inner 40 % spans 15° to the zenith. The rings say so.
 * Decorative shapes only; the accessible name states the same positions in words, and the panels hold the numbers.
 */
import { useMemo } from 'react'
import { useNow } from '../panels/useNow'

const R = 64
const C = 80
const EL_RIM = -5
const EL_MID = 15
const MID_R = R * 0.4

/** Radius in the dial for an elevation in degrees (0 at the zenith, R at −5°). */
function radius(el: number): number {
  const e = Math.max(EL_RIM, Math.min(90, el))
  if (e >= EL_MID) return (MID_R * (90 - e)) / (90 - EL_MID)
  return MID_R + ((R - MID_R) * (EL_MID - e)) / (EL_MID - EL_RIM)
}

function point(az: number, el: number): [number, number] {
  const r = radius(el)
  const a = (az * Math.PI) / 180
  return [C + r * Math.sin(a), C - r * Math.cos(a)]
}

const compass = (az: number) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(az / 45) % 8]
const state = (f: number) => (f >= 0.999 ? 'fully above the horizon' : f > 0 ? `partly above the horizon (${Math.round(f * 100)} %)` : 'below the horizon')

export function SkyDial() {
  const { view, info } = useNow()
  const ground = useMemo(() => {
    if (!info) return null
    const h = info.model.horizon
    const pts: string[] = []
    for (let az = 0; az < 360; az += 2) {
      const [x, y] = point(az, h.at(az))
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return pts.join(' ')
  }, [info])

  if (!view || !info || !ground) return null
  const sun = point(view.sun.az, view.sun.el)
  const earth = point(view.earth.az, view.earth.el)
  const label =
    `Sky above ${info.name}, north up. Sun ${compass(view.sun.az)} at ${view.sun.el.toFixed(1)}° elevation, ${state(view.sun.fraction)}. ` +
    `Earth ${compass(view.earth.az)} at ${view.earth.el.toFixed(1)}° elevation, ${state(view.earth.fraction)}.`

  return (
    <figure className="sky-dial">
      <figcaption>
        <span className="sky-dial-kicker">Sky above</span>
        <span className="sky-dial-name">{info.name}</span>
      </figcaption>
      <svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label={label}>
        <defs>
          <clipPath id="sky-dial-clip">
            <circle cx={C} cy={C} r={R} />
          </clipPath>
        </defs>
        <circle cx={C} cy={C} r={R} className="sd-sky" />
        {/* ground: everything between the rim and the horizon line */}
        <g clipPath="url(#sky-dial-clip)">
          <path d={`M${C - R - 2},${C} a${R + 2},${R + 2} 0 1,0 ${2 * (R + 2)},0 a${R + 2},${R + 2} 0 1,0 ${-2 * (R + 2)},0 Z M${ground.split(' ').join(' L')} Z`} className="sd-ground" fillRule="evenodd" />
        </g>
        <polygon points={ground} className="sd-horizon" />
        <circle cx={C} cy={C} r={radius(0)} className="sd-ring sd-ring-zero" />
        <circle cx={C} cy={C} r={radius(EL_MID)} className="sd-ring" />
        <text x={C + 3} y={C - radius(0) + 9} className="sd-ring-label">
          0°
        </text>
        <text x={C + 3} y={C - radius(EL_MID) + 9} className="sd-ring-label">
          15°
        </text>
        <circle cx={C} cy={C} r={1.5} className="sd-zenith" />
        {(
          [
            ['N', 0],
            ['E', 90],
            ['S', 180],
            ['W', 270],
          ] as const
        ).map(([t, az]) => {
          const a = (az * Math.PI) / 180
          return (
            <text key={t} x={C + (R + 9) * Math.sin(a)} y={C - (R + 9) * Math.cos(a) + 4} textAnchor="middle" className={`sd-cardinal${t === 'N' ? ' is-north' : ''}`}>
              {t}
            </text>
          )
        })}
        <g className={`sd-body sd-earth${view.earth.fraction <= 0 ? ' is-down' : ''}`} transform={`translate(${earth[0]},${earth[1]})`}>
          <circle r={6.5} />
          <path d="M-6.5,0 A6.5,6.5 0 0,0 6.5,0" className="sd-earth-shade" />
        </g>
        <g className={`sd-body sd-sun${view.sun.fraction <= 0 ? ' is-down' : ''}`} transform={`translate(${sun[0]},${sun[1]})`}>
          <circle r={5} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => (
            <line key={d} x1={0} y1={-7.5} x2={0} y2={-10} transform={`rotate(${d})`} />
          ))}
        </g>
      </svg>
      <ul className="sky-dial-legend" aria-hidden="true">
        <li className="is-sun">
          <span className="dot" /> Sun {view.sun.el.toFixed(1)}°
        </li>
        <li className="is-earth">
          <span className="dot" /> Earth {view.earth.el.toFixed(1)}°
        </li>
      </ul>
    </figure>
  )
}
