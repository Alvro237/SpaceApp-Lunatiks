/**
 * Ground view (docs/horizon-view-plan.md, Layer B): the terrain tiles seen by an observer standing on the surface,
 * drawn under the first-person horizon view where fine tiles exist.
 *
 * The horizon view is not a perspective picture: one pixel is the same angle across and up (horizon/project.ts), so
 * the azimuth and elevation scales read directly. The tiles therefore are not drawn with a perspective camera
 * either. Each vertex is turned into the direction the observer sees it in (azimuth, elevation) on the real sphere,
 * and that direction is put on the screen with the horizon view's own formula. The 3D relief, the skyline mask, the
 * Sun and Earth discs and the scales then agree pixel for pixel.
 *
 * Direction of a terrain point P (height h above the 1737.4 km sphere, R) from an observer O (height ho, eye
 * included), with θ the angle between them at the Moon's centre:
 *
 *   elevation = atan2( (h − ho) − (R + h) · 2 sin²(θ / 2),  (R + h) · sin θ )
 *
 * which is the API's skyline formula atan2(R_s cos θ − R_o, R_s sin θ) (api/app/logic/horizon.py) rearranged so that
 * the two large radii are never subtracted (32-bit floats on the GPU). The Moon's curvature is exact: far relief
 * sinks below the horizon by itself. θ and the azimuth come from the point's unit vector in the observer's local
 * east / north / up frame; within a few kilometres, where 32-bit unit vectors are too coarse (0.2 m), they come from
 * the map offsets divided by the projection's scale at the observer (the projection is conformal).
 *
 * `groundDirection` and `groundScreen` below are the TypeScript twins of the vertex shader's ground branch
 * (shaders.ts, GROUND_VERT_CHUNK): same steps, same order, in double precision. The unit tests check the twins
 * against known geometry; the shader is checked on screen against the skyline mask.
 */
import * as THREE from 'three'
import { R_M, type TileKey, type Tileset, keyOf, polarXY } from './tileset'

const DEG = Math.PI / 180

/** Finest cell size (m) that makes the ground view worth drawing (plan B1). */
export const GROUND_MAX_CELL_M = 240
/** Triangles with a vertex farther than this from the view's azimuth are not drawn (they would wrap around the screen). */
export const BEHIND_DEG = 110
/** Distances over which the direction switches from the map offsets to the unit vectors, metres. */
export const NEAR_BLEND_M: [number, number] = [1500, 4000]
/** Depth range of the ground view, metres (log depth). */
export const DEPTH_RANGE_M: [number, number] = [1, 400_000]

/** What the horizon view shows, as the 2D canvas has it (horizon/project.ts `Camera`) plus the canvas size. */
export interface GroundScreen {
  yaw: number
  pitch: number
  degPerPx: number
  cx: number
  cy: number
  width: number
  height: number
}

export interface GroundObserver {
  /** Map position, metres (south polar stereographic). */
  x: number
  y: number
  /** Height of the eye above the 1737.4 km sphere, metres (ground + 2 m). */
  eyeM: number
}

/** Local frame of the observer on the sphere, in the shader's axes (x: lon 0, y: lon 90 E, z: north pole). */
export interface ObserverFrame {
  east: [number, number, number]
  north: [number, number, number]
  up: [number, number, number]
  /** Scale of the projection at the observer: map distance = scale × ground distance. */
  scale: number
  /** Unit vectors of local east and north on the map (x, y). */
  eastMap: [number, number]
  northMap: [number, number]
}

/** Unit vector of a map point on the sphere: the vertex shader's formula (no trigonometry). */
export function unitOfMap(x: number, y: number): [number, number, number] {
  const r = Math.hypot(x, y)
  const t = r / (2 * R_M)
  const k = 1 / (1 + t * t)
  const cosLat = 2 * t * k
  const sinLat = -(1 - t * t) * k
  const cl = r > 0 ? y / r : 1
  const sl = r > 0 ? x / r : 0
  return [cosLat * cl, cosLat * sl, sinLat]
}

export function observerFrame(x: number, y: number): ObserverFrame {
  const r = Math.hypot(x, y)
  const t = r / (2 * R_M)
  const k = 1 / (1 + t * t)
  const cosLat = 2 * t * k
  const sinLat = -(1 - t * t) * k
  const cl = r > 0 ? y / r : 1
  const sl = r > 0 ? x / r : 0
  return {
    east: [-sl, cl, 0],
    north: [-sinLat * cl, -sinLat * sl, cosLat],
    up: [cosLat * cl, cosLat * sl, sinLat],
    scale: 1 + t * t,
    // on the south polar map north points away from the pole and east is a quarter turn clockwise from it
    eastMap: [cl, -sl],
    northMap: [sl, cl],
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** Direction (degrees) and straight-line distance (m) of a terrain point seen by the observer. */
export function groundDirection(obs: GroundObserver, frame: ObserverFrame, x: number, y: number, heightM: number): { az: number; el: number; distM: number } {
  const dx = x - obs.x
  const dy = y - obs.y
  // sin θ × (east, north): near, from the map offsets; far, from the unit vectors
  const nearE = (dx * frame.eastMap[0] + dy * frame.eastMap[1]) / frame.scale / R_M
  const nearN = (dx * frame.northMap[0] + dy * frame.northMap[1]) / frame.scale / R_M
  const u = unitOfMap(x, y)
  const w = smoothstep(NEAR_BLEND_M[0], NEAR_BLEND_M[1], Math.hypot(nearE, nearN) * R_M)
  const e = nearE + (dot3(u, frame.east) - nearE) * w
  const n = nearN + (dot3(u, frame.north) - nearN) * w
  const sinT = Math.min(1, Math.hypot(e, n))
  const theta = Math.asin(sinT)
  const half = Math.sin(theta / 2)
  const rs = R_M + heightM
  const vertical = heightM - obs.eyeM - rs * 2 * half * half
  const horizontal = rs * sinT
  return {
    az: (((Math.atan2(e, n) / DEG) % 360) + 360) % 360,
    el: Math.atan2(vertical, horizontal) / DEG,
    distM: Math.hypot(vertical, horizontal),
  }
}

const wrap180 = (a: number) => {
  const w = ((((a + 180) % 360) + 360) % 360) - 180
  return w === -180 ? 180 : w
}

/** Where that direction falls on the horizon view's canvas (CSS pixels), its depth (0 near .. 1 far) and whether it is behind. */
export function groundScreen(s: GroundScreen, az: number, el: number, distM: number): { x: number; y: number; depth: number; behind: boolean } {
  const dAz = wrap180(az - s.yaw)
  const depth = Math.min(1, Math.max(0, Math.log(Math.max(distM, DEPTH_RANGE_M[0]) / DEPTH_RANGE_M[0]) / Math.log(DEPTH_RANGE_M[1] / DEPTH_RANGE_M[0])))
  return { x: s.cx + dAz / s.degPerPx, y: s.cy - (el - s.pitch) / s.degPerPx, depth, behind: Math.abs(dAz) > BEHIND_DEG }
}

// ------------------------------------------------------------------------------------------- where it is available

/** The deepest tile of the tileset that contains a map point, or null outside it. */
export function finestTileAt(ts: Pick<Tileset, 'extentM' | 'levels' | 'height'>, x: number, y: number): TileKey | null {
  const [x0, , x1, y1] = ts.extentM
  const size = x1 - x0
  if (x < x0 || x > x1 || y > y1 || y < y1 - size) return null
  let best: TileKey | null = null
  for (let z = 0; z < ts.levels.length; z++) {
    const n = 2 ** z
    const t = { z, x: Math.min(n - 1, Math.floor(((x - x0) / size) * n)), y: Math.min(n - 1, Math.floor(((y1 - y) / size) * n)) }
    if (!(keyOf(t) in ts.height.tiles)) break
    best = t
  }
  return best
}

/** True where the tileset (static levels, or live ones when it was extended with them) reaches 240 m cells or finer. */
export function terrainHorizonAvailable(ts: Pick<Tileset, 'extentM' | 'levels' | 'height'> | null | undefined, lat: number, lon: number): boolean {
  if (!ts || lat >= 0) return false
  const [x, y] = polarXY(lat, lon)
  const t = finestTileAt(ts, x, y)
  return !!t && ts.levels[t.z].cellM <= GROUND_MAX_CELL_M
}

// ------------------------------------------------------------------------------------------- tile selection

/** Finest cells the ground view asks for, metres: finer levels are megabytes of live tiles for a few pixels of ground. */
export const GROUND_MIN_CELL_M = 25
/** Margin added around the view when choosing tiles, degrees (the flat scene has no curvature and is exaggerated). */
const SELECT_MARGIN_DEG = 8

/**
 * A perspective camera that stands where the observer stands in the map's flat scene and looks where the view looks:
 * only for choosing tiles (which are in view, how fine). Returns the viewport height in pixels to give the level of
 * detail, so that one pixel is the view's own angle per pixel.
 */
export function selectionCamera(cam: THREE.PerspectiveCamera, obs: GroundObserver, frame: ObserverFrame, s: GroundScreen, groundSceneKm: number): number {
  const top = s.pitch + s.cy * s.degPerPx
  const bottom = s.pitch - (s.height - s.cy) * s.degPerPx
  const fovY = Math.min(150, top - bottom + 2 * SELECT_MARGIN_DEG)
  const halfH = Math.min(85, (s.width * s.degPerPx) / 2 + SELECT_MARGIN_DEG)
  const mid = Math.max(-80, Math.min(80, (top + bottom) / 2))
  cam.fov = fovY
  cam.aspect = Math.tan(halfH * DEG) / Math.tan((fovY / 2) * DEG)
  cam.near = 0.0005
  cam.far = 5000
  cam.position.set(obs.x / 1000, groundSceneKm + 0.002, -obs.y / 1000)
  // view direction on the map (x, y) → scene (x, −y); elevation tilts it up
  const a = s.yaw * DEG
  const mx = Math.sin(a) * frame.eastMap[0] + Math.cos(a) * frame.northMap[0]
  const my = Math.sin(a) * frame.eastMap[1] + Math.cos(a) * frame.northMap[1]
  const ce = Math.cos(mid * DEG)
  cam.up.set(0, 1, 0)
  cam.lookAt(cam.position.x + mx * ce, cam.position.y + Math.sin(mid * DEG), cam.position.z - my * ce)
  cam.updateProjectionMatrix()
  cam.updateMatrixWorld()
  return fovY / s.degPerPx
}
