/**
 * "Advanced inputs" disclosure (mission-planner-ui-spec.md section 3.3): the categories of section 4.2 as
 * headings, each (but "Search area") with its own on/off switch; Stage B and data-gap rows are shown, disabled,
 * with the reason. The open/closed state of the disclosure and of each category lives in the mission store, so
 * it survives closing and reopening the panel.
 */
import { useId } from 'react'
import { useAreas } from '../state/areas'
import { IconChevron } from '../ui/icons'
import { Tip } from '../ui/Tip'
import { PLANNER_CATEGORIES, STAGE_B_REASON, type PlannerField } from './plannerInputs'

function Switch({ on, onToggle, labelledBy }: { on: boolean; onToggle: () => void; labelledBy: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-labelledby={labelledBy} className="switch" onClick={onToggle}>
      <span className="switch-knob" aria-hidden="true" />
    </button>
  )
}

function NumberField({ field, disabled }: { field: PlannerField & { kind: 'number' }; disabled: boolean }) {
  const a = useAreas()
  const value = a.plannerValues[field.id] ?? ''
  const fieldId = `planner-${field.id}`
  return (
    <div className="ios-row stack" key={field.id}>
      <div className="ios-row-top">
        <label htmlFor={fieldId} className="ios-label">
          {field.label}
        </label>
        <Tip label={field.label.toLowerCase()}>{field.tip}</Tip>
      </div>
      <div className="unit-input">
        <input
          id={fieldId}
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          placeholder="Inactive · type a value"
          value={value}
          onChange={(e) => a.setPlannerValue(field.id, e.target.value)}
        />
        {field.unit && (
          <span className="unit" aria-hidden="true">
            {field.unit}
          </span>
        )}
      </div>
    </div>
  )
}

function RangeField({ field, disabled }: { field: PlannerField & { kind: 'range' }; disabled: boolean }) {
  const a = useAreas()
  return (
    <div className="ios-row stack" key={field.id}>
      <div className="ios-row-top">
        <span className="ios-label">{field.label}</span>
        <Tip label={field.label.toLowerCase()}>{field.tip}</Tip>
      </div>
      <div className="range-fields">
        {([
          ['lo', field.loLabel],
          ['hi', field.hiLabel],
        ] as const).map(([which, lbl]) => (
          <div className="range-end" key={which}>
            <span className="range-end-label" aria-hidden="true">
              {lbl}
            </span>
            <div className="unit-input">
              <input
                aria-label={`${field.label} (${lbl.toLowerCase()})`}
                inputMode="decimal"
                autoComplete="off"
                disabled={disabled}
                placeholder="Inactive"
                value={a.plannerValues[`${field.id}:${which}`] ?? ''}
                onChange={(e) => a.setPlannerValue(`${field.id}:${which}`, e.target.value)}
              />
              {field.unit && (
                <span className="unit" aria-hidden="true">
                  {field.unit}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PastLandingsField({ field, disabled }: { field: PlannerField & { kind: 'past-landings' }; disabled: boolean }) {
  const a = useAreas()
  const dir = a.plannerSelects.past_landings ?? 'away'
  return (
    <div className="ios-row stack" key={field.id}>
      <div className="ios-row-top">
        <span className="ios-label">{field.label}</span>
        <Tip label={field.label.toLowerCase()}>{field.tip}</Tip>
      </div>
      <div className="seg" role="radiogroup" aria-label="Past landings direction">
        {([
          ['away', 'Stay away from'],
          ['near', 'Go near'],
        ] as const).map(([v, lbl]) => (
          <label key={v} className={`seg-item${dir === v ? ' is-on' : ''}`}>
            <input type="radio" name="past-landings-dir" disabled={disabled} checked={dir === v} onChange={() => a.setSelect('past_landings', v)} />
            <span>{lbl}</span>
          </label>
        ))}
      </div>
      <div className="unit-input">
        <input
          aria-label={`${field.label} distance`}
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled || dir === 'near'}
          placeholder={dir === 'near' ? 'Comes with the suitability search' : 'Inactive · type a value'}
          value={a.plannerValues[`${field.id}:km`] ?? ''}
          onChange={(e) => a.setPlannerValue(`${field.id}:km`, e.target.value)}
        />
        <span className="unit" aria-hidden="true">
          km
        </span>
      </div>
    </div>
  )
}

function FieldRow({ field, disabled }: { field: PlannerField; disabled: boolean }) {
  const a = useAreas()
  const nameId = `planner-${field.id}-name`
  // Switching a category off hides every one of its rows, Stage B and data-gap ones included: nothing
  // from an off category is left on screen (it also never reaches the request; see buildPlannerFilters).
  if (disabled) return null
  if (field.kind === 'number') return <NumberField field={field} disabled={disabled} />
  if (field.kind === 'range') return <RangeField field={field} disabled={disabled} />
  if (field.kind === 'past-landings') return <PastLandingsField field={field} disabled={disabled} />
  if (field.kind === 'switch') {
    const on = !!a.plannerSwitches[field.id]
    return (
      <div className="ios-row" key={field.id}>
        <span id={nameId} className="ios-label">
          {field.label}
        </span>
        <Tip label={field.label.toLowerCase()}>{field.tip}</Tip>
        <Switch on={on && !disabled} onToggle={() => a.toggleSwitch(field.id)} labelledBy={nameId} />
      </div>
    )
  }
  if (field.kind === 'side') {
    const dir = a.plannerSelects.side_dir ?? 'near'
    return (
      <div key={field.id}>
        <div className="ios-row">
          <span id={nameId} className="ios-label">
            {field.label}
          </span>
          <Tip label={field.label.toLowerCase()}>{field.tip}</Tip>
          <Switch on={a.sideOn} onToggle={() => a.set({ sideOn: !a.sideOn })} labelledBy={nameId} />
        </div>
        {a.sideOn && (
          <div className="pfield">
            <div className="seg" role="radiogroup" aria-labelledby={nameId}>
              {([
                ['near', 'Near'],
                ['far', 'Far'],
              ] as const).map(([v, lbl]) => (
                <label key={v} className={`seg-item${dir === v ? ' is-on' : ''}`}>
                  <input type="radio" name="side-dir" checked={dir === v} onChange={() => a.setSelect('side_dir', v)} />
                  <span>{lbl}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }
  if (field.kind === 'sub-switch' || field.kind === 'stage-b') {
    // The reason goes on its own line below the label (as the "unavailable" rows do just below), not squeezed
    // into the same row: "Comes with the suitability search" is too long for a nowrap badge next to a long label.
    return (
      <div className="filter-row is-na" key={field.id}>
        <div className="ios-row">
          <span id={nameId} className="ios-label">
            {field.label}
          </span>
          <Tip label={field.label.toLowerCase()}>{field.tip}</Tip>
          <span className="na-tag">Stage B</span>
        </div>
        <p className="fine na-why">{STAGE_B_REASON}</p>
      </div>
    )
  }
  // unavailable (data gap)
  return (
    <div className="filter-row is-na" key={field.id}>
      <div className="ios-row">
        <span id={nameId} className="ios-label">
          {field.label}
        </span>
        <span className="na-tag">Not in the search</span>
      </div>
      <p className="fine na-why">{field.reason}</p>
    </div>
  )
}

export function AdvancedInputs() {
  const id = useId()
  const a = useAreas()
  return (
    <section className="advanced-inputs">
      <button type="button" className="disclosure" aria-expanded={a.advancedOpen} onClick={() => a.set({ advancedOpen: !a.advancedOpen })}>
        <span className={`disclosure-chevron${a.advancedOpen ? ' is-open' : ''}`} aria-hidden="true">
          <IconChevron size={16} />
        </span>
        Advanced inputs
      </button>
      {a.advancedOpen &&
        PLANNER_CATEGORIES.map((cat) => {
          const headId = `${id}-${cat.id}`
          const on = cat.hasSwitch ? !!a.categoriesOn[cat.id] : true
          return (
            <section key={cat.id} aria-labelledby={headId}>
              <h3 className="ios-header">
                <span id={headId}>{cat.title}</span>
                {cat.hasSwitch && <Switch on={on} onToggle={() => a.toggleCategory(cat.id)} labelledBy={headId} />}
              </h3>
              <div className="ios-list filter-list">
                {cat.fields.map((f) => (
                  <FieldRow key={f.id} field={f} disabled={!on} />
                ))}
              </div>
            </section>
          )
        })}
    </section>
  )
}
