import { describe, expect, it } from 'vitest'
import { NO_SCREEN } from '../state/store'
import type { Metrics } from '../time/engine'
import { matchesQuery, passesScreen } from './useMapSites'

const m = (sunlightPct: number, commsPct: number) => ({ sunlightPct, commsPct }) as Metrics

describe('which sites the map shows', () => {
  it('matches the search in the name or the group, ignoring case', () => {
    expect(matchesQuery('Shackleton crater', 'South-polar features', 'shack')).toBe(true)
    expect(matchesQuery('IM-2 Athena', 'Recent landers', 'landers')).toBe(true)
    expect(matchesQuery('IM-2 Athena', 'Recent landers', 'apollo')).toBe(false)
  })

  it('screens on sunlight, Earth time and slope; no filter means no verdict', () => {
    expect(passesScreen(NO_SCREEN, m(10, 10), 2)).toBeNull()
    const s = { minSunPct: 40, minEarthPct: 80, maxSlopeDeg: 5 }
    expect(passesScreen(s, m(53, 83), 1.1)).toBe(true)
    expect(passesScreen(s, m(39, 83), 1.1)).toBe(false)
    expect(passesScreen(s, m(53, 79), 1.1)).toBe(false)
    expect(passesScreen(s, m(53, 83), 6)).toBe(false)
  })

  it('a site without LOLA terrain has no slope, so it does not pass a slope limit', () => {
    expect(passesScreen({ ...NO_SCREEN, maxSlopeDeg: 10 }, m(50, 50), null)).toBe(false)
  })
})
