/**
 * Layers menu of the globe: the same button as the polar map's (ui/panels.css `.layers`), so the layers are
 * reachable in Site explorer and in Mission planner alike. It holds what the globe can draw (surface, places) and
 * colour layers: elevation and slope over the whole Moon, and the polar map's illumination, Earth visibility and
 * permanent shadow over the polar cap (no dataset covers more).
 */
import { useEffect, useId, useRef, useState } from 'react'
import { type LayerId, useApp } from '../state/store'
import type { Tileset } from '../terrain/tileset'
import { IconLayers } from '../ui/icons'
import { CloseButton } from '../ui/PanelNav'
import { useFitViewport } from '../ui/useFitViewport'

interface Props {
  surface: 'photo' | 'relief'
  onSurface: (s: 'photo' | 'relief') => void
  /** The polar map's tileset: its colour layers are drawn over the polar cap. */
  tileset?: Tileset
}

/** A layer name without its bracketed detail ("Mean sunlight (18.6-year average)" → "Mean sunlight"): the menu stays one line per layer. */
const shortName = (n: string) => n.replace(/\s*\(.*\)\s*$/, '')

export function GlobeLayers({ surface, onSurface, tileset }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useFitViewport(menu, open)
  const markerStyle = useApp((s) => s.markerStyle)
  const set = useApp((s) => s.set)
  const layer = useApp((s) => s.layer)
  // elevation and slope are drawn over the whole Moon from the heights; the others exist south of 60° S only
  const polarOnly = Object.entries(tileset?.layers ?? {}).filter(([k]) => k !== 'slope')
  const colour = layer === 'elevation' || layer === 'slope' || polarOnly.some(([k]) => k === layer) ? layer : 'surface'

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', close)
    document.addEventListener('pointerdown', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('pointerdown', close)
    }
  }, [open])

  return (
    <div className="layers" ref={ref}>
      <button type="button" aria-expanded={open} aria-controls={`${id}-menu`} onClick={() => setOpen(!open)} aria-label="Map layers" title="Map layers">
        <IconLayers />
      </button>
      {open && (
        <div ref={menu} id={`${id}-menu`} className="layers-menu is-list" role="group" aria-label="Map layers">
          <div className="pop-head">
            <span className="pop-head-title" aria-hidden="true">
              Map layers
            </span>
            <CloseButton
              label="Close map layers"
              size={16}
              onClick={() => {
                setOpen(false)
                ref.current?.querySelector<HTMLButtonElement>('button[aria-controls]')?.focus()
              }}
            />
          </div>
          <fieldset>
            <legend>Surface</legend>
            <label>
              <input type="radio" name={`${id}-surface`} checked={surface === 'photo'} onChange={() => onSurface('photo')} /> Photo on the relief
            </label>
            <label>
              <input type="radio" name={`${id}-surface`} checked={surface === 'relief'} onChange={() => onSurface('relief')} /> Relief only (LOLA)
            </label>
          </fieldset>
          <fieldset>
            <legend>Places</legend>
            {(
              [
                ['pin', 'Pins'],
                ['crater', 'Crater outlines'],
                ['cross', 'Crosses'],
              ] as const
            ).map(([k, label]) => (
              <label key={k}>
                <input type="radio" name={`${id}-marker`} checked={markerStyle === k} onChange={() => set({ markerStyle: k })} /> {label}
              </label>
            ))}
          </fieldset>
          {tileset && (
            <fieldset>
              <legend>Colour layer</legend>
              <label>
                <input type="radio" name={`${id}-colour`} checked={colour === 'surface'} onChange={() => set({ layer: 'photo' })} /> None
              </label>
              <label>
                <input type="radio" name={`${id}-colour`} checked={colour === 'elevation'} onChange={() => set({ layer: 'elevation' })} /> Elevation
              </label>
              <label>
                <input type="radio" name={`${id}-colour`} checked={colour === 'slope'} onChange={() => set({ layer: 'slope' })} /> Slope
              </label>
              {polarOnly.map(([k, m]) => (
                <label key={k} title={`${m.name}: drawn south of 60° S only`}>
                  <input type="radio" name={`${id}-colour`} checked={colour === k} onChange={() => set({ layer: k as LayerId })} /> {shortName(m.name)}
                  <span className="muted"> · S pole</span>
                </label>
              ))}
            </fieldset>
          )}
        </div>
      )}
    </div>
  )
}
