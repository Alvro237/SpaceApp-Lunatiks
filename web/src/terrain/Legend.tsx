/**
 * Map layers: a compact menu (colour layer, lighting, crater rims, relief exaggeration) and a legend chip with
 * the value range, units and source of the active colour layer. Values are printed, never colour alone.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { IconLayers } from '../ui/icons'
import { type LayerId, useApp } from '../state/store'
import { ApiStatus } from '../ui/ApiStatus'
import { useFitViewport } from '../ui/useFitViewport'
import { type ColormapId, gradientCss } from './colormaps'
import { CRATER_MIN_DIAM_KM } from './Craters'
import { liveConfigFromEnv } from './live/config'
import { liveLayerMaxZ } from './live/layers'
import type { Tileset } from './tileset'

/** Finest cell size of a layer when zoomed in (live levels, when the PGDA proxy is configured), or null. */
function finestCellM(tileset: Tileset, id: string): number | null {
  const z = liveConfigFromEnv(import.meta.env)?.proxyBase ? liveLayerMaxZ(id) : -1
  return z >= 0 ? tileset.levels[0].cellM / 2 ** z : null
}

export const EXAGGERATIONS = [1, 2, 5] as const
export type Exaggeration = (typeof EXAGGERATIONS)[number]

const fmt = (v: number, unit: string) => {
  if (unit === 'fraction') return `${Math.round(v * 100)} %`
  if (unit === 'deg') return `${v.toFixed(0)}°`
  if (unit === 'm') return `${(v / 1000).toFixed(1)} km`
  return `${v} ${unit}`
}

interface Props {
  tileset: Tileset
  exaggeration: Exaggeration
  onExaggeration: (x: Exaggeration) => void
  craterError: unknown
}

export function LayersControl({ tileset, exaggeration, onExaggeration, craterError }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useFitViewport(menu, open)
  const layer = useApp((s) => s.layer)
  const lighting = useApp((s) => s.lighting)
  const craters = useApp((s) => s.craters)
  const markerStyle = useApp((s) => s.markerStyle)
  const set = useApp((s) => s.set)
  const options: { id: LayerId; name: string }[] = [
    { id: 'none', name: 'Relief only' },
    { id: 'photo', name: 'Photo (LROC WAC) on the relief' },
    { id: 'elevation', name: 'Elevation' },
    ...Object.entries(tileset.layers).map(([k, m]) => ({ id: k as LayerId, name: m.name })),
  ]

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
        <div ref={menu} id={`${id}-menu`} className="layers-menu" role="group" aria-label="Map layers">
          <fieldset>
            <legend>Colour</legend>
            {options.map((o) => (
              <label key={o.id}>
                <input type="radio" name={`${id}-layer`} checked={layer === o.id} onChange={() => set({ layer: o.id })} /> {o.name}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Places</legend>
            {(
              [
                ['pin', 'Pins'],
                ['crater', 'Crater outlines (real diameter)'],
                ['cross', 'Crosses'],
              ] as const
            ).map(([k, label]) => (
              <label key={k}>
                <input type="radio" name={`${id}-marker`} checked={markerStyle === k} onChange={() => set({ markerStyle: k })} /> {label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Light</legend>
            <label>
              <input type="radio" name={`${id}-light`} checked={lighting === 'sun'} onChange={() => set({ lighting: 'sun' })} /> Sun at the chosen time
            </label>
            <label>
              <input type="radio" name={`${id}-light`} checked={lighting === 'relief'} onChange={() => set({ lighting: 'relief' })} /> Neutral relief
            </label>
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={craters} onChange={(e) => set({ craters: e.target.checked })} /> Craters ≥ {CRATER_MIN_DIAM_KM} km
          </label>
          {!!craterError && <ApiStatus error={craterError} what="Craters" />}
          <label className="check" htmlFor={`${id}-exag`}>
            3D relief
            <select id={`${id}-exag`} value={exaggeration} onChange={(e) => onExaggeration(Number(e.target.value) as Exaggeration)}>
              {EXAGGERATIONS.map((x) => (
                <option key={x} value={x}>
                  ×{x}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

export function LegendChip({ tileset }: { tileset: Tileset }) {
  const layer = useApp((s) => s.layer)
  if (layer === 'photo') {
    return (
      <figure className="legend-chip">
        <figcaption>
          <strong>Photo</strong> <span className="muted">· LROC WAC south polar mosaic, 100 m, NASA Moon Trek (brightness and shadows as photographed) · on LOLA relief lit by the chosen light</span>
        </figcaption>
      </figure>
    )
  }
  const meta = layer !== 'none' && layer !== 'elevation' ? tileset.layers[layer] : null
  const scale: { name: string; cmap: ColormapId; min: number; max: number; unit: string; source: string } | null =
    layer === 'elevation'
      ? { name: 'Elevation', cmap: 'cividis', min: tileset.overview.min, max: tileset.overview.max, unit: 'm', source: 'LOLA, PGDA 90' }
      : meta
        ? {
            name: meta.name,
            cmap: meta.colormap,
            min: meta.min,
            max: meta.max,
            unit: meta.unit,
            source: `LOLA, ${meta.source.product?.replace('https://pgda.gsfc.nasa.gov/products/', 'PGDA ') ?? 'NASA'} · ${meta.cellM} m${
              finestCellM(tileset, layer) ? `, ${finestCellM(tileset, layer)} m zoomed in` : ''
            }`,
          }
        : null
  if (!scale) return null
  return (
    <figure className="legend-chip">
      <figcaption>
        <strong>{scale.name}</strong> <span className="muted">· {scale.source}</span>
      </figcaption>
      <div className="scale-bar" style={{ background: gradientCss(scale.cmap) }} aria-hidden="true" />
      <div className="scale-ticks">
        <span>{fmt(scale.min, scale.unit)}</span>
        <span>{fmt((scale.min + scale.max) / 2, scale.unit)}</span>
        <span>{fmt(scale.max, scale.unit)}</span>
      </div>
    </figure>
  )
}
