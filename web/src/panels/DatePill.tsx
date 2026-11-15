/**
 * "Choose when", as a pill at the top left of the map: it shows the start (UTC) and the duration, and opens a small
 * panel to change them. The analysis window drives the timeline, the sections and the comparison.
 */
import { useId } from 'react'
import { useApp } from '../state/store'
import { isoMinute } from '../time/clock'
import { useEphemeris } from '../time/hooks'
import { IconCalendar, IconClock } from '../ui/icons'
import { Popover } from '../ui/Popover'
import { Tip } from '../ui/Tip'

const toInput = (tMs: number) => isoMinute(tMs).slice(0, 16)
const fromInput = (v: string) => Date.parse(`${v}:00Z`)
const PRESETS = [1, 7, 14, 30, 365] as const

export function DatePill() {
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const days = Math.round(durationH / 24)
  const shown = toInput(startMs).replace('T', ' ')
  return (
    <Popover
      label="Date and duration"
      buttonLabel={`Date and duration: ${shown} UTC · ${days} d`}
      buttonClass="tool-btn pill-btn"
      button={
        <>
          <IconCalendar size={17} />
          <span className="pill-text">
            {shown} <span className="pill-muted">UTC · {days} d</span>
          </span>
        </>
      }
    >
      <DateForm />
    </Popover>
  )
}

function DateForm() {
  const id = useId()
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const set = useApp((s) => s.set)
  const setStart = useApp((s) => s.setStart)
  const eph = useEphemeris().data
  const covered = !eph || eph.table.covers(startMs)
  const coverage = eph?.index.segments.map((s) => s.startUtc.slice(0, 4)).join(', ')
  const days = Math.round(durationH / 24)
  const setDays = (d: number) => {
    if (d >= 1 && d <= 365) set({ durationH: d * 24 })
  }
  return (
    <div className="date-form">
      <div className="ios-list">
        <div className="ios-row stack">
          <div className="ios-row-top">
            <span className="ios-icon ios-icon-red">
              <IconCalendar size={16} />
            </span>
            <label htmlFor={`${id}-t`} className="ios-label">
              Start <abbr title="Coordinated Universal Time">UTC</abbr>
            </label>
            <Tip label="start">The time on the Moon's clocks (UTC). The Sun and Earth tables cover 2025–2035 and 1969–1972.</Tip>
          </div>
          <input
            id={`${id}-t`}
            className="ios-input"
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
        </div>
        <div className="ios-row stack">
          <div className="ios-row-top">
            <span className="ios-icon ios-icon-orange">
              <IconClock size={16} />
            </span>
            <label htmlFor={`${id}-d`} className="ios-label">
              Duration
            </label>
            <Tip label="duration">How long the lander stays, in days (1 to 365). Everything in the timeline covers this window.</Tip>
            <div className="stepper">
              <button type="button" onClick={() => setDays(days - 1)} disabled={days <= 1} aria-label="One day less">
                −
              </button>
              <input id={`${id}-d`} type="number" inputMode="numeric" min={1} max={365} step={1} value={days} onChange={(e) => setDays(Number(e.target.value))} />
              <span className="stepper-unit" aria-hidden="true">
                d
              </span>
              <button type="button" onClick={() => setDays(days + 1)} disabled={days >= 365} aria-label="One day more">
                +
              </button>
            </div>
          </div>
          <div className="chips" role="group" aria-label="Quick durations">
            {PRESETS.map((d) => (
              <button key={d} type="button" className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>
                {d === 365 ? '1 year' : `${d} d`}
              </button>
            ))}
          </div>
        </div>
      </div>
      {!covered && (
        <p id={`${id}-t-err`} className="error" role="alert">
          Outside the tables ({coverage ?? '2025–2035, 1969–1972'}).
        </p>
      )}
    </div>
  )
}
