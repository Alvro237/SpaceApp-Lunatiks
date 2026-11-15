/**
 * "Mission basics" (mission-planner-ui-spec.md section 3.2): always visible at the top of the planner panel.
 * The landing date and duration are the date pill itself, shown above the scrolling body (PlannerPanel).
 */
import { useId } from 'react'
import { useCatalogue } from '../panels/useCatalogue'
import { useAreas } from '../state/areas'
import { IconCrosshair } from '../ui/icons'
import { Tip } from '../ui/Tip'
import { CELL_OPTIONS_KM, autoCellKm, cellTooMany, cellsSide, dataResolutionKm, maxRadiusForCell } from './plannerInputs'


function cellLabel(c: number): string {
  return c >= 1 ? `${c} km` : `${Math.round(c * 1000)} m`
}

export function PlannerBasics() {
  const id = useId()
  const a = useAreas()
  const { sites } = useCatalogue()
  const southSites = sites.filter((s) => s.lat <= -60)
  const cellKm = a.cellMode === 'auto' ? autoCellKm(a.radiusKm) : a.cellMode
  const nSide = cellsSide(a.radiusKm, cellKm)
  const maxRadius = maxRadiusForCell(cellKm)
  const resAtCentre = a.center ? dataResolutionKm(a.center.lat) : 0.96

  return (
    <div className="ios-list planner-basics">
      <div className="ios-row stack">
        <div className="ios-row-top">
          <span className="ios-label">Region centre</span>
          <Tip label="region centre">
            Centre of the area to search. Pick it on the Moon, type it, or choose a catalogue site. The search grids cover the south polar region (south of 60°
            S).
          </Tip>
        </div>
        <div className="region-row">
          <div className="unit-input">
            <input
              aria-label="Region centre latitude"
              inputMode="decimal"
              placeholder="Latitude"
              value={a.center ? a.center.lat : ''}
              onChange={(e) => {
                const lat = Number(e.target.value.replace(',', '.'))
                if (!Number.isFinite(lat)) return
                if (lat > -60) return
                a.set({ center: { lat, lon: a.center?.lon ?? 0 } })
              }}
            />
            <span className="unit" aria-hidden="true">
              °
            </span>
          </div>
          <div className="unit-input">
            <input
              aria-label="Region centre longitude"
              inputMode="decimal"
              placeholder="Longitude"
              value={a.center ? a.center.lon : ''}
              onChange={(e) => {
                const lon = Number(e.target.value.replace(',', '.'))
                if (!Number.isFinite(lon)) return
                a.set({ center: { lat: a.center?.lat ?? -85, lon } })
              }}
            />
            <span className="unit" aria-hidden="true">
              °
            </span>
          </div>
          <button type="button" className="small" aria-pressed={a.pickArmed} aria-label="Pick on the Moon" title="Pick on the Moon" onClick={() => a.set({ pickArmed: !a.pickArmed })}>
            <IconCrosshair size={15} />
          </button>
        </div>
        {a.center && a.center.lat > -60 && <p role="alert" className="error">The search covers south of 60° S</p>}
        <label className="ios-row-top">
          <span className="ios-label">Catalogue site</span>
          <select
            aria-label="Catalogue site"
            value=""
            onChange={(e) => {
              const s = southSites.find((x) => x.id === e.target.value)
              if (s) a.set({ center: { lat: s.lat, lon: s.lon } })
            }}
          >
            <option value="">Choose…</option>
            {southSites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ios-row stack">
        <div className="ios-row-top">
          <label htmlFor={`${id}-radius`} className="ios-label">
            Region radius
          </label>
          <output htmlFor={`${id}-radius`} className="ios-value">
            {a.radiusKm} km
          </output>
          <Tip label="region radius">Size of the area searched around the centre. Larger areas take longer.</Tip>
        </div>
        <input
          id={`${id}-radius`}
          className="ios-slider"
          type="range"
          min={5}
          max={maxRadius}
          step={5}
          value={Math.min(a.radiusKm, maxRadius)}
          onChange={(e) => a.set({ radiusKm: Number(e.target.value) })}
          aria-valuetext={`${a.radiusKm} kilometres`}
        />
      </div>
      <div className="ios-row stack">
        <div className="ios-row-top">
          <span id={`${id}-cell-l`} className="ios-label">
            Cell size
          </span>
          <Tip label="cell size">
            Size of each square of the coloured map. Smaller cells show more detail but take longer. Auto picks the smallest size that keeps the map under
            40 000 cells ({nSide.toLocaleString('en')} × {nSide.toLocaleString('en')} now). Below the data's own resolution ({Math.round(resAtCentre * 1000)}{' '}
            m here) smaller cells add no information.
          </Tip>
        </div>
        <select aria-labelledby={`${id}-cell-l`} value={a.cellMode === 'auto' ? 'auto' : String(a.cellMode)} onChange={(e) => a.set({ cellMode: e.target.value === 'auto' ? 'auto' : Number(e.target.value) })}>
          <option value="auto">Auto ({cellLabel(autoCellKm(a.radiusKm))})</option>
          {CELL_OPTIONS_KM.map((c) => {
            const tooMany = cellTooMany(a.radiusKm, c)
            const fine = c < resAtCentre
            return (
              <option key={c} value={c} disabled={tooMany}>
                {cellLabel(c)}
                {fine ? ' (finer than the data here)' : ''}
                {tooMany ? ' — too many cells for this radius' : ''}
              </option>
            )
          })}
        </select>
      </div>
    </div>
  )
}
