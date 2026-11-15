/**
 * Which places the map and the globe draw, and how each one fares against the screening filters.
 *
 * Shown: the catalogue sites that match the search text and pass the screening (sunlight and Earth over the
 * analysis window from the browser engine, slope from the site's LOLA terrain), plus the selected and compared
 * places. With no search and no filter, only the selected and compared places are drawn.
 */
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { type Screen, type Selection, sameSelection, screenActive, useApp } from '../state/store'
import { type Metrics, makeModel } from '../time/engine'
import { evaluateWindow, useEphemeris, useMasks, useParams, useSiteNames } from '../time/hooks'
import { pointName } from '../time/place'
import { placeKey, usePlaceStyles } from '../state/placeStyle'
import { DATA_BASE } from '../time/staticData'

export interface MapSite {
  key: string
  sel: Selection
  name: string
  lat: number
  lon: number
  /** Diameter of the named feature (IAU), km; null for landing points and typed points. */
  diameterKm: number | null
  slopeDeg: number | null
  metrics: Metrics | null
  /** Screening verdict: true pass, false fail, null when no filter is set. */
  pass: boolean | null
  current: boolean
  /** 1-based number in the comparison, or null. */
  compared: number | null
  /** Pointer colour the viewer chose (place menu), or null for the default. */
  colour: string | null
}

interface FeaturesDoc {
  features: Record<string, { iauName: string; diameterKm: number; link: string }>
}

export const useFeatures = () =>
  useQuery({
    queryKey: ['static', 'features'],
    queryFn: async () => (await (await fetch(`${DATA_BASE}features.json`)).json()) as FeaturesDoc,
    staleTime: Infinity,
    retry: 1,
  })

export function matchesQuery(name: string, extra: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  return !q || `${name} ${extra}`.toLowerCase().includes(q)
}

export function passesScreen(s: Screen, m: Metrics | null, slopeDeg: number | null): boolean | null {
  if (!screenActive(s)) return null
  if (s.minSunPct !== null && (!m || m.sunlightPct < s.minSunPct)) return false
  if (s.minEarthPct !== null && (!m || m.commsPct < s.minEarthPct)) return false
  // unknown slope (no LOLA terrain at the site) does not pass a slope limit
  if (s.maxSlopeDeg !== null && (slopeDeg === null || slopeDeg > s.maxSlopeDeg)) return false
  return true
}

export function useMapSites(): MapSite[] {
  const masks = useMasks().data
  const eph = useEphemeris().data
  const features = useFeatures().data
  const names = useSiteNames()
  const params = useParams()
  const startMs = useApp((s) => s.startMs)
  const durationH = useApp((s) => s.durationH)
  const mastM = useApp((s) => s.mastM)
  const query = useApp((s) => s.siteQuery)
  const screen = useApp((s) => s.screen)
  const selection = useApp((s) => s.selection)
  const compare = useApp((s) => s.compare)
  const styles = usePlaceStyles((s) => s.styles)

  // Window metrics per catalogue site, only when a filter needs them.
  const metrics = useMemo(() => {
    if (!masks || !eph || !screenActive(screen)) return new Map<string, Metrics | null>()
    return new Map(
      masks.doc.sites.map((s) => {
        const { horizon, mastUsedM } = masks.forSite(s, mastM)
        const model = makeModel(s.lat, s.lon, s.terrain.available ? (s.terrain.groundHeightM ?? 0) : 0, horizon, mastUsedM)
        return [s.id, evaluateWindow(eph.table, model, startMs, durationH, 60, params)?.metrics ?? null]
      }),
    )
  }, [masks, eph, screen, startMs, durationH, mastM, params])

  return useMemo(() => {
    if (!masks) return []
    const searching = query.trim() !== '' || screenActive(screen)
    const out: MapSite[] = []
    const num = (sel: Selection) => {
      const i = compare.findIndex((c) => sameSelection(c, sel))
      return i >= 0 ? i + 1 : null
    }
    for (const s of masks.doc.sites) {
      const sel: Selection = { kind: 'site', id: s.id }
      const current = sameSelection(sel, selection)
      const compared = num(sel)
      const slope = s.terrain.available ? (s.terrain.slopeDeg ?? null) : null
      const m = metrics.get(s.id) ?? null
      const pass = passesScreen(screen, m, slope)
      const name = names.get(s.id) ?? s.name
      const wanted = searching && matchesQuery(name, s.group, query) && pass !== false
      if (!wanted && !current && compared === null) continue
      out.push({ key: s.id, sel, name, lat: s.lat, lon: s.lon, diameterKm: features?.features[s.id]?.diameterKm ?? null, slopeDeg: slope, metrics: m, pass, current, compared, colour: styles[s.id]?.colour ?? null })
    }
    for (const p of selection ? [selection, ...compare] : compare) {
      if (p.kind !== 'point' || out.some((o) => sameSelection(o.sel, p))) continue
      const key = placeKey(p)
      out.push({ key, sel: p, name: names.get(key) ?? pointName(p.lat, p.lon), lat: p.lat, lon: p.lon, diameterKm: null, slopeDeg: null, metrics: null, pass: null, current: sameSelection(p, selection), compared: num(p), colour: styles[key]?.colour ?? null })
    }
    return out
  }, [masks, features, names, query, screen, metrics, selection, compare, styles])
}
