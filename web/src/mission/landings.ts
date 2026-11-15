/**
 * Past landings on the map (section 3.6): measured landing and impact points south of 60° S, from
 * `data/external/sites/landing_sites.csv` (copied by `scripts/copy_static_data.mjs` to `public/data/landing_sites.csv`).
 * Only rows with `coord_quality = measured_landing_point` are real hardware on the ground, not a candidate site or
 * a reference feature, so only those are drawn.
 */
import { DATA_BASE } from '../time/staticData'

export interface LandingSite {
  id: string
  name: string
  lat: number
  lon: number
  /** "landing": a soft landing, crewed or robotic; "impact": a crash or deliberate impact. */
  kind: 'landing' | 'impact'
}

const IMPACT_CATEGORY = 'failed_or_impact'

function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split('\n')
    .map((line) => line.split(','))
}

export function parseLandingSites(csv: string): LandingSite[] {
  const [head, ...rows] = parseCsv(csv)
  const col = (name: string) => head.indexOf(name)
  const iId = col('id')
  const iName = col('name')
  const iCategory = col('category')
  const iLat = col('lat')
  const iLon = col('lon_pm180')
  const iQuality = col('coord_quality')
  return rows
    .filter((r) => r[iQuality] === 'measured_landing_point' && Number(r[iLat]) <= -60)
    .map((r) => ({
      id: r[iId],
      name: r[iName],
      lat: Number(r[iLat]),
      lon: Number(r[iLon]),
      kind: r[iCategory] === IMPACT_CATEGORY ? 'impact' : 'landing',
    }))
}

export async function loadLandingSites(): Promise<LandingSite[]> {
  const res = await fetch(`${DATA_BASE}landing_sites.csv`)
  if (!res.ok) throw new Error(`landing_sites.csv: HTTP ${res.status}`)
  return parseLandingSites(await res.text())
}

/** Sites within `radiusKm` of a centre (great-circle on the 1737.4 km sphere, close enough for this purpose). */
export function landingSitesNear(sites: LandingSite[], centerLat: number, centerLon: number, radiusKm: number): LandingSite[] {
  const R = 1737.4
  const rad = Math.PI / 180
  const c1 = centerLat * rad
  return sites.filter((s) => {
    const c2 = s.lat * rad
    const dLon = (s.lon - centerLon) * rad
    const d = R * Math.acos(Math.min(1, Math.max(-1, Math.sin(c1) * Math.sin(c2) + Math.cos(c1) * Math.cos(c2) * Math.cos(dLon))))
    return d <= radiusKm
  })
}
