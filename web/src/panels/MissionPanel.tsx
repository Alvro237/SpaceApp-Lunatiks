/**
 * Mission mode: find the areas of a bounded region where every filter switched on passes, and paint them on the
 * map (POST /api/v1/areas/search). Instead of testing points one by one, the API runs a funnel over a raster:
 * map filters on every cell, the landing radius, then the mission-window filters on adaptive samples, each with
 * its own ray-traced horizon. The answer comes back as cells (painted on the terrain) and as the connected areas
 * (listed here with Show and Study), so the map is never the only way to read it.
 *
 * Laid out as grouped lists (iOS style) in the tool bar's flyout: region first, then the filters by family
 * (A search area … I science), each a row with an icon, its name, an ⓘ and a switch that reveals its numbers.
 * Filters the data cannot answer are listed with the reason. No threshold is pre-filled (CLAUDE.md).
 */
import { type FormEvent, type ReactNode, useId, useState } from 'react'
import { useAreaSearch } from '../api/hooks'
import type { AreaSearchRequest, AreaSearchResponse } from '../api/types'
import { useAreas } from '../state/areas'
import { useApp } from '../state/store'
import { isoMinute } from '../time/clock'
import { ApiStatus } from '../ui/ApiStatus'
import {
  IconAntenna,
  IconBolt,
  IconCalendar,
  IconClock,
  IconCrater,
  IconCrosshair,
  IconHabitat,
  IconMountain,
  IconPin,
  IconRadiation,
  IconRock,
  IconSearch,
  IconSliders,
  IconSun,
  IconThermo,
} from '../ui/icons'
import { Tip } from '../ui/Tip'
import { EXAMPLE_MISSION, FUNNEL_LABEL, MISSION_GROUPS, type MissionField, type MissionFilter, type MissionIcon, buildFilters } from './missionFilters'
import { useCatalogue } from './useCatalogue'

const ICONS: Record<MissionIcon, ReactNode> = {
  pin: <IconPin size={16} />,
  slope: <IconMountain size={16} />,
  mountain: <IconMountain size={16} />,
  crater: <IconCrater size={16} />,
  rock: <IconRock size={16} />,
  sun: <IconSun size={16} />,
  bolt: <IconBolt size={16} />,
  clock: <IconClock size={16} />,
  earth: <IconAntenna size={16} />,
  thermo: <IconThermo size={16} />,
  radiation: <IconRadiation size={16} />,
  calendar: <IconCalendar size={16} />,
  habitat: <IconHabitat size={16} />,
  science: <IconCrosshair size={16} />,
}
const TONE: Record<MissionIcon, string> = {
  pin: 'gray',
  slope: 'gray',
  mountain: 'gray',
  crater: 'gray',
  rock: 'gray',
  sun: 'orange',
  bolt: 'yellow',
  clock: 'blue',
  earth: 'blue',
  thermo: 'red',
  radiation: 'purple',
  calendar: 'blue',
  habitat: 'green',
  science: 'purple',
}
const CELLS = [0.24, 0.48, 0.96, 1.92] as const
const MAX_CELLS = 360_000
const AZ_STEPS = [0.25, 0.5, 1] as const

const fmtKm2 = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))
const coord = (lat: number, lon: number) => `${Math.abs(lat).toFixed(3)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}° ${lon < 0 ? 'W' : 'E'}`

export function MissionPanel() {
  const id = useId()
  const a = useAreas()
  const { startMs, durationH, mastM, panel, commsMinFraction, selection, set: setApp } = useApp()
  const { sites } = useCatalogue()
  const search = useAreaSearch()
  const [error, setError] = useState<string | null>(null)
  const [example, setExample] = useState(false)

  /** Fill the region, the window length and four filters with the example mission (replacing what was typed). */
  const loadExample = () => {
    const ex = EXAMPLE_MISSION
    a.set({
      center: ex.center,
      radiusKm: ex.radiusKm,
      cellKm: ex.cellKm,
      landingRadiusKm: ex.landingRadiusKm,
      enabled: Object.fromEntries(Object.keys(ex.filters).map((k) => [k, true])),
      values: ex.filters,
    })
    a.setResult(null)
    a.look(ex.center.lat, ex.center.lon, ex.radiusKm * 2.5)
    setApp({ durationH: ex.durationH })
    setError(null)
    setExample(true)
  }

  const picked = !selection
    ? null
    : selection.kind === 'point'
      ? { lat: selection.lat, lon: selection.lon, name: coord(selection.lat, selection.lon) }
      : (() => {
          const s = sites.find((x) => x.id === selection.id)
          return s ? { lat: s.lat, lon: s.lon, name: s.name } : null
        })()
  const cellsSide = Math.ceil((2 * a.radiusKm) / a.cellKm)
  const tooMany = cellsSide * cellsSide > MAX_CELLS
  const maxRadius = Math.min(400, Math.floor((Math.sqrt(MAX_CELLS) * a.cellKm) / 2))
  const onCount = MISSION_GROUPS.flatMap((g) => g.filters).filter((f) => a.enabled[f.id] && !f.unavailable).length

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!a.center) return setError('Place the search region first: activate a point on the map, or use the selected place.')
    if (a.center.lat > -60) return setError('The area search covers the south polar grids: put the centre south of 60° S.')
    const built = buildFilters(a.enabled, a.values)
    if (typeof built === 'string') return setError(built)
    if (Object.keys(built.filters).length === 0) return setError('Switch on at least one filter and type its values.')
    let landing: number | undefined
    if (a.landingRadiusKm.trim()) {
      landing = Number(a.landingRadiusKm.replace(',', '.'))
      if (!Number.isFinite(landing) || landing <= 0 || landing > 20) return setError('Landing radius must be between 0 and 20 km.')
    }
    if (tooMany) return setError(`That is ${(cellsSide * cellsSide).toLocaleString('en')} cells: make the cells larger or the region smaller.`)
    setError(null)
    const body: AreaSearchRequest = {
      region: { center_lat: a.center.lat, center_lon: a.center.lon, radius_km: a.radiusKm },
      filters: built.filters,
      cell_km: a.cellKm,
      ...(landing != null ? { landing_radius_km: landing } : {}),
      start: isoMinute(startMs),
      duration_h: durationH,
      mast_m: mastM,
      panel,
      comms_min_fraction: commsMinFraction,
      horizon_az_step_deg: a.azStepDeg,
      horizon_radius_km: a.horizonKm,
      max_window_samples: a.samples,
      unknown_passes: a.unknownPasses,
    }
    const center = a.center
    const radius = a.radiusKm
    search.mutate(body, {
      onSuccess: (r) => {
        a.setResult(r)
        setApp({ scale: 'map' }) // the areas are painted on the polar map, not on the globe
        a.look(center.lat, center.lon, Math.max(20, radius * 3.2))
      },
    })
  }

  const field = (f: MissionFilter, fd: MissionField, nameId: string) => {
    const fieldId = `${id}-${f.id}-${fd.key}`
    const value = a.values[f.id]?.[fd.key] ?? ''
    if (fd.kind === 'select') {
      return (
        <div className="pfield" key={fd.key}>
          <div className="seg" role="radiogroup" aria-labelledby={nameId}>
            {fd.options!.map((o) => (
              <label key={o.value} className={`seg-item${value === o.value ? ' is-on' : ''}`}>
                <input type="radio" name={fieldId} checked={value === o.value} onChange={() => a.setValue(f.id, fd.key, o.value)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </div>
      )
    }
    return (
      <div className="pfield" key={fd.key}>
        <div className="pfield-top">
          <label id={`${fieldId}-l`} htmlFor={fieldId}>
            {fd.label}
            {fd.optional && <span className="opt"> (optional)</span>}
          </label>
          {fd.hint && <Tip label={fd.label.toLowerCase()}>{fd.hint}</Tip>}
        </div>
        <div className="unit-input">
          <input
            id={fieldId}
            aria-labelledby={`${nameId} ${fieldId}-l`}
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(e) => a.setValue(f.id, fd.key, e.target.value)}
          />
          {fd.unit && (
            <span className="unit" aria-hidden="true">
              {fd.unit}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="panel-section mission">
      <form onSubmit={submit} noValidate className="mission-form">
        <div className="example-row">
          <button type="button" className="small" onClick={loadExample}>
            <IconSliders size={15} /> Load example mission
          </button>
          <Tip label="the example mission">
            {EXAMPLE_MISSION.name}: a 20 km region near the connecting ridge, a 7-day window, slope at most 10°, lit at least 60 % of the window,
            darkness at most 48 h and Earth contact at least 50 %. Example values to try the search, not mission requirements.
          </Tip>
        </div>
        {example && (
          <p className="note" role="status">
            Example mission loaded. The values are for trying the search, not requirements: change any of them, then search.
          </p>
        )}
        <h3 className="ios-header">
          Region
          <Tip label="the region">
            A disc around a centre you choose: activate a point on the map, or use the selected place. Only this disc is searched, so the
            answer comes in seconds.
          </Tip>
        </h3>
        <div className="ios-list">
          <div className="ios-row">
            <span className="ios-icon ios-icon-gray">
              <IconPin size={16} />
            </span>
            <span className="ios-label">{a.center ? coord(a.center.lat, a.center.lon) : 'No centre yet: activate a point on the map'}</span>
          </div>
          {picked && (
            <div className="ios-row">
              <button type="button" className="link" onClick={() => a.set({ center: { lat: picked.lat, lon: picked.lon } })}>
                Centre on {picked.name}
              </button>
            </div>
          )}
          <div className="ios-row stack">
            <div className="ios-row-top">
              <label htmlFor={`${id}-radius`} className="ios-label">
                Radius
              </label>
              <output htmlFor={`${id}-radius`} className="ios-value">
                {a.radiusKm} km
              </output>
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
                Resolution of the painted map. Each cell reads every grid pixel inside it (slope 320 m, heights 240 m south of 80° S). Now
                about {(cellsSide * cellsSide).toLocaleString('en')} cells.
              </Tip>
            </div>
            <div className="seg" role="radiogroup" aria-labelledby={`${id}-cell-l`}>
              {CELLS.map((c) => (
                <label key={c} className={`seg-item${a.cellKm === c ? ' is-on' : ''}`}>
                  <input
                    type="radio"
                    name={`${id}-cell`}
                    checked={a.cellKm === c}
                    onChange={() => a.set({ cellKm: c, radiusKm: Math.min(a.radiusKm, Math.floor((Math.sqrt(MAX_CELLS) * c) / 2)) })}
                  />
                  <span>{c >= 1 ? `${c} km` : `${Math.round(c * 1000)} m`}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="ios-row stack">
            <div className="pfield">
              <div className="pfield-top">
                <label htmlFor={`${id}-landing`}>
                  Landing radius<span className="opt"> (optional)</span>
                </label>
                <Tip label="landing radius">Room for the landing ellipse: a cell stays only if no cell failing a map filter lies within this distance.</Tip>
              </div>
              <div className="unit-input">
                <input id={`${id}-landing`} inputMode="decimal" autoComplete="off" value={a.landingRadiusKm} onChange={(e) => a.set({ landingRadiusKm: e.target.value })} />
                <span className="unit" aria-hidden="true">
                  km
                </span>
              </div>
            </div>
          </div>
        </div>

        {MISSION_GROUPS.map((g) => (
          <section key={g.id} aria-labelledby={`${id}-g-${g.id}`}>
            <h3 className="ios-header" id={`${id}-g-${g.id}`}>
              <span className="group-letter" aria-hidden="true">
                {g.letter}
              </span>
              {g.title}
              {g.id === 'window' && (
                <Tip label="the mission window">
                  Filters marked “window” use the timeline’s window: {isoMinute(startMs).replace('T', ' ').slice(0, 16)} UTC for {durationH} h.
                </Tip>
              )}
            </h3>
            <div className="ios-list filter-list">
              {g.filters.map((f) => {
                const on = !!a.enabled[f.id] && !f.unavailable
                const nameId = `${id}-${f.id}-name`
                return (
                  <div key={f.id} className={`filter-row${on ? ' is-on' : ''}${f.unavailable ? ' is-na' : ''}`}>
                    <div className="ios-row">
                      <span className={`ios-icon ios-icon-${f.unavailable ? 'gray' : TONE[f.icon]}`}>{ICONS[f.icon]}</span>
                      <span id={nameId} className="ios-label">
                        {f.title}
                        {f.window && <span className="win-tag"> window</span>}
                      </span>
                      {f.unavailable ? (
                        <span className="na-tag">Not in the search</span>
                      ) : (
                        <>
                          <Tip label={f.title.toLowerCase()}>{f.tip}</Tip>
                          <button type="button" role="switch" aria-checked={on} aria-labelledby={nameId} className="switch" onClick={() => a.toggle(f.id)}>
                            <span className="switch-knob" aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                    {f.unavailable && <p className="fine na-why">{f.unavailable}</p>}
                    {on && f.fields.length > 0 && <div className="filter-fields">{f.fields.map((fd) => field(f, fd, nameId))}</div>}
                  </div>
                )
              })}
            </div>
          </section>
        ))}

        <details className="pgroup-d method-d">
          <summary>
            <IconSliders size={16} /> Method
          </summary>
          <div className="pfield">
            <div className="pfield-top">
              <label htmlFor={`${id}-samples`}>Horizons traced, at most</label>
              <Tip label="horizons traced">
                Window filters are tested on samples placed by a quadtree: coarse first, then split where neighbours disagree. More samples, finer
                edges, longer wait (10 to 20 per second, measured).
              </Tip>
            </div>
            <div className="unit-input">
              <input
                id={`${id}-samples`}
                inputMode="numeric"
                autoComplete="off"
                value={a.samples}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value))
                  if (Number.isFinite(n)) a.set({ samples: Math.max(1, Math.min(2000, n)) })
                }}
              />
            </div>
          </div>
          <div className="pfield">
            <div className="pfield-top">
              <span id={`${id}-az-l`} className="pfield-label">
                Horizon azimuth step
              </span>
              <Tip label="azimuth step">One ray every this many degrees around each sample, over the LOLA heights.</Tip>
            </div>
            <div className="seg" role="radiogroup" aria-labelledby={`${id}-az-l`}>
              {AZ_STEPS.map((s) => (
                <label key={s} className={`seg-item${a.azStepDeg === s ? ' is-on' : ''}`}>
                  <input type="radio" name={`${id}-az`} checked={a.azStepDeg === s} onChange={() => a.set({ azStepDeg: s })} />
                  <span>{s}°</span>
                </label>
              ))}
            </div>
          </div>
          <div className="pfield">
            <div className="pfield-top">
              <label htmlFor={`${id}-reach`}>Horizon reach</label>
              <Tip label="horizon reach">How far each ray goes; terrain beyond is ignored. 150 km covers the peaks that matter at the pole.</Tip>
            </div>
            <div className="unit-input">
              <input
                id={`${id}-reach`}
                inputMode="numeric"
                autoComplete="off"
                value={a.horizonKm}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value))
                  if (Number.isFinite(n)) a.set({ horizonKm: Math.max(20, Math.min(250, n)) })
                }}
              />
              <span className="unit" aria-hidden="true">
                km
              </span>
            </div>
          </div>
          <div className="ios-row">
            <span id={`${id}-unk`} className="ios-label">
              Count “no data” as pass
            </span>
            <Tip label="no data">Off: a cell where a filter has no data is marked unknown and left out. On: it lets the cell through.</Tip>
            <button type="button" role="switch" aria-checked={a.unknownPasses} aria-labelledby={`${id}-unk`} className="switch" onClick={() => a.set({ unknownPasses: !a.unknownPasses })}>
              <span className="switch-knob" aria-hidden="true" />
            </button>
          </div>
        </details>

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" className="primary search-go" disabled={search.isPending}>
          <IconSearch size={17} />
          {search.isPending ? `Searching… up to ${a.samples} horizons` : onCount > 0 ? `Find areas · ${onCount} filter${onCount > 1 ? 's' : ''}` : 'Find areas'}
        </button>
      </form>

      {search.error && <ApiStatus error={search.error} what="Area search" />}
      {a.result && <Results r={a.result} />}
    </div>
  )
}

function Results({ r }: { r: AreaSearchResponse }) {
  const a = useAreas()
  const { select, set } = useApp()
  const id = useId()
  const cellKm2 = (r.grid.cell_m / 1000) ** 2
  const viableKm2 = r.counts.viable * cellKm2
  const study = (lat: number, lon: number) => {
    select({ kind: 'point', lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 })
    set({ mode: 'study' })
  }
  return (
    <div className="results" aria-live="polite">
      <h3 className="ios-header">
        Result
        <span className="muted small-note">
          {r.seconds.toFixed(1)} s{r.window ? ` · ${r.window.samples} horizons` : ''}
        </span>
      </h3>
      <p className="result-chips">
        <span className="chip-stat pass">
          <span aria-hidden="true">✓</span> ≈ {fmtKm2(viableKm2)} km² viable
        </span>
        <span className="chip-stat fail">
          <span aria-hidden="true">✗</span> {(r.counts.failed_static + r.counts.failed_window).toLocaleString('en')} cells out
        </span>
        {r.counts.unknown > 0 && (
          <span className="chip-stat unknown">
            <span aria-hidden="true">?</span> {r.counts.unknown.toLocaleString('en')} no data
          </span>
        )}
      </p>
      <div className="ios-list">
        <div className="ios-row">
          <span id={`${id}-show`} className="ios-label">
            Paint on the map
          </span>
          <button type="button" role="switch" aria-checked={a.show} aria-labelledby={`${id}-show`} className="switch" onClick={() => a.set({ show: !a.show })}>
            <span className="switch-knob" aria-hidden="true" />
          </button>
        </div>
      </div>
      <AreaLegend />

      <h3 className="ios-header">Areas found</h3>
      {r.areas.length === 0 ? (
        <p className="muted pad">No connected area passes every filter. The funnel below shows which filter removed the most.</p>
      ) : (
        <ol className="area-list">
          {r.areas.map((ar, k) => (
            <li key={ar.id} className={a.focus === ar.id ? 'is-focus' : ''}>
              <div className="area-main">
                <strong>
                  #{k + 1} · {fmtKm2(ar.area_km2)} km²
                </strong>
                <span className="muted">
                  score {Math.round(ar.mean_score * 100)} % (best {Math.round(ar.best_score * 100)} %)
                </span>
                {ar.sites.length > 0 && <span className="muted">{ar.sites.join(', ')}</span>}
                <span className="muted small-note">best spot {coord(ar.best_lat, ar.best_lon)}</span>
              </div>
              <div className="area-actions">
                <button
                  type="button"
                  className="small"
                  aria-label={`Show area ${k + 1} on the map`}
                  onClick={() => {
                    a.set({ focus: ar.id })
                    a.look(ar.centroid_lat, ar.centroid_lon, Math.max(8, Math.sqrt(ar.area_km2) * 4))
                  }}
                >
                  Show
                </button>
                <button type="button" className="small" aria-label={`Study the best spot of area ${k + 1}`} onClick={() => study(ar.best_lat, ar.best_lon)}>
                  Study
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="fine">Score: share of the window with sunlight and with Earth contact, equal weights (the long-term maps when no window filter is on).</p>

      <h3 className="ios-header">Funnel</h3>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Cells removed by each filter">
        <table>
          <caption className="sr-only">Cells reaching each filter, removed by it, and without data, in the order they ran</caption>
          <thead>
            <tr>
              <th scope="col">Filter</th>
              <th scope="col">In</th>
              <th scope="col">Out</th>
              <th scope="col">No data</th>
            </tr>
          </thead>
          <tbody>
            {r.funnel.map((f) => (
              <tr key={f.id}>
                <th scope="row">
                  {FUNNEL_LABEL[f.id] ?? f.id}
                  {f.stage === 'window' && <span className="win-tag"> window</span>}
                </th>
                <td>{f.cells_in.toLocaleString('en')}</td>
                <td>{f.cells_out.toLocaleString('en')}</td>
                <td>{f.cells_unknown.toLocaleString('en')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="pgroup-d">
        <summary>How it was computed</summary>
        <ul className="fine assumptions">
          {r.assumptions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>
    </div>
  )
}

/** What the painted cells mean: the patterns, not only the colours. */
export function AreaLegend() {
  return (
    <ul className="area-legend" aria-label="Map legend of the area search">
      <li>
        <span className="sw sw-viable" aria-hidden="true" /> Viable, outlined (brighter: higher score)
      </li>
      <li>
        <span className="sw sw-window" aria-hidden="true" /> Fails a window filter (hatched)
      </li>
      <li>
        <span className="sw sw-static" aria-hidden="true" /> Fails a map filter or the landing radius (dimmed)
      </li>
      <li>
        <span className="sw sw-unknown" aria-hidden="true" /> No data (dotted)
      </li>
      <li>
        <span className="sw sw-region" aria-hidden="true" /> Search region (ring)
      </li>
    </ul>
  )
}
