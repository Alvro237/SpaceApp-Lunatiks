import { describe, expect, it } from 'vitest'
import { IDLE_BEFORE_SPIN_MS, MAX_TILT, MOON_R_KM, NEAR_ENTER_KM, NEAR_LEAVE_KM, isNearView, OrbitRig, SURFACE_MAX_R_KM, TILT_3D, cameraPose, missionPickOutcome, nearPlaneKm, RELIEF_MAX, SPIN_DEG_PER_S, latLonToScene, raySphere, reliefExaggeration, sceneToLatLon, zoomOrbitToward } from './orbit'

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

describe('relief exaggeration', () => {
  it('is x1 close in, x4 for the whole Moon, and grows with distance in between', () => {
    expect(reliefExaggeration(MOON_R_KM + 200)).toBe(2)
    expect(reliefExaggeration(MOON_R_KM * 3.4)).toBe(RELIEF_MAX)
    expect(reliefExaggeration(MOON_R_KM + 1_375)).toBeCloseTo(3, 6)
  })
})

describe('idle spin', () => {
  const rig = () => new OrbitRig({ lat: 0, lon: 0, dist: 6000 }, 0)

  it('stays still until 20 s without a touch, then turns slowly', () => {
    const o = rig()
    o.step(1, false, IDLE_BEFORE_SPIN_MS - 1)
    expect(o.goal.lon).toBe(0)
    o.step(2, false, IDLE_BEFORE_SPIN_MS)
    expect(o.goal.lon).toBeCloseTo(2 * SPIN_DEG_PER_S, 9)
    expect(o.isSpinning(IDLE_BEFORE_SPIN_MS)).toBe(true)
  })

  it('a touch restarts the 20 s', () => {
    const o = rig()
    o.touch(15_000)
    o.step(1, false, IDLE_BEFORE_SPIN_MS + 1)
    expect(o.goal.lon).toBe(0)
    o.step(1, false, 15_000 + IDLE_BEFORE_SPIN_MS)
    expect(o.goal.lon).toBeGreaterThan(0)
  })

  it('does not turn when anchored or when motion is reduced', () => {
    const a = rig()
    a.setAnchored(true)
    a.step(5, false, 10 * IDLE_BEFORE_SPIN_MS)
    expect(a.goal.lon).toBe(0)
    const r = rig()
    r.step(5, true, 10 * IDLE_BEFORE_SPIN_MS)
    expect(r.goal.lon).toBe(0)
  })

  it('mission mode forces anchored (section 3.8, P4): isSpinning is false after 20 s idle', () => {
    const o = rig()
    // GlobeView calls setAnchored(useGlobe.anchored || mode === 'mission') every frame; mission mode alone is enough
    o.setAnchored(true)
    expect(o.isSpinning(IDLE_BEFORE_SPIN_MS)).toBe(false)
  })
})

describe('mission picking (section 3.8)', () => {
  it('south of 60° S sets the region centre; north of it is refused', () => {
    expect(missionPickOutcome(-84.79)).toBe('centre')
    expect(missionPickOutcome(-60)).toBe('centre')
    expect(missionPickOutcome(-59.9)).toBe('refused')
    expect(missionPickOutcome(10)).toBe('refused')
  })
})

describe('zoom toward the pointer', () => {
  const o = { lat: -48, lon: 10, dist: MOON_R_KM + 1000 }

  it('moves the centre toward the point by the share of height the zoom removes', () => {
    // height 1000 km -> 500 km: half the height removed, so half the way from -48 to -88 and from 10 to 30
    const z = zoomOrbitToward(o, 0.5, -88, 30)
    expect(z.dist).toBeCloseTo(MOON_R_KM + 500, 6)
    expect(z.lat).toBeCloseTo(-68, 6)
    expect(z.lon).toBeCloseTo(20, 6)
  })

  it('takes the short way round in longitude', () => {
    expect(zoomOrbitToward({ ...o, lon: 170 }, 0.5, -48, -170).lon).toBeCloseTo(180, 6)
  })

  it('does not move the centre when zooming out', () => {
    const z = zoomOrbitToward(o, 2, -88, 30)
    expect([z.lat, z.lon]).toEqual([-48, 10])
    expect(z.dist).toBeCloseTo(MOON_R_KM + 2000, 6)
  })
})

describe('tilted view of the globe', () => {
  const len = (v: number[]) => Math.hypot(v[0], v[1], v[2])
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

  it('without tilt is the old camera: straight above the place, north up', () => {
    const o = { lat: 20, lon: -30, dist: MOON_R_KM + 400 }
    const p = cameraPose(o)
    const above = latLonToScene(20, -30, o.dist)
    for (let i = 0; i < 3; i++) expect(p.position[i]).toBeCloseTo(above[i], 9)
    // looking at the surface point under it is looking at the Moon's centre
    const view = sub(p.target, p.position)
    expect(dot(view, p.position) / (len(view) * len(p.position))).toBeCloseTo(-1, 12)
    // north at the top: `up` points toward the north pole along the surface
    expect(dot(p.up, [0, 1, 0])).toBeGreaterThan(0.9)
    expect(dot(p.up, p.position)).toBeCloseTo(0, 9)
  })

  it('tilted, it keeps its distance to the place and looks along the heading', () => {
    const o = { lat: 0, lon: 0, dist: MOON_R_KM + 100 }
    // hand-worked: tilt 60°, heading 0 (north). 100 km from the target, 50 km above the sphere's tangent plane
    // there and 86.60 km behind it (to the south, −Y in the scene; the target is on +X at 1737.4).
    const p = cameraPose(o, 60, 0)
    expect(len(sub(p.position, p.target))).toBeCloseTo(100, 9)
    expect(p.position[0]).toBeCloseTo(MOON_R_KM + 50, 9)
    expect(p.position[1]).toBeCloseTo(-100 * Math.sin(Math.PI / 3), 9)
    expect(p.position[2]).toBeCloseTo(0, 9)
    // heading 90°: the same, behind it to the west (east is −Z in the scene, so the camera sits at +Z)
    const e = cameraPose(o, 60, 90)
    expect(e.position[1]).toBeCloseTo(0, 9)
    expect(e.position[2]).toBeCloseTo(100 * Math.sin(Math.PI / 3), 9)
  })

  it('turns and tilts within limits, drags along the screen and stays still while tilted', () => {
    const o = new OrbitRig({ lat: 0, lon: 0, dist: MOON_R_KM + 500 }, 0)
    o.rotate(0, 200, true)
    expect(o.view.tilt).toBe(MAX_TILT)
    expect(o.isSpinning(IDLE_BEFORE_SPIN_MS * 10)).toBe(false)
    o.resetView()
    o.step(1, true)
    expect(o.view).toEqual({ tilt: 0, heading: 0 })
    // facing east (heading 90), dragging the surface down the screen moves the view east, not north
    o.rotate(90, 0, true)
    o.drag(0, 50, 1000, 35, true)
    expect(o.goal.lat).toBeCloseTo(0, 9)
    expect(o.goal.lon).toBeGreaterThan(0)
  })
})

describe('near clipping plane', () => {
  const R = SURFACE_MAX_R_KM
  const len = (v: number[]) => Math.hypot(v[0], v[1], v[2])
  const unit = (v: number[]): [number, number, number] => [v[0] / len(v), v[1] / len(v), v[2] / len(v)]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

  it('straight down, it is the height above the outermost relief', () => {
    // hand-worked: camera 3000 km from the centre on +Y looking at the centre. Tangent bound 3000 - 1824.27 =
    // 1175.73 km; angle bound (3000 - 1824.27) x cos 20° = 1104.83 km. The larger one wins.
    expect(nearPlaneKm([0, 3000, 0], [0, -1, 0], Math.cos((20 * Math.PI) / 180))).toBeCloseTo(3000 - R, 9)
  })

  it('tilted from far out, it keeps the ground below the camera in front of the plane', () => {
    // the view that drew a black hole: 3500 km up, tilted to the 3D button's angle
    const p = cameraPose({ lat: -7, lon: 43, dist: MOON_R_KM + 3500 }, TILT_3D, 0)
    const axis = unit([p.target[0] - p.position[0], p.target[1] - p.position[1], p.target[2] - p.position[2]])
    // the highest ground straight below the camera, and how deep it lies along the view axis
    const below = unit(p.position).map((c) => c * R)
    const toBelow = [below[0] - p.position[0], below[1] - p.position[1], below[2] - p.position[2]]
    const depth = dot(toBelow, axis)
    // a view whose corner just reaches that point
    const cosOff = depth / len(toBelow)
    const near = nearPlaneKm(p.position, axis, cosOff)
    expect(near).toBeLessThanOrEqual(depth + 1e-6)
    // the old rule (distance from the centre minus 1.05 R) put the plane beyond it by tens of kilometres
    expect(len(p.position) - R - depth).toBeGreaterThan(10)
  })

  it('never goes under 1 km', () => {
    expect(nearPlaneKm([0, R - 10, 0], [0, -1, 0], 0.9)).toBe(1)
  })
})

describe('close-up view', () => {
  it('starts below NEAR_ENTER_KM and ends only above NEAR_LEAVE_KM', () => {
    // the whole Moon, and a first frame (nothing known yet), are not close up
    expect(isNearView(null, MOON_R_KM * 2.4)).toBe(false)
    expect(isNearView(false, NEAR_ENTER_KM + 1)).toBe(false)
    expect(isNearView(false, NEAR_ENTER_KM - 1)).toBe(true)
    // between the two heights it stays as it was, so a zoom hovering there does not flick between 2D and 3D
    const between = (NEAR_ENTER_KM + NEAR_LEAVE_KM) / 2
    expect(isNearView(true, between)).toBe(true)
    expect(isNearView(false, between)).toBe(false)
    expect(isNearView(true, NEAR_LEAVE_KM + 1)).toBe(false)
  })
})
