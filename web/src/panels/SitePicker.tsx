/**
 * Step 1, "Choose where": a catalogue site (search and groups) or manual coordinates. Each site is a button,
 * so the list is the keyboard and screen-reader route to everything the map markers do.
 */
import { type FormEvent, useId, useMemo, useState } from 'react'
import { useSites } from '../api/hooks'
import type { SiteSummary } from '../api/types'
import { useApp } from '../state/store'
import { useMasks } from '../time/hooks'
import type { StaticSite } from '../time/staticData'
import { ApiStatus } from '../ui/ApiStatus'
import { matchesQuery, useMapSites } from '../map/useMapSites'
import { type Screen, NO_SCREEN, screenActive } from '../state/store'
import { fmtLat, fmtLon, parseCoordinates } from './format'


/** The catalogue from the API; the static copy of sites.json stands in when the API is down. */
function useCatalogue(): { sites: SiteSummary[]; fromApi: boolean; error: unknown } {
  const api = useSites()
  const masks = useMasks().data
  return useMemo(() => {
    if (api.data) return { sites: api.data.sites, fromApi: true, error: null }
    const fallback = (masks?.doc.sites ?? []).map((s: StaticSite & { kind?: string; region?: string }) => ({
      id: s.id,
      name: s.name,
      group: s.group,
      kind: s.kind ?? '',
      lat: s.lat,
      lon: s.lon,
      region: s.region ?? null,
      terrain_available: !!s.terrain.available,
    }))
    return { sites: fallback, fromApi: false, error: api.error }
  }, [api.data, api.error, masks])
}

export function SitePicker() {
  const id = useId()
  const { sites, fromApi, error } = useCatalogue()
  const selection = useApp((s) => s.selection)
  const select = useApp((s) => s.select)
  const query = useApp((s) => s.siteQuery)
  const set = useApp((s) => s.set)
  const setQuery = (siteQuery: string) => set({ siteQuery })
  // the same rule as the map (useMapSites): name search and the screening filters
  const verdicts = new Map(useMapSites().map((m) => [m.key, m.pass]))
  const screening = screenActive(useApp((s) => s.screen))
  const shown = sites.filter((s) => matchesQuery(s.name, `${s.region ?? ''} ${s.group}`, query) && (!screening || verdicts.get(s.id) === true))
  // Groups with LOLA terrain horizons (the south pole) first; the API's order within each group.
  const terrainShare = (g: string) => shown.filter((s) => s.group === g && s.terrain_available).length / Math.max(1, shown.filter((s) => s.group === g).length)
  const groups = [...new Set(shown.map((s) => s.group))].sort((a, b) => terrainShare(b) - terrainShare(a))

  return (
    <div className="panel-section">
      <h3 className="ios-header">Where</h3>
      {!fromApi && <ApiStatus error={error} what="Site catalogue" />}
      <label htmlFor={`${id}-q`} className="sr-only">
        Search sites
      </label>
      <input id={`${id}-q`} type="search" className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sites" />
      <div className="site-list" role="region" aria-label="Catalogue sites" tabIndex={-1}>
        {groups.map((g) => (
          <div key={g} className="site-group">
            <h3>{g}</h3>
            <ul>
              {shown
                .filter((s) => s.group === g)
                .map((s) => {
                  const active = selection.kind === 'site' && selection.id === s.id
                  return (
                    <li key={s.id}>
                      <button type="button" className="site-item" aria-pressed={active} onClick={() => select({ kind: 'site', id: s.id })}>
                        <span className="site-name">{s.name}</span>
                        <span className="site-meta">
                          {fmtLat(s.lat)}, {fmtLon(s.lon)}
                          {!s.terrain_available && ' · no terrain'}
                        </span>
                        {active && (
                          <span className="site-check" aria-hidden="true">
                            ✓
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
            </ul>
          </div>
        ))}
        {shown.length === 0 && <p className="muted">No site matches.</p>}
      </div>
      <ScreenFilters />
      <ManualPoint />
    </div>
  )
}

function ManualPoint() {
  const id = useId()
  const select = useApp((s) => s.select)
  const selection = useApp((s) => s.selection)
  const [lat, setLat] = useState(selection.kind === 'point' ? String(selection.lat) : '-89.45')
  const [lon, setLon] = useState(selection.kind === 'point' ? String(selection.lon) : '137.3')
  const [error, setError] = useState<string | null>(null)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const r = parseCoordinates(lat, lon)
    if ('error' in r) return setError(r.error)
    setError(null)
    select({ kind: 'point', lat: r.lat, lon: r.lon })
  }
  return (
    <details className="manual">
      <summary>Coordinates</summary>
    <form onSubmit={submit} noValidate aria-label="Manual coordinates">
      <div className="row">
        <div className="field stack">
          <label htmlFor={`${id}-lat`}>Latitude (°)</label>
          <input id={`${id}-lat`} inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} />
        </div>
        <div className="field stack">
          <label htmlFor={`${id}-lon`}>Longitude (° E)</label>
          <input id={`${id}-lon`} inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} />
        </div>
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="error">
          {error}
        </p>
      )}
      <button type="submit">Analyse this point</button>
    </form>
    </details>
  )
}

/**
 * Screening of the catalogue over the analysis window (browser engine) and the sites' LOLA slope. The map and the
 * list show only the sites that pass; a site with no terrain has no slope and does not pass a slope limit.
 */
function ScreenFilters() {
  const id = useId()
  const screen = useApp((s) => s.screen)
  const set = useApp((s) => s.set)
  const field = (key: keyof Screen, label: string, max: number) => (
    <div className="field stack">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        value={screen[key] ?? ''}
        onChange={(e) => {
          const v = e.target.value.trim() === '' ? null : Number(e.target.value)
          set({ screen: { ...screen, [key]: v !== null && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : null } })
        }}
      />
    </div>
  )
  return (
    <details className="manual" open={screenActive(screen)}>
      <summary>Filter sites</summary>
      <div className="row">
        {field('minSunPct', 'Sunlit ≥ %', 100)}
        {field('minEarthPct', 'Earth ≥ %', 100)}
        {field('maxSlopeDeg', 'Slope ≤ °', 45)}
      </div>
      {screenActive(screen) && (
        <button type="button" className="link" onClick={() => set({ screen: NO_SCREEN })}>
          Clear filters
        </button>
      )}
    </details>
  )
}
