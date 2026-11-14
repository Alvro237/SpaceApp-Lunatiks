/** Custom names and pointer colours from the place menu. */
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PIN, placeKey, usePlaceStyles } from './placeStyle'
import type { Selection } from './store'

const site: Selection = { kind: 'site', id: 'mons-malapert' }
const point: Selection = { kind: 'point', lat: -89.45, lon: 137.3 }

beforeEach(() => {
  window.localStorage.clear()
  usePlaceStyles.setState({ styles: {}, menu: null })
})

describe('place styles', () => {
  it('keys catalogue sites by id and points by their coordinates', () => {
    expect(placeKey(site)).toBe('mons-malapert')
    expect(placeKey(point)).toBe('p:-89.45,137.3')
  })

  it('renames a place, and an empty name restores the original', () => {
    usePlaceStyles.getState().rename(point, '  Base camp ')
    expect(usePlaceStyles.getState().styles['p:-89.45,137.3']).toEqual({ name: 'Base camp' })
    usePlaceStyles.getState().rename(point, '')
    expect(usePlaceStyles.getState().styles['p:-89.45,137.3']).toBeUndefined()
  })

  it('sets a pointer colour; the default colour is stored as no colour', () => {
    usePlaceStyles.getState().setColour(site, '#4c8dff')
    expect(usePlaceStyles.getState().styles['mons-malapert']).toEqual({ colour: '#4c8dff' })
    usePlaceStyles.getState().setColour(site, null)
    expect(usePlaceStyles.getState().styles['mons-malapert']).toBeUndefined()
    expect(DEFAULT_PIN).toBe('#ea4335')
  })

  it('keeps the changes in this browser', () => {
    usePlaceStyles.getState().rename(site, 'Ridge')
    usePlaceStyles.getState().setColour(site, '#34d399')
    expect(JSON.parse(window.localStorage.getItem('lunatiks.placeStyles.v1') ?? '{}')).toEqual({ 'mons-malapert': { name: 'Ridge', colour: '#34d399' } })
  })
})
