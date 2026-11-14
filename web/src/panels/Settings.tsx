/**
 * The engine parameters, each in the section it changes: panel orientation in Power, mounting height in Horizon,
 * the Earth-contact threshold in Earth link. One settings row each (iOS style), the explanation behind ⓘ.
 */
import { type ReactNode, useId } from 'react'
import { MASTS_M, useApp } from '../state/store'
import type { PanelModel } from '../time/engine'
import { IconAntenna, IconMast, IconPanel } from '../ui/icons'
import { Tip } from '../ui/Tip'

const PANELS: { id: PanelModel; label: string }[] = [
  { id: 'vertical', label: 'Vertical' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'horizontal', label: 'Flat' },
]

export function PanelSetting() {
  const panel = useApp((s) => s.panel)
  const set = useApp((s) => s.set)
  return (
    <div className="ios-list setting">
      <Segmented
        icon={<IconPanel size={16} />}
        tone="yellow"
        label="Panel"
        tip="Vertical stands upright and turns towards the Sun. Tracking tilts to face the Sun fully. Flat lies on the ground."
        options={PANELS.map((p) => ({ value: p.id, label: p.label }))}
        value={panel}
        onChange={(v) => set({ panel: v as PanelModel })}
      />
    </div>
  )
}

export function HeightSetting() {
  const mastM = useApp((s) => s.mastM)
  const set = useApp((s) => s.set)
  return (
    <div className="ios-list setting">
      <Segmented
        icon={<IconMast size={16} />}
        tone="gray"
        label="Height"
        tip="Height of the panel and antenna above the ground. Higher sees over nearby terrain. It changes the horizon for the Sun and the Earth."
        options={MASTS_M.map((m) => ({ value: String(m), label: `${m} m` }))}
        value={String(mastM)}
        onChange={(v) => set({ mastM: Number(v) })}
      />
    </div>
  )
}

export function ContactSetting() {
  const id = useId()
  const cmf = useApp((s) => s.commsMinFraction)
  const set = useApp((s) => s.set)
  return (
    <div className="ios-list setting">
      <div className="ios-row stack">
        <div className="ios-row-top">
          <span className="ios-icon ios-icon-blue">
            <IconAntenna size={16} />
          </span>
          <label htmlFor={`${id}-c`} className="ios-label">
            Earth contact
          </label>
          <Tip label="Earth contact">Share of the Earth's disc that must be above the horizon for the place to count as in contact.</Tip>
          <output htmlFor={`${id}-c`} className="ios-value">
            ≥ {Math.round(cmf * 100)} %
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
          aria-valuetext={`at least ${Math.round(cmf * 100)} percent of the Earth's disc`}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (v >= 5 && v <= 100) set({ commsMinFraction: v / 100 })
          }}
        />
      </div>
    </div>
  )
}

/** A settings row with a segmented radio group (native radios, the visible label names the group). */
function Segmented({
  icon,
  tone,
  label,
  tip,
  options,
  value,
  onChange,
}: {
  icon: ReactNode
  tone: string
  label: string
  tip: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <div className="ios-row stack">
      <div className="ios-row-top">
        <span className={`ios-icon ios-icon-${tone}`}>{icon}</span>
        <span id={`${id}-l`} className="ios-label">
          {label}
        </span>
        <Tip label={label.toLowerCase()}>{tip}</Tip>
      </div>
      <div className="seg" role="radiogroup" aria-labelledby={`${id}-l`}>
        {options.map((o) => (
          <label key={o.value} className={`seg-item${value === o.value ? ' is-on' : ''}`}>
            <input type="radio" name={`${id}-r`} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
