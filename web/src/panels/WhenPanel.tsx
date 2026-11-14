/**
 * Step 2, "Choose when": date and time (UTC, labelled), mission duration, and the parameters the engine
 * needs: mast height, panel orientation and the share of the Earth's disc that counts as "in contact".
 */
import { useId } from 'react'
import { MASTS_M, useApp } from '../state/store'
import type { PanelModel } from '../time/engine'
import { useEphemeris } from '../time/hooks'
import { isoMinute } from '../time/clock'

const toInput = (tMs: number) => isoMinute(tMs).slice(0, 16)
const fromInput = (v: string) => Date.parse(`${v}:00Z`)

export function WhenPanel() {
  const id = useId()
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const mastM = useApp((s) => s.mastM)
  const panel = useApp((s) => s.panel)
  const cmf = useApp((s) => s.commsMinFraction)
  const set = useApp((s) => s.set)
  const setStart = useApp((s) => s.setStart)
  const eph = useEphemeris().data
  const covered = !eph || eph.table.covers(startMs)
  const coverage = eph?.index.segments.map((s) => s.startUtc.slice(0, 4)).join(', ')

  return (
    <div className="panel-section when">
      <div className="field stack">
        <label htmlFor={`${id}-t`}>
          Start <abbr title="Coordinated Universal Time">UTC</abbr>
        </label>
        <input
          id={`${id}-t`}
          type="datetime-local"
          value={toInput(startMs)}
          min="1969-01-01T00:00"
          max="2035-12-31T23:00"
          step={60}
          onChange={(e) => {
            const t = fromInput(e.target.value)
            if (Number.isFinite(t)) setStart(t)
          }}
          aria-invalid={!covered}
          aria-describedby={covered ? undefined : `${id}-t-err`}
        />
        {!covered && (
          <p id={`${id}-t-err`} className="error" role="alert">
            Outside the tables ({coverage ?? '2025–2035, 1969–1972'}).
          </p>
        )}
      </div>
      <div className="row">
        <div className="field stack">
          <label htmlFor={`${id}-d`}>Days</label>
          <input
            id={`${id}-d`}
            type="number"
            min={1}
            max={365}
            step={1}
            value={Math.round(durationH / 24)}
            onChange={(e) => {
              const d = Number(e.target.value)
              if (d >= 1 && d <= 365) set({ durationH: d * 24 })
            }}
          />
        </div>
        <div className="field stack">
          <label htmlFor={`${id}-m`}>Mast</label>
          <select id={`${id}-m`} value={mastM} onChange={(e) => set({ mastM: Number(e.target.value) })}>
            {MASTS_M.map((m) => (
              <option key={m} value={m}>
                {m} m
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field stack">
          <label htmlFor={`${id}-p`}>Panel</label>
          <select id={`${id}-p`} value={panel} onChange={(e) => set({ panel: e.target.value as PanelModel })}>
            <option value="vertical">Vertical</option>
            <option value="tracking">Sun-tracking</option>
            <option value="horizontal">Flat</option>
          </select>
        </div>
        <div className="field stack">
          <label htmlFor={`${id}-c`}>Earth contact ≥ %</label>
          <input
            id={`${id}-c`}
            type="number"
            min={5}
            max={100}
            step={5}
            value={Math.round(cmf * 100)}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (v >= 5 && v <= 100) set({ commsMinFraction: v / 100 })
            }}
            title="Share of the Earth's disc above the horizon that counts as in contact"
          />
        </div>
      </div>
    </div>
  )
}
