/**
 * Ground view geometry (ground.ts): the TypeScript twins of the vertex shader's ground branch against known cases
 * (plan B6: a flat Moon puts the horizon at the geometric dip; a hill appears at its exact angle), the compass
 * conventions against the projection, the screen mapping against the horizon view's own, and where the view is
 * available. The GLSL itself needs a GPU: it is checked on screen against the skyline mask.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { cameraFor, project } from '../horizon/project'
import {
  BEHIND_DEG,
  type GroundScreen,
  finestTileAt,
  groundDirection,
  groundScreen,
  observerFrame,
  selectionCamera,
  terrainHorizonAvailable,
  unitOfMap,
} from './ground'
import { R_M, polarXY } from './tileset'

const DEG = Math.PI / 180

/** A map point at a ground distance and azimuth from an observer, by the great-circle formula. */
function destination(lat: number, lon: number, azDeg: number, distM: number): [number, number] {
  const d = distM / R_M
  const la = lat * DEG
  const sinLat = Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(azDeg * DEG)
  const lat2 = Math.asin(sinLat)
  const lon2 = lon * DEG + Math.atan2(Math.sin(azDeg * DEG) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * sinLat)
  return polarXY(lat2 / DEG, lon2 / DEG)
}

/** The API's skyline formula (api/app/logic/horizon.py). */
const apiElevation = (h: number, distM: number, eyeM: number) => {
  const th = distM / R_M
  return Math.atan2((R_M + h) * Math.cos(th) - (R_M + eyeM), (R_M + h) * Math.sin(th)) / DEG
}

describe('direction of a terrain point from the ground', () => {
  const lat = -85.5
  const lon = 31
  const [ox, oy] = polarXY(lat, lon)
  const frame = observerFrame(ox, oy)
  const obs = { x: ox, y: oy, eyeM: 1200 + 2 }

  it('has an orthonormal local frame that matches the sphere', () => {
    const u = unitOfMap(ox, oy)
    expect(u[0]).toBeCloseTo(Math.cos(lat * DEG) * Math.cos(lon * DEG), 12)
    expect(u[1]).toBeCloseTo(Math.cos(lat * DEG) * Math.sin(lon * DEG), 12)
    expect(u[2]).toBeCloseTo(Math.sin(lat * DEG), 12)
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    expect(dot(frame.east, frame.north)).toBeCloseTo(0, 12)
    expect(dot(frame.east, frame.up)).toBeCloseTo(0, 12)
    expect(dot(frame.north, frame.up)).toBeCloseTo(0, 12)
    expect(frame.north[2]).toBeGreaterThan(0) // north points to the north pole
    expect(frame.scale).toBeCloseTo(1 / Math.cos(((90 + lat) * DEG) / 2) ** 2, 12)
  })

  it.each([0, 45, 90, 180, 270, 333])('sees a point at azimuth %i° at that azimuth, near and far', (az) => {
    for (const dist of [30, 800, 2500, 6000, 40_000, 150_000]) {
      const [x, y] = destination(lat, lon, az, dist)
      const d = groundDirection(obs, frame, x, y, 1200)
      const err = Math.abs(((d.az - az + 540) % 360) - 180)
      // the map offsets (near) are exact to first order in distance / R; the unit vectors (far) are exact
      expect(err).toBeLessThan(dist < 5000 ? 0.15 : 0.01)
    }
  })

  it('puts a hill at the angle of the API formula: atan(h / d) minus the curvature', () => {
    for (const [h, dist] of [
      [1300, 500],
      [1500, 3000],
      [2700, 20_000],
      [4000, 120_000],
      [1200, 200_000],
    ]) {
      const [x, y] = destination(lat, lon, 70, dist)
      const d = groundDirection(obs, frame, x, y, h)
      expect(d.el).toBeCloseTo(apiElevation(h, dist, obs.eyeM), dist < 5000 ? 2 : 4)
    }
    // hand value: 1500 m above the eye at 20 km: atan(1500 / 20000) - 20 / (2 x 1737.4) rad = 4.29 - 0.33 degrees
    const [x, y] = destination(lat, lon, 10, 20_000)
    expect(groundDirection(obs, frame, x, y, obs.eyeM + 1500).el).toBeCloseTo(Math.atan(1500 / 20_000) / DEG - (20 / (2 * 1737.4)) / DEG, 1)
  })

  it('puts the horizon of a smooth Moon at the geometric dip, 0.09° for a 2 m eye', () => {
    const eye = { x: ox, y: oy, eyeM: 2 }
    let best = -90
    for (let dist = 50; dist < 30_000; dist += 25) {
      const [x, y] = destination(lat, lon, 200, dist)
      best = Math.max(best, groundDirection(eye, frame, x, y, 0).el)
    }
    const dip = -Math.acos(R_M / (R_M + 2)) / DEG
    expect(best).toBeCloseTo(dip, 3)
    expect(dip).toBeCloseTo(-0.0869, 3)
    // and the ground at the observer's feet is straight down
    expect(groundDirection(eye, frame, ox, oy, 0).el).toBeCloseTo(-90, 6)
  })
})

describe('screen of the ground view', () => {
  const s: GroundScreen = { yaw: 300, pitch: 4, degPerPx: 0.07, cx: 520, cy: 400, width: 1280, height: 760 }

  it('is the horizon view’s own projection', () => {
    const c = cameraFor(s.yaw, s.pitch, s.degPerPx * 1000, 1000, s.cx, s.cy)
    expect(c.degPerPx).toBeCloseTo(s.degPerPx, 12)
    for (const [az, el] of [
      [300, 4],
      [310.5, -2],
      [250, 12],
      [20, 0],
    ]) {
      const a = groundScreen(s, az, el, 5000)
      const b = project(c, az, el)
      expect(a.x).toBeCloseTo(b.x, 9)
      expect(a.y).toBeCloseTo(b.y, 9)
    }
  })

  it('orders depth by distance and flags what is behind', () => {
    const near = groundScreen(s, 300, 0, 10)
    const far = groundScreen(s, 300, 0, 100_000)
    expect(near.depth).toBeGreaterThanOrEqual(0)
    expect(far.depth).toBeLessThanOrEqual(1)
    expect(near.depth).toBeLessThan(far.depth)
    expect(groundScreen(s, s.yaw + BEHIND_DEG - 1, 0, 100).behind).toBe(false)
    expect(groundScreen(s, s.yaw + BEHIND_DEG + 1, 0, 100).behind).toBe(true)
    expect(groundScreen(s, s.yaw - 179, 0, 100).behind).toBe(true)
  })

  it('aims the tile-selection camera where the view looks', () => {
    const [ox, oy] = polarXY(-85.5, 31)
    const frame = observerFrame(ox, oy)
    const cam = new THREE.PerspectiveCamera()
    for (const yaw of [0, 90, 215]) {
      const px = selectionCamera(cam, { x: ox, y: oy, eyeM: 1202 }, frame, { ...s, yaw, pitch: 0, cy: 380 }, 1.2)
      expect(px).toBeCloseTo(cam.fov / s.degPerPx, 9)
      const dir = cam.getWorldDirection(new THREE.Vector3())
      // a point 10 km away at that azimuth, in scene coordinates (x, −y)
      const [tx, ty] = destination(-85.5, 31, yaw, 10_000)
      const want = new THREE.Vector3(tx - ox, 0, -(ty - oy)).normalize()
      expect(dir.clone().setY(0).normalize().angleTo(want) / DEG).toBeLessThan(0.5)
    }
    expect(cam.position.y).toBeCloseTo(1.202, 6)
  })
})

describe('where the ground view is available', () => {
  // a 2 000 km square; levels of 960, 480 and 240 m cells; the fine levels only in the tiles around the pole
  const ts = {
    extentM: [-983_040, -983_040, 983_040, 983_040] as [number, number, number, number],
    levels: [0, 1, 2, 3, 4, 5].map((z) => ({ z, tiles: 2 ** z, cellM: 7680 / 2 ** z })),
    height: { path: '', encoding: '', sources: [], tiles: {} as Record<string, [number, number]> },
  }
  for (let z = 0; z <= 3; z++) for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) ts.height.tiles[`${z}/${x}/${y}`] = [0, 1]
  for (const z of [4, 5]) for (let x = 2 ** z / 2 - 2; x < 2 ** z / 2 + 2; x++) for (let y = 2 ** z / 2 - 2; y < 2 ** z / 2 + 2; y++) ts.height.tiles[`${z}/${x}/${y}`] = [0, 1]

  it('finds the deepest tile at a point', () => {
    expect(finestTileAt(ts, 1000, 1000)).toEqual({ z: 5, x: 16, y: 15 })
    expect(finestTileAt(ts, 800_000, 100)).toEqual({ z: 3, x: 7, y: 3 })
    expect(finestTileAt(ts, 2_000_000, 0)).toBeNull()
  })

  it('needs 240 m cells or finer at the point', () => {
    expect(terrainHorizonAvailable(ts, -89.9, 10)).toBe(true) // 240 m cells around the pole
    expect(terrainHorizonAvailable(ts, -70, 10)).toBe(false) // 960 m cells only
    expect(terrainHorizonAvailable(ts, 20, 10)).toBe(false) // not on the south polar map
    expect(terrainHorizonAvailable(null, -89.9, 10)).toBe(false) // no terrain engine (the globe)
    // the static tileset of a build without the 80 m DEM: 960 m everywhere
    const coarse = { ...ts, levels: ts.levels.slice(0, 4) }
    expect(terrainHorizonAvailable(coarse, -89.9, 10)).toBe(false)
  })
})
