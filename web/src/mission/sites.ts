/** Words for the proposed landing sites of the suitability search (right panel, mission-design-spec.md 9.7). */
import type { TopSite } from '../api/types'

export const coord = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(3)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}° ${lon < 0 ? 'W' : 'E'}`

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
/** Eight-point compass direction of a bearing (degrees clockwise from north). */
export function compass(bearingDeg: number): string {
  return COMPASS[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8]
}

/** "12 km NE of Shackleton" (the bearing is from the feature to the site), or the coordinates without a feature. */
export function siteTitle(s: Pick<TopSite, 'lat' | 'lon' | 'near'>): string {
  if (!s.near) return coord(s.lat, s.lon)
  if (s.near.distance_km < 0.5) return `At ${s.near.name}`
  const d = s.near.distance_km < 10 ? s.near.distance_km.toFixed(1) : s.near.distance_km.toFixed(0)
  return `${d} km ${compass(s.near.bearing_deg)} of ${s.near.name}`
}

