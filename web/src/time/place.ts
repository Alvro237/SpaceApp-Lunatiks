/**
 * Site model for any place with the API's rules: the stored terrain mask for catalogue sites that have one; for
 * manual coordinates the skyline the API ray-traced over LOLA terrain (GET /points/horizon) once it has answered;
 * smooth sphere elsewhere (no API, or outside the elevation grids).
 */
import type { Selection } from '../state/store'
import { terrainRegistry } from '../terrain/registry'
import { polarXY } from '../terrain/tileset'
import { Horizon, type SiteModel, makeModel } from './engine'
import type { HorizonMasks } from './staticData'

export interface ModelInfo {
  model: SiteModel
  name: string
  mastUsedM: number
  /** catalogue: the pipeline's fine mask; traced: computed for this point; smooth: geometric dip */
  horizonSource: 'catalogue' | 'traced' | 'smooth'
  /** traced: cell size of the finest elevation grid at the point, metres */
  demCellM?: number
}

/** What GET /points/horizon returns that the model needs. */
export interface TracedHorizon {
  kind: 'terrain' | 'smooth_sphere'
  values: number[]
  groundM: number
  cellM: number | null
}

export const pointName = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(3)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}° ${lon < 0 ? 'W' : 'E'}`

export function placeModel(masks: HorizonMasks, sel: Selection, mastM: number, names?: Map<string, string>, traced?: TracedHorizon | null): ModelInfo | null {
  if (sel.kind === 'site') {
    const site = masks.site(sel.id)
    if (!site) return null
    const { horizon, mastUsedM } = masks.forSite(site, mastM)
    const ground = site.terrain.available ? (site.terrain.groundHeightM ?? 0) : 0
    return {
      model: makeModel(site.lat, site.lon, ground, horizon, mastUsedM),
      name: names?.get(site.id) ?? site.name,
      mastUsedM,
      horizonSource: site.terrain.available ? 'catalogue' : 'smooth',
    }
  }
  if (traced && traced.kind === 'terrain') {
    const model = makeModel(sel.lat, sel.lon, traced.groundM, new Horizon(traced.values, 'terrain'), mastM)
    return { model, name: pointName(sel.lat, sel.lon), mastUsedM: mastM, horizonSource: 'traced', demCellM: traced.cellM ?? undefined }
  }
  // Ground height from the LOLA tiles when the map has loaded them (as the API's model_for_point), else 0 m.
  const [x, y] = polarXY(sel.lat, sel.lon)
  const h = sel.lat < 0 ? terrainRegistry.engine?.heightAt(x, y) : null
  return { model: makeModel(sel.lat, sel.lon, h ?? 0, masks.forPoint(mastM), mastM), name: pointName(sel.lat, sel.lon), mastUsedM: mastM, horizonSource: 'smooth' }
}
