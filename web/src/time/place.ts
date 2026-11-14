/** Site model for any place with the API's rules: terrain mask for catalogue sites that have one, smooth sphere elsewhere. */
import type { Selection } from '../state/store'
import { terrainRegistry } from '../terrain/registry'
import { polarXY } from '../terrain/tileset'
import { type SiteModel, makeModel } from './engine'
import type { HorizonMasks } from './staticData'

export interface ModelInfo {
  model: SiteModel
  name: string
  mastUsedM: number
}

export const pointName = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(3)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}° ${lon < 0 ? 'W' : 'E'}`

export function placeModel(masks: HorizonMasks, sel: Selection, mastM: number, names?: Map<string, string>): ModelInfo | null {
  if (sel.kind === 'site') {
    const site = masks.site(sel.id)
    if (!site) return null
    const { horizon, mastUsedM } = masks.forSite(site, mastM)
    const ground = site.terrain.available ? (site.terrain.groundHeightM ?? 0) : 0
    return { model: makeModel(site.lat, site.lon, ground, horizon, mastUsedM), name: names?.get(site.id) ?? site.name, mastUsedM }
  }
  // Ground height from the LOLA tiles when the map has loaded them (as the API's model_for_point), else 0 m.
  const [x, y] = polarXY(sel.lat, sel.lon)
  const h = sel.lat < 0 ? terrainRegistry.engine?.heightAt(x, y) : null
  return { model: makeModel(sel.lat, sel.lon, h ?? 0, masks.forPoint(mastM), mastM), name: pointName(sel.lat, sel.lon), mastUsedM: mastM }
}
