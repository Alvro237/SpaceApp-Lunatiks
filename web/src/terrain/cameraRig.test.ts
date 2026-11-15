import { describe, expect, it } from 'vitest'
import { APPROACH_DIST_KM, APPROACH_TILT, CameraRig } from './cameraRig'
import { type Tileset, polarXY } from './tileset'

const ts = { extentM: [-931_200, -931_200, 931_200, 931_200], discRadiusM: 931_200 } as unknown as Tileset

describe('CameraRig.approach', () => {
  it('flies to the place, low and tilted, and faces the local azimuth', () => {
    const rig = new CameraRig(ts)
    const before = { ...rig.goal }
    // at longitude 0, local north points away from the pole (+y on the map, heading 0) and east is +x (heading 90°)
    const back = rig.approach(-85, 0, 90)
    const [x, y] = polarXY(-85, 0)
    expect(rig.goal.tx).toBeCloseTo(x / 1000, 6)
    expect(rig.goal.tz).toBeCloseTo(-y / 1000, 6)
    expect(rig.goal.dist).toBe(APPROACH_DIST_KM)
    expect(rig.goal.tilt).toBe(APPROACH_TILT)
    expect(rig.goal.heading).toBeCloseTo(Math.PI / 2, 9)
    expect(back).toEqual(before)
  })

  it('turns local azimuths with the longitude (the map is conformal)', () => {
    const rig = new CameraRig(ts)
    // at 90° E, local north is +x on the map (heading 90°); local west then points to +y (heading 0)
    rig.approach(-85, 90, 0)
    expect(rig.goal.heading).toBeCloseTo(Math.PI / 2, 9)
    rig.approach(-85, 90, 270)
    expect(rig.goal.heading).toBeCloseTo(0, 9)
  })

  it('turns the short way and flies back with restore', () => {
    const rig = new CameraRig(ts)
    rig.goal.heading = 2 * Math.PI - 0.1
    const back = rig.approach(-85, 0, 10)
    expect(Math.abs(rig.goal.heading - (2 * Math.PI - 0.1))).toBeLessThan(Math.PI)
    rig.restore(back)
    expect(rig.goal.heading).toBeCloseTo(2 * Math.PI - 0.1, 9)
    expect(rig.goal.tilt).toBe(0)
  })
})

describe('CameraRig.frameCircle', () => {
  // the free area between the panels at 1440 x 900 in mission mode (planner left, results right, timeline below)
  const insets = { left: 330, right: 410, top: 57, bottom: 118 }
  const pxRadius = (rig: CameraRig, radiusKm: number, h: number) => radiusKm / rig.kmPerPixel(h)

  it('fits the whole region, centred, top-down, into the free area', () => {
    const rig = new CameraRig(ts)
    rig.fitHome(1440, 900, insets)
    rig.frameCircle(-85.5, 30, 20)
    const [x, y] = polarXY(-85.5, 30)
    expect(rig.goal.tx).toBeCloseTo(x / 1000, 6)
    expect(rig.goal.tz).toBeCloseTo(-y / 1000, 6)
    expect(rig.goal.tilt).toBe(0)
    const free = Math.min(1440 - 330 - 410, 900 - 57 - 118) // 700 px wide, 725 px tall: the width limits
    expect(pxRadius(rig, 20, 900)).toBeCloseTo((0.7 * free) / 2, 6) // the ring's diameter is 70 % of it (room for the map tools)
    expect(2 * pxRadius(rig, 20, 900)).toBeLessThan(free)
  })

  it('scales with the radius and waits for the first view size', () => {
    const rig = new CameraRig(ts)
    rig.frameCircle(-88, 0, 100) // no view yet: applied on the first fit
    rig.fitHome(1280, 720, insets)
    const free = Math.min(1280 - 330 - 410, 720 - 57 - 118)
    expect(pxRadius(rig, 100, 720)).toBeCloseTo((0.7 * free) / 2, 6)
    expect(rig.goal.tilt).toBe(0)
  })
})
