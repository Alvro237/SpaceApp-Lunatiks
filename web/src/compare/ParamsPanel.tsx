/**
 * Power parameters of the comparison (POST /api/v1/power), applied to every place picked with Multiselect at once so
 * the places are compared under the same assumptions. The inputs are the same ones as in the Power section (same
 * store): what is typed in one is in the other. No panel, battery, load or habitat value has a cited default, so none
 * is pre-filled; the example button fills the guide's test values and says so. Typing changes the form only: "Apply"
 * asks the API, once per place, and the answers appear in the results table. The radio link has its own "Link
 * settings" in the comparison.
 */
import { type ReactNode, useId, useState } from 'react'
import { buildPowerRequest } from '../panels/powerRequest'
import { ARRAY, BATTERY, COLONY_LOADS, EXAMPLE, EXAMPLE_COLONY, type FieldSpec, HABITAT, LOAD } from '../panels/powerSpecs'
import { PanelSetting } from '../panels/Settings'
import { type PowerModel, usePowerStore } from '../state/power'
import { useApp } from '../state/store'
import { IconBattery, IconBolt, IconHabitat, IconPanel, IconSliders } from '../ui/icons'
import { Tip } from '../ui/Tip'
import { useApplied } from './applied'

const MODELS: { id: PowerModel; title: string; icon: (s: number) => ReactNode }[] = [
  { id: 'array', title: 'Solar array', icon: (s) => <IconPanel size={s} /> },
  { id: 'battery', title: 'Battery', icon: (s) => <IconBattery size={s} /> },
  { id: 'colony', title: 'Colony', icon: (s) => <IconHabitat size={s} /> },
]

export function ParamsPanel() {
  const id = useId()
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const mastM = useApp((s) => s.mastM)
  const panel = useApp((s) => s.panel)
  const power = usePowerStore()
  const applied = useApplied()
  const [error, setError] = useState<string | null>(null)

  const apply = () => {
    // validate once without a place: the checks do not depend on it, so a missing value is reported here
    // instead of as an error under every place
    const snapshot = { model: power.model, fields: { ...power.fields }, commsCritical: power.comms_critical, includeSizing: power.include_sizing }
    try {
      buildPowerRequest({ ...snapshot, panel, startMs, durationH, mastM }, null)
    } catch (e) {
      setError((e as Error).message)
      return
    }
    setError(null)
    applied.apply(snapshot)
  }

  const field = (s: FieldSpec, value: string, onChange: (v: string) => void) => (
    <div className="pfield" key={s.key}>
      <div className="pfield-top">
        <label htmlFor={`${id}-${s.key}`}>
          {s.label}
          {s.optional && <span className="opt"> (optional)</span>}
        </label>
        <Tip label={s.label.toLowerCase()}>
          {s.hint} Unit: {s.unit}.
        </Tip>
      </div>
      <div className="unit-input">
        <input id={`${id}-${s.key}`} inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
        <span className="unit" aria-hidden="true">
          {s.unit}
        </span>
      </div>
    </div>
  )
  const pf = (s: FieldSpec) => field(s, power.fields[s.key] ?? '', (v) => power.setFields({ ...power.fields, [s.key]: v }))

  const group = (key: string, title: string, icon: ReactNode, tone: string, filled: string, body: ReactNode, open = false) => (
    <details key={key} className="opt-panel" open={open || undefined}>
      <summary>
        <span className={`ios-icon ios-icon-${tone}`}>{icon}</span>
        <span className="opt-title">{title}</span>
        <span className="opt-count">{filled}</span>
      </summary>
      <div className="opt-body">{body}</div>
    </details>
  )
  const count = (specs: FieldSpec[]) => `${specs.filter((s) => (power.fields[s.key] ?? '').trim()).length}/${specs.length}`

  return (
    <details className="cmp-params opt-panel">
      <summary>
        <span className="ios-icon ios-icon-orange">
          <IconSliders size={16} />
        </span>
        <span className="opt-title">Power parameters</span>
        <span className="opt-count">{applied.power ? 'applied' : 'not applied'}</span>
      </summary>
      <div className="opt-body">
        <>
            <div className="ios-list setting">
              <div className="ios-row stack">
                <div className="ios-row-top">
                  <span className="ios-icon ios-icon-orange">
                    <IconBolt size={16} />
                  </span>
                  <span id={`${id}-model-l`} className="ios-label">
                    Model
                  </span>
                  <Tip label="the model">
                    Solar array: watts and energy from a panel you size. Battery: the array feeding a battery and a load. Colony: a heated habitat that survives
                    on its own or not (needs 30 days or more).
                  </Tip>
                </div>
                <div className="seg seg-icons" role="radiogroup" aria-labelledby={`${id}-model-l`}>
                  {MODELS.map((mo) => (
                    <label key={mo.id} className={`seg-item${power.model === mo.id ? ' is-on' : ''}`}>
                      <input type="radio" name={`${id}-model`} checked={power.model === mo.id} onChange={() => power.setModel(mo.id)} />
                      <span className="seg-ico">{mo.icon(15)}</span>
                      <span>{mo.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <PanelSetting />
            {group('array', 'Solar array', <IconPanel size={16} />, 'yellow', count(ARRAY), ARRAY.map(pf), true)}
            {power.model !== 'array' && group('battery', 'Battery', <IconBattery size={16} />, 'green', count(BATTERY), BATTERY.map(pf))}
            {power.model === 'battery' && group('load', 'Load', <IconBolt size={16} />, 'orange', count(LOAD), LOAD.map(pf))}
            {power.model === 'colony' && (
              <>
                {group(
                  'loads',
                  'Loads',
                  <IconBolt size={16} />,
                  'orange',
                  count(COLONY_LOADS),
                  <>
                    {COLONY_LOADS.map(pf)}
                    <label className="check-row">
                      <input type="checkbox" checked={power.comms_critical} onChange={(e) => power.setFlag('comms_critical', e.target.checked)} />
                      <span>Comms are essential</span>
                    </label>
                  </>,
                )}
                {group('habitat', 'Habitat', <IconHabitat size={16} />, 'blue', count(HABITAT), HABITAT.map(pf))}
                <label className="check-row">
                  <input type="checkbox" checked={power.include_sizing} onChange={(e) => power.setFlag('include_sizing', e.target.checked)} />
                  <span>Find the size needed</span>
                  <Tip label="sizing">Also searches the smallest battery and panels that survive on their own. Adds about a second per place.</Tip>
                </label>
              </>
            )}
            <button
              type="button"
              className="link"
              onClick={() => power.setFields({ ...(power.model === 'colony' ? EXAMPLE_COLONY : EXAMPLE), night_load_w: power.fields.night_load_w }, true)}
            >
              Fill example values
            </button>
            {power.usedExample && <span className="fine"> Example values, not recommendations.</span>}
        </>

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="opt-actions">
          <button type="button" className="primary" onClick={apply}>
            Apply to all places
          </button>
          {applied.power && (
            <button type="button" className="link" onClick={() => applied.apply(null)}>
              Clear results
            </button>
          )}
        </div>
      </div>
    </details>
  )
}
