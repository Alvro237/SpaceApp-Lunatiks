/**
 * Step 2, "Choose when": date and time (UTC, labelled), mission duration, and the parameters the engine needs:
 * mast height, panel orientation and the share of the Earth's disc that counts as "in contact".
 *
 * Compact grouped lists in the style of iOS Settings: one row per setting with a coloured icon, the label on the
 * left and the control on the right (or underneath when it needs the width). Small choices are segmented radio
 * groups, the duration has a stepper, and each group ends with one short footnote that its controls point to.
 * Targets are at least 36 px high, labels are always visible, and nothing relies on colour.
 */
import { type ReactNode, useId } from 'react'
import { MASTS_M, useApp } from '../state/store'
import type { PanelModel } from '../time/engine'
import { useEphemeris } from '../time/hooks'
import { isoMinute } from '../time/clock'
import { IconAntenna, IconCalendar, IconClock, IconMast, IconPanel } from '../ui/icons'

const toInput = (tMs: number) => isoMinute(tMs).slice(0, 16)
const fromInput = (v: string) => Date.parse(`${v}:00Z`)

const PANELS: { id: PanelModel; label: string }[] = [
  { id: 'vertical', label: 'Vertical' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'horizontal', label: 'Flat' },
]

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
  const days = Math.round(durationH / 24)
  const setDays = (d: number) => {
    if (d >= 1 && d <= 365) set({ durationH: d * 24 })
  }

  return (
    <div className="panel-section when inputs">
      <h3 className="ios-header">When</h3>
      <div className="ios-list">
        <div className="ios-row stack">
          <div className="ios-row-top">
            <span className="ios-icon ios-icon-red">
              <IconCalendar size={16} />
            </span>
            <label htmlFor={`${id}-t`} className="ios-label">
              Start <abbr title="Coordinated Universal Time">UTC</abbr>
            </label>
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
            aria-describedby={`${id}-when-f${covered ? '' : ` ${id}-t-err`}`}
          />
        </div>
        <div className="ios-row">
          <span className="ios-icon ios-icon-orange">
            <IconClock size={16} />
          </span>
          <label htmlFor={`${id}-d`} className="ios-label">
            Duration
          </label>
          <div className="stepper">
            <button type="button" onClick={() => setDays(days - 1)} disabled={days <= 1} aria-label="One day less">
              −
            </button>
            <input
              id={`${id}-d`}
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              step={1}
              value={days}
              aria-describedby={`${id}-when-f`}
              onChange={(e) => setDays(Number(e.target.value))}
            />
            <span className="stepper-unit" aria-hidden="true">
              d
            </span>
            <button type="button" onClick={() => setDays(days + 1)} disabled={days >= 365} aria-label="One day more">
              +
            </button>
          </div>
        </div>
      </div>
      {!covered && (
        <p id={`${id}-t-err`} className="error" role="alert">
          Outside the tables ({coverage ?? '2025–2035, 1969–1972'}).
        </p>
      )}
      <p id={`${id}-when-f`} className="ios-footnote">
        Times in UTC. Duration in days (1–365). Tables cover 2025–2035 and 1969–1972.
      </p>

      <h3 className="ios-header">Equipment</h3>
      <div className="ios-list">
        <Segmented
          icon={<IconPanel size={16} />}
          tone="yellow"
          label="Panel"
          name={`${id}-panel`}
          describedBy={`${id}-eq-f`}
          options={PANELS.map((p) => ({ value: p.id, label: p.label }))}
          value={panel}
          onChange={(v) => set({ panel: v as PanelModel })}
          stacked
        />
        <Segmented
          icon={<IconMast size={16} />}
          tone="gray"
          label="Height"
          name={`${id}-mast`}
          describedBy={`${id}-eq-f`}
          options={MASTS_M.map((m) => ({ value: String(m), label: `${m} m` }))}
          value={String(mastM)}
          onChange={(v) => set({ mastM: Number(v) })}
          stacked
        />
        <div className="ios-row stack">
          <div className="ios-row-top">
            <span className="ios-icon ios-icon-blue">
              <IconAntenna size={16} />
            </span>
            <label htmlFor={`${id}-c`} className="ios-label">
              Earth contact from
            </label>
            <output htmlFor={`${id}-c`} className="ios-value">
              {Math.round(cmf * 100)} %
            </output>
          </div>
          <input
            id={`${id}-c`}
            className="ios-slider"
            type="range"
            min={5}
            max={100}
            step={5}
            value={Math.round(cmf * 100)}
            aria-valuetext={`${Math.round(cmf * 100)} percent of the Earth's disc`}
            aria-describedby={`${id}-eq-f`}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (v >= 5 && v <= 100) set({ commsMinFraction: v / 100 })
            }}
          />
        </div>
      </div>
      <p id={`${id}-eq-f`} className="ios-footnote">
        Panel: vertical turns towards the Sun, tracking faces it fully, flat lies on the ground. Height: of the panel and
        antenna above the ground. Earth contact: share of the Earth's disc above the horizon.
      </p>
    </div>
  )
}

/** A settings row with a segmented radio group (native radios, visible label as the group name). */
function Segmented({
  icon,
  tone,
  label,
  name,
  describedBy,
  options,
  value,
  onChange,
  stacked,
}: {
  icon: ReactNode
  tone: string
  label: string
  name: string
  describedBy: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  stacked?: boolean
}) {
  const labelId = `${name}-l`
  return (
    <div className={`ios-row${stacked ? ' stack' : ''}`}>
      <div className="ios-row-top">
        <span className={`ios-icon ios-icon-${tone}`}>{icon}</span>
        <span id={labelId} className="ios-label">
          {label}
        </span>
      </div>
      <div className="seg" role="radiogroup" aria-labelledby={labelId} aria-describedby={describedBy}>
        {options.map((o) => (
          <label key={o.value} className={`seg-item${value === o.value ? ' is-on' : ''}`}>
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
