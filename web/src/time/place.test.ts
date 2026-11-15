import { describe, expect, it } from 'vitest'
import { Horizon, flatHorizon } from './engine'
import { placeModel } from './place'
import type { HorizonMasks } from './staticData'

/** Only what placeModel needs for manual coordinates. */
const masks = { forPoint: () => flatHorizon(-0.087) } as unknown as HorizonMasks
const point = { kind: 'point', lat: -85.5, lon: 10 } as const

describe('model of manual coordinates', () => {
  it('uses the skyline the API traced over LOLA terrain, with its ground height', () => {
    const values = Array.from({ length: 720 }, (_, i) => Math.sin(i / 50) * 3)
    const info = placeModel(masks, point, 2, undefined, { kind: 'terrain', values, groundM: -859, cellM: 240 })!
    expect(info.horizonSource).toBe('traced')
    expect(info.demCellM).toBe(240)
    expect(info.model.horizon).toBeInstanceOf(Horizon)
    expect(info.model.horizon.kind).toBe('terrain')
    expect(info.model.horizon.at(10)).toBeCloseTo(values[20], 9)
    expect(info.model.groundM).toBe(-859)
  })

  it('falls back to the smooth sphere without an answer or outside the grids', () => {
    expect(placeModel(masks, point, 2)!.horizonSource).toBe('smooth')
    const outside = placeModel(masks, point, 2, undefined, { kind: 'smooth_sphere', values: [], groundM: 0, cellM: null })!
    expect(outside.horizonSource).toBe('smooth')
    expect(outside.model.horizon.kind).toBe('smooth_sphere')
  })
})

describe('model of a catalogue site without a stored mask', () => {
  const site = { id: 'apollo-17', name: 'Apollo 17', lat: 20.1911, lon: 30.7723, terrain: { available: false } }
  const siteMasks = { site: () => site, forSite: () => ({ horizon: flatHorizon(-0.087), mastUsedM: 2 }), forPoint: () => flatHorizon(-0.087) } as unknown as HorizonMasks
  const sel = { kind: 'site', id: 'apollo-17' } as const

  it('uses the skyline the API traced at the site coordinates once it answers', () => {
    const values = Array.from({ length: 720 }, (_, i) => Math.cos(i / 90) * 5)
    const info = placeModel(siteMasks, sel, 2, undefined, { kind: 'terrain', values, groundM: -2608, cellM: 3790.4 })!
    expect(info.horizonSource).toBe('traced')
    expect(info.demCellM).toBe(3790.4)
    expect(info.model.horizon.kind).toBe('terrain')
    expect(info.model.groundM).toBe(-2608)
    expect(info.name).toBe('Apollo 17')
  })

  it('shows the smooth sphere only until the API answers', () => {
    const info = placeModel(siteMasks, sel, 2)!
    expect(info.horizonSource).toBe('smooth')
    expect(info.model.horizon.kind).toBe('smooth_sphere')
  })
})
