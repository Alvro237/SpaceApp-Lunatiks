/**
 * "Advanced inputs" disclosure (mission-planner-ui-spec.md section 3.3): the categories of section 4.2 as
 * headings, each (but "Search area") with its own on/off switch; data-gap rows are shown, disabled, with the
 * reason. "Priorities" closes the list (4.2): the active scored categories, reorderable, with their weights. The open/closed state of the disclosure and of each category lives in the mission store, so
 * it survives closing and reopening the panel.
 */
import { useEffect, useId, useState } from 'react'
import { api, isMissing } from '../api/client'
import type { FeatureMatch } from '../api/types'
import { PlannerLinkSettings } from '../panels/LinkPanel'
import { useAreas } from '../state/areas'
import { IconChevron } from '../ui/icons'
import { Tip } from '../ui/Tip'
import { BATTERY_PARAMS, CATEGORY_TITLE, PLANNER_CATEGORIES, type PlannerField, buildSuitability } from './plannerInputs'
import { moveItem, priorityOrder, rocWeights } from './score'

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
          disabled={disabled}
          placeholder="Inactive · type a value"
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
  // from an off category is left on screen (it also never reaches the request; see buildSuitability).
  if (disabled) return null
  // the detailed battery model replaces battery autonomy and recharge time: never both on screen, never both sent
  if (field.kind === 'number' && field.replacedByBatteryModel && a.plannerSwitches.battery_model) return null
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
  if (field.kind === 'battery-model') return <BatteryModelField field={field} nameId={nameId} />
  if (field.kind === 'feature') return <FeatureField field={field} />
  if (field.kind === 'link') return <LinkField field={field} />
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
      {a.advancedOpen && <Priorities />}
    </section>
  )
}

/** The radio link settings (AERO-2): which antennas count as contact. */
function LinkField({ field }: { field: PlannerField & { kind: 'link' } }) {
  return (
    <div className="ios-row stack planner-link-field">
      <div className="ios-row-top">
        <span className="ios-label">{field.label}</span>
        <Tip label={field.label.toLowerCase()}>{field.tip}</Tip>
      </div>
      <PlannerLinkSettings />
    </div>
  )
}

function BatteryModelField({ field, nameId }: { field: PlannerField & { kind: 'battery-model' }; nameId: string }) {
  const a = useAreas()
  const on = !!a.plannerSwitches.battery_model
  return (
    <div key={field.id}>
      <div className="ios-row">
        <span id={nameId} className="ios-label">
          {field.label}
        </span>
        <Tip label={field.label.toLowerCase()}>{field.tip}</Tip>
        <Switch on={on} onToggle={() => a.toggleSwitch('battery_model')} labelledBy={nameId} />
      </div>
      {on && (
        <div className="battery-params">
          <p className="fine">Replaces battery autonomy and recharge time. Every field is needed except the night load.</p>
          {BATTERY_PARAMS.map((p) => {
            const fid = `planner-battery-${p.key}`
            return (
              <div className="battery-param" key={p.key}>
                <label htmlFor={fid} className="ios-label">
                  {p.label}
                </label>
                <div className="unit-input">
                  <input
                    id={fid}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={p.required ? 'Needed' : 'Optional'}
                    value={a.plannerValues[`battery_model:${p.key}`] ?? ''}
                    onChange={(e) => a.setPlannerValue(`battery_model:${p.key}`, e.target.value)}
                  />
                  {p.unit && (
                    <span className="unit" aria-hidden="true">
                      {p.unit}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** "Near a named feature": a name searched in the IAU gazetteer (GET /api/v1/suitability/features, debounced) and a
 * distance. The request carries the exact name chosen. */
function FeatureField({ field }: { field: PlannerField & { kind: 'feature' } }) {
  const a = useAreas()
  const listId = useId()
  const name = a.plannerValues[`${field.id}:name`] ?? ''
  const [matches, setMatches] = useState<FeatureMatch[]>([])
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const text = name.trim()
    if (text.length < 2) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api
        .suitabilityFeatures(text, 8, controller.signal)
        .then((r) => {
          setMatches(r.features)
          setNote(null)
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return
          setMatches([])
          setNote(isMissing(e) ? 'The name search is not deployed on this API yet: type the exact IAU name.' : 'The name search did not answer: type the exact IAU name.')
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [name])

  // fewer than two letters: no search, and no list from an older search
  const shown = name.trim().length >= 2 ? matches : []
  const exact = shown.find((m) => m.name === name.trim())
  return (
    <div className="ios-row stack" key={field.id}>
      <div className="ios-row-top">
        <span className="ios-label">{field.label}</span>
        <Tip label={field.label.toLowerCase()}>{field.tip}</Tip>
      </div>
      <input
        aria-label={`${field.label}: feature name`}
        list={listId}
        autoComplete="off"
        placeholder="Feature name, e.g. Shackleton"
        value={name}
        onChange={(e) => a.setPlannerValue(`${field.id}:name`, e.target.value)}
      />
      <datalist id={listId}>
        {shown.map((m) => (
          <option key={m.name} value={m.name}>
            {m.type}
            {m.diameter_km != null ? `, ${m.diameter_km.toFixed(0)} km` : ''}
          </option>
        ))}
      </datalist>
      {exact && (
        <p className="fine">
          {exact.name}: {exact.type}
          {exact.diameter_km != null ? `, ${exact.diameter_km.toFixed(0)} km wide` : ''}, centre {Math.abs(exact.lat).toFixed(2)}° {exact.lat < 0 ? 'S' : 'N'},{' '}
          {Math.abs(exact.lon).toFixed(2)}° {exact.lon < 0 ? 'W' : 'E'}
        </p>
      )}
      {note && <p className="fine">{note}</p>}
      <div className="unit-input">
        <input
          aria-label={`${field.label}: distance`}
          inputMode="decimal"
          autoComplete="off"
          placeholder="Inactive · type a value"
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

/** "Priorities" (4.2, design spec 9.5): the active categories that have a score, most important first, with Move up
 * / Move down and their rank order centroid weights in percent. Reordering re-weights the map at once (no request). */
export function Priorities() {
  const a = useAreas()
  const headId = useId()
  const [announce, setAnnounce] = useState('')
  const built = buildSuitability(a.categoriesOn, a.sideOn, a.plannerSwitches, a.plannerSelects, a.plannerValues)
  const active = typeof built === 'string' ? (a.suit?.layers.map((l) => l.category) ?? []) : built.scored
  const order = priorityOrder(a.priority, active)
  const w = rocWeights(order.length)
  const move = (i: number, delta: number) => {
    const next = moveItem(order, i, delta)
    // keep the stored places of categories switched off now, after the visible ones
    a.setPriority([...next, ...a.priority.filter((c) => !next.includes(c))])
    const k = next.indexOf(order[i])
    setAnnounce(`${CATEGORY_TITLE[order[i]]} moved to position ${k + 1} of ${next.length}`)
  }
  return (
    <section aria-labelledby={headId} className="priorities">
      <h3 className="ios-header">
        <span id={headId}>Priorities</span>
        <Tip label="priorities">
          The categories that score the cells, most important first. Weights follow the order (rank order centroid: with two, 75 % and 25 %). Every
          input is still a hard limit; the order only ranks the cells that pass all of them.
        </Tip>
      </h3>
      {order.length === 0 ? (
        <p className="fine pad">Switch on Power, Earth contact, or set a slope, crater cover, science target or dose limit to score the cells.</p>
      ) : (
        <ol className="ios-list priority-list">
          {order.map((c, i) => (
            <li key={c} className="ios-row">
              <span className="ios-label">
                {i + 1}. {CATEGORY_TITLE[c] ?? c}
              </span>
              <span className="ios-value">{Math.round(w[i] * 100)} %</span>
              <button type="button" className="small" disabled={i === 0} aria-label={`Move up: ${CATEGORY_TITLE[c] ?? c}`} onClick={() => move(i, -1)}>
                Move up
              </button>
              <button
                type="button"
                className="small"
                disabled={i === order.length - 1}
                aria-label={`Move down: ${CATEGORY_TITLE[c] ?? c}`}
                onClick={() => move(i, 1)}
              >
                Move down
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </section>
  )
}
