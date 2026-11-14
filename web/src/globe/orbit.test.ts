import { describe, expect, it } from 'vitest'
import { MOON_R_KM, OrbitRig, latLonToScene, raySphere, sceneToLatLon } from './orbit'

describe('globe geometry', () => {
  it('puts the north pole up and longitude 0 toward +x', () => {
    const n = latLonToScene(90, 0)
    expect(n[1]).toBeCloseTo(MOON_R_KM, 6)
    const z = latLonToScene(0, 0)
    expect(z[0]).toBeCloseTo(MOON_R_KM, 6)
    // 90° E is +y in Mean-Earth axes, which is −Z in the scene
    expect(latLonToScene(0, 90)[2]).toBeCloseTo(-MOON_R_KM, 6)
  })

  it('round-trips latitude and longitude', () => {
    const [lat, lon] = sceneToLatLon(latLonToScene(-84.79, 29.2))
    expect(lat).toBeCloseTo(-84.79, 9)
    expect(lon).toBeCloseTo(29.2, 9)
  })

  it('hits the near side of the sphere', () => {
    const hit = raySphere([0, 0, 5000], [0, 0, -1])!
    expect(hit[2]).toBeCloseTo(MOON_R_KM, 9)
    expect(raySphere([0, 5000, 5000], [0, 0, -1])).toBeNull()
  })
})

describe('orbit controller', () => {
  it('fits the whole Moon in the free area (sin of the angular radius = R / distance)', () => {
    const o = new OrbitRig({ lat: 0, lon: 0, dist: 10_000 })
    o.fit(1000, 1000, { left: 0, right: 0, top: 0, bottom: 0 }, 40, 1)
    // the disc spans the whole height: angular radius = fov / 2 = 20°
    expect(o.now.dist).toBeCloseTo(MOON_R_KM / Math.sin((20 * Math.PI) / 180), 6)
  })

  it('reports a dive target once the camera arrives, then clears it', () => {
    const o = new OrbitRig({ lat: 0, lon: 0, dist: 6000 })
    o.dive(-85, 30, 2000)
    expect(o.arrived()).toBeNull()
    o.step(1, true) // reduced motion: jumps to the goal
    expect(o.arrived()).toEqual([-85, 30])
    expect(o.arrived()).toBeNull()
  })

  it('takes the short way round in longitude', () => {
    const o = new OrbitRig({ lat: 0, lon: 170, dist: 6000 })
    o.turnTo(0, -170)
    o.step(0.05, false)
    expect(o.now.lon).toBeGreaterThan(170)
  })
})
