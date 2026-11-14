import { useMemo } from 'react'
import { useSites } from '../api/hooks'
import type { SiteSummary } from '../api/types'
import { useMasks } from '../time/hooks'
import type { StaticSite } from '../time/staticData'

/** The catalogue from the API; the static copy of sites.json stands in when the API is down. */
export function useCatalogue(): { sites: SiteSummary[]; fromApi: boolean; error: unknown } {
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

