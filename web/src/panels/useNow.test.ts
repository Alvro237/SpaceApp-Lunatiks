/**
 * The SW-1 state contract (seryitron-branchito, docs/sw1-output-format.md) read by the panels. The fixtures are
 * real responses of GET /api/v1/sites/{id}/state captured from that branch: IM-2 at the navigator's opening
 * instant, and Shackleton at the greatest phase of the total lunar eclipse of 2026-03-03 (NASA GSFC).
 */
import { describe, expect, it } from 'vitest'
import fixtures from '../test/fixtures/sw1-state.json'
import type { SiteState } from '../api/types'
import { fromApi } from './useNow'

const im2 = fixtures.im2 as SiteState
const eclipse = fixtures.eclipse as SiteState
const light = { irradiance: 1394, power: 0 }

describe('SW-1 state in the panels', () => {
  it('reads az/el inside sun and earth, and the transitions', () => {
    const t = Date.parse(im2.t)
    const v = fromApi(im2, t, null, light)
    expect(v.source).toBe('api')
    expect(v.sun.az).toBeCloseTo(im2.sun.az, 9)
    expect(v.sun.el).toBeCloseTo(1.5157, 3)
    expect(v.earth.el).toBeCloseTo(im2.earth.el, 9)
    expect(v.sun.fraction).toBe(im2.sun.visible_fraction)
    expect(v.mastUsedM).toBe(2)
    expect(v.horizonKind).toBe('terrain')
    expect(v.nextSun?.kind).toBe(im2.next_sun_transition?.kind)
    expect(v.nextSun?.atMs).toBe(Date.parse(im2.next_sun_transition!.at))
    expect(v.nextSun?.inMs).toBeCloseTo(im2.next_sun_transition!.in_hours * 3_600_000, 0)
  })

  it('maps the eclipse word to the engine code', () => {
    expect(fromApi(im2, 0, null, light).eclipse).toBe(0)
    expect(eclipse.eclipse).toBe('total')
    expect(fromApi(eclipse, 0, null, light).eclipse).toBe(2)
  })

  it('takes the power from the browser engine, never from the state', () => {
    const v = fromApi(im2, 0, null, { irradiance: 1394.2, power: 123.4 })
    expect(v.irradiance).toBe(1394.2)
    expect(v.power).toBe(123.4)
    expect(v.powerSource).toBe('browser')
    expect('power_w_m2' in im2).toBe(false)
  })
})
