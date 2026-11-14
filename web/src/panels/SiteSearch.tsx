/**
 * "Choose where", as a search box at the top left of the map: a combobox over the site catalogue (landing sites,
 * missions and polar features, grouped), and next to it a button that opens the manual-coordinates form.
 *
 * ARIA 1.2 combobox with a grouped listbox: arrows move, Enter picks, Escape closes; the active option is announced
 * through aria-activedescendant. Picking a site works exactly as a marker on the map (and adds it to the
 * comparison while Compare is on).
 */
import { type FormEvent, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { SiteSummary } from '../api/types'
import { useApp } from '../state/store'
import { placeKey } from '../state/placeStyle'
import { useSiteNames } from '../time/hooks'
import { pointName } from '../time/place'
import { ApiStatus } from '../ui/ApiStatus'
import { IconCrosshair, IconSearch } from '../ui/icons'
import { Popover } from '../ui/Popover'
import { fmtLat, fmtLon, parseCoordinates } from './format'
import { useCatalogue } from './useCatalogue'

export function SiteSearch() {
  const id = useId()
  const { sites, fromApi, error } = useCatalogue()
  const selection = useApp((s) => s.selection)
  const select = useApp((s) => s.select)
  const names = useSiteNames()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()
  const shown = useMemo(() => sites.filter((s) => !q || `${s.name} ${s.region ?? ''} ${s.group}`.toLowerCase().includes(q)), [sites, q])
  // Groups with LOLA terrain horizons (the south pole) first; the API's order within each group.
  const groups = useMemo(() => {
    const share = (g: string) => shown.filter((s) => s.group === g && s.terrain_available).length / Math.max(1, shown.filter((s) => s.group === g).length)
    return [...new Set(shown.map((s) => s.group))].sort((a, b) => share(b) - share(a))
  }, [shown])
  const ordered = useMemo(() => groups.flatMap((g) => shown.filter((s) => s.group === g)), [groups, shown])

  const current =
    names.get(placeKey(selection)) ??
    (selection.kind === 'site' ? (sites.find((s) => s.id === selection.id)?.name ?? selection.id) : pointName(selection.lat, selection.lon))

  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLElement>(`[data-i='${active}']`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open])

  const pick = (s: SiteSummary) => {
    select({ kind: 'site', id: s.id })
    setOpen(false)
    setQuery('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else setActive(Math.min(ordered.length - 1, active + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(Math.max(0, active - 1))
    } else if (e.key === 'Enter') {
      if (open && ordered[active]) {
        e.preventDefault()
        pick(ordered[active])
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        setQuery('')
      }
    }
  }

  return (
    <div className="site-search">
      <div className={`search-box${open ? ' is-open' : ''}`}>
        <span className="search-ico" aria-hidden="true">
          <IconSearch size={17} />
        </span>
        <label htmlFor={`${id}-q`} className="sr-only">
          Search sites and missions
        </label>
        <input
          ref={input}
          id={`${id}-q`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && ordered[active] ? `${id}-o${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={current}
          value={open ? query : ''}
          onFocus={() => {
            setOpen(true)
            setActive(0)
          }}
          onBlur={() => {
            setOpen(false)
            setQuery('')
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={onKey}
        />
      </div>
      {open && (
        <div ref={list} id={`${id}-list`} role="listbox" aria-label="Sites and missions" className="search-list">
          {!fromApi && (
            <div role="presentation" className="search-note">
              <ApiStatus error={error} what="Site catalogue" />
            </div>
          )}
          {groups.map((g) => (
            <div key={g} role="group" aria-labelledby={`${id}-g-${g}`}>
              <div role="presentation" id={`${id}-g-${g}`} className="search-group">
                {g}
              </div>
              {shown
                .filter((s) => s.group === g)
                .map((s) => {
                  const i = ordered.indexOf(s)
                  const isCurrent = selection.kind === 'site' && selection.id === s.id
                  return (
                    <div
                      key={s.id}
                      id={`${id}-o${i}`}
                      data-i={i}
                      role="option"
                      aria-selected={i === active}
                      className={`search-option${i === active ? ' is-active' : ''}`}
                      // pick on mouse down so the input keeps focus until the choice is made
                      onMouseDown={(e) => {
                        e.preventDefault()
                        pick(s)
                      }}
                      onMouseEnter={() => setActive(i)}
                    >
                      <span className="search-name">{s.name}</span>
                      <span className="search-meta">
                        {fmtLat(s.lat)}, {fmtLon(s.lon)}
                        {!s.terrain_available && ' · no terrain'}
                      </span>
                      {isCurrent && (
                        <span className="search-check" aria-label="current">
                          ✓
                        </span>
                      )}
                    </div>
                  )
                })}
            </div>
          ))}
          {ordered.length === 0 && (
            <div role="presentation" className="search-note">
              No site matches “{query}”.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Exact coordinates: a small form behind a crosshair button. */
export function CoordsButton() {
  return (
    <Popover label="Coordinates" button={<IconCrosshair size={18} />} buttonClass="tool-btn">
      {(close) => <ManualPoint onDone={close} />}
    </Popover>
  )
}

function ManualPoint({ onDone }: { onDone: () => void }) {
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
    onDone()
  }
  return (
    <form onSubmit={submit} noValidate aria-label="Manual coordinates" className="coords-form">
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
      <button type="submit" className="primary">
        Analyse this point
      </button>
    </form>
  )
}
