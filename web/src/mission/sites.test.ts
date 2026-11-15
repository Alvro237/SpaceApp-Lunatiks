import { describe, expect, it } from 'vitest'
import { compass, siteTitle } from './sites'

describe('site titles', () => {
  it('names the direction from the feature to the site on eight compass points', () => {
    expect(compass(0)).toBe('N')
    expect(compass(44)).toBe('NE')
    expect(compass(180)).toBe('S')
    expect(compass(350)).toBe('N')
    expect(compass(-90)).toBe('W')
  })

  it('"12 km NE of Shackleton", one decimal under 10 km, the coordinates without a feature', () => {
    expect(siteTitle({ lat: -89.4, lon: 130, near: { name: 'Shackleton', distance_km: 12.3, bearing_deg: 47 } })).toBe('12 km NE of Shackleton')
    expect(siteTitle({ lat: -89.4, lon: 130, near: { name: 'de Gerlache', distance_km: 4.26, bearing_deg: 260 } })).toBe('4.3 km W of de Gerlache')
    expect(siteTitle({ lat: -89.4, lon: -130.5, near: null })).toBe('89.400° S, 130.500° W')
  })
})
