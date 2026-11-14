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
