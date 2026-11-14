import { describe, expect, it } from 'vitest'
import { defaultScene } from './store'
import { decodeScene, encodeScene } from './url'

const T = Date.parse('2027-03-01T06:00:00Z')

describe('scenario URL', () => {
  it('round-trips a full scene', () => {
    const scene = {
      ...defaultScene(T),
      mode: 'mission' as const,
      view: '3d' as const,
      selection: { kind: 'point' as const, lat: -89.45, lon: 137.3 },
      mastM: 10,
      panel: 'tracking' as const,
      commsMinFraction: 0.25,
      layer: 'slope' as const,
      compare: [{ kind: 'site' as const, id: 'im-2' }, { kind: 'point' as const, lat: -88, lon: 10 }],
    }
    const { scene: back, ok } = decodeScene(encodeScene(scene))
    expect(ok).toBe(true)
    expect(back).toEqual(scene)
  })

  it('restores the default scene from a corrupt link', () => {
    const fallback = defaultScene(T)
    for (const bad of ['%%%', 'eyJ2IjoyfQ', encodeURIComponent('not base64'), 'x'.repeat(9000)]) {
      const r = decodeScene(bad, fallback)
      expect(r.ok).toBe(false)
      expect(r.scene).toEqual(fallback)
    }
  })

  it('drops out-of-range fields but keeps the rest', () => {
    const scene = { ...defaultScene(T), mastM: 7 }
    const { scene: back } = decodeScene(encodeScene(scene), defaultScene(T))
    expect(back.mastM).toBe(2)
    expect(back.selection).toEqual(scene.selection)
  })
})
