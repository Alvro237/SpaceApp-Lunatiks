/**
 * Globe geometry. Scene units are kilometres; the scene axes are the Moon Mean-Earth axes turned so that north is
 * up: sceneX = x_ME (toward longitude 0), sceneY = z_ME (north pole), sceneZ = −y_ME. A proper rotation, so the
 * Sun vectors of the ephemeris tables map straight in.
 */
export const MOON_R_KM = 1737.4
const DEG = Math.PI / 180

export type Vec3 = [number, number, number]

export const meToScene = (x: number, y: number, z: number): Vec3 => [x, z, -y]

/** Point at latitude/longitude (degrees) and radius r, in scene coordinates. */
export function latLonToScene(lat: number, lon: number, r = MOON_R_KM): Vec3 {
  const cl = Math.cos(lat * DEG)
  return meToScene(r * cl * Math.cos(lon * DEG), r * cl * Math.sin(lon * DEG), r * Math.sin(lat * DEG))
}

export function sceneToLatLon(p: Vec3): [number, number] {
  const [x, y, z] = [p[0], -p[2], p[1]]
  const r = Math.hypot(x, y, z)
  return [Math.asin(z / r) / DEG, Math.atan2(y, x) / DEG]
}

/** First intersection of a ray with the sphere centred at the origin, or null. */
export function raySphere(origin: Vec3, dir: Vec3, r = MOON_R_KM): Vec3 | null {
  const b = origin[0] * dir[0] + origin[1] * dir[1] + origin[2] * dir[2]
  const c = origin[0] ** 2 + origin[1] ** 2 + origin[2] ** 2 - r * r
  const disc = b * b - c
  if (disc < 0) return null
  const t = -b - Math.sqrt(disc)
  if (t < 0) return null
  return [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t]
}

/** Orbit around the Moon: the camera looks at the centre from (lat, lon) at `dist` km from the centre. */
export interface Orbit {
  lat: number
  lon: number
  dist: number
}

/** Closest the camera comes: 50 km above the 1737.4 km sphere (the detail tiles' finest cells, 83 m, fill the view). */
export const MIN_DIST = MOON_R_KM + 50
export const MAX_DIST = MOON_R_KM * 8

/** Relief exaggeration of the globe's mesh: x4 when the camera is high enough to see the whole Moon. */
export const RELIEF_MAX = 4
/**
 * Exaggeration close in: x2, the polar map's default (terrain/TerrainView.tsx), so the ground reads as 3D in a tilted
 * view anywhere on the Moon, as it does on the map. Close in, the patches around the view (patch.ts) carry the 118 m
 * detail heights, so the fine shading follows the lifted ground; true relief (x1) looked flat in tilted views.
 */
export const RELIEF_MIN = 2
/**
 * Exaggeration at a camera distance (km from the centre): RELIEF_MIN up to 250 km above the surface, RELIEF_MAX from
 * 2 500 km, linear in between.
 */
export function reliefExaggeration(distKm: number): number {
  const t = (distKm - MOON_R_KM - 250) / (2_500 - 250)
  return RELIEF_MIN + (RELIEF_MAX - RELIEF_MIN) * Math.max(0, Math.min(1, t))
}

/**
 * Closest the centre of the view comes to a pole, degrees of latitude. Movement is worked out on the sphere (below),
 * so this only keeps longitude and north defined: 0.05° is 1.5 km from the pole.
 */
export const POLE_LAT_LIMIT = 89.95

type V3 = [number, number, number]
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unitAt = (lat: number, lon: number): V3 => [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)]
const eastAt = (lon: number): V3 => [-Math.sin(lon * DEG), Math.cos(lon * DEG), 0]
const northAt = (lat: number, lon: number): V3 => [-Math.sin(lat * DEG) * Math.cos(lon * DEG), -Math.sin(lat * DEG) * Math.sin(lon * DEG), Math.cos(lat * DEG)]

/**
 * Move the centre of the view over the sphere by `eastKm` and `northKm` (along the great circle in that direction)
 * and carry the heading with it (parallel transport): the screen keeps its orientation relative to the ground, so a
 * pan straight across a pole goes on in the same screen direction instead of spinning the view round. Longitude is
 * unwrapped (no jump of 360°) so the camera eases the short way. Mean-Earth axes; pure.
 */
export function moveOnSphere(lat: number, lon: number, headingDeg: number, eastKm: number, northKm: number): { lat: number; lon: number; heading: number } {
  const dist = Math.hypot(eastKm, northKm)
  if (!(dist > 0)) return { lat, lon, heading: headingDeg }
  const c = unitAt(lat, lon)
  const e = eastAt(lon)
  const n = northAt(lat, lon)
  const d: V3 = [(e[0] * eastKm + n[0] * northKm) / dist, (e[1] * eastKm + n[1] * northKm) / dist, (e[2] * eastKm + n[2] * northKm) / dist]
  const h = headingDeg * DEG
  const a: V3 = [n[0] * Math.cos(h) + e[0] * Math.sin(h), n[1] * Math.cos(h) + e[1] * Math.sin(h), n[2] * Math.cos(h) + e[2] * Math.sin(h)]
  // b = c × d is fixed by the rotation; a = α d + β b
  const b: V3 = [c[1] * d[2] - c[2] * d[1], c[2] * d[0] - c[0] * d[2], c[0] * d[1] - c[1] * d[0]]
  const alpha = dot3(a, d)
  const beta = dot3(a, b)
  const th = dist / MOON_R_KM
  const c2: V3 = [c[0] * Math.cos(th) + d[0] * Math.sin(th), c[1] * Math.cos(th) + d[1] * Math.sin(th), c[2] * Math.cos(th) + d[2] * Math.sin(th)]
  const d2: V3 = [d[0] * Math.cos(th) - c[0] * Math.sin(th), d[1] * Math.cos(th) - c[1] * Math.sin(th), d[2] * Math.cos(th) - c[2] * Math.sin(th)]
  const a2: V3 = [alpha * d2[0] + beta * b[0], alpha * d2[1] + beta * b[1], alpha * d2[2] + beta * b[2]]
  const lat2 = Math.max(-POLE_LAT_LIMIT, Math.min(POLE_LAT_LIMIT, Math.asin(Math.max(-1, Math.min(1, c2[2]))) / DEG))
  const rawLon = Math.hypot(c2[0], c2[1]) > 1e-12 ? Math.atan2(c2[1], c2[0]) / DEG : lon
  const lon2 = lon + (((((rawLon - lon + 180) % 360) + 360) % 360) - 180)
  const heading2 = Math.atan2(dot3(a2, eastAt(lon2)), dot3(a2, northAt(lat2, lon2))) / DEG
  return { lat: lat2, lon: lon2, heading: headingDeg + (((((heading2 - headingDeg + 180) % 360) + 360) % 360) - 180) }
}

/** Great-circle distance between two points, km, and the direction from the first to the second (east, north km). */
function towards(lat: number, lon: number, toLat: number, toLon: number): { km: number; east: number; north: number } {
  const c = unitAt(lat, lon)
  const p = unitAt(toLat, toLon)
  const ang = Math.acos(Math.max(-1, Math.min(1, dot3(c, p))))
  const east = dot3(p, eastAt(lon))
  const north = dot3(p, northAt(lat, lon))
  const len = Math.hypot(east, north)
  return len > 1e-12 ? { km: ang * MOON_R_KM, east: east / len, north: north / len } : { km: 0, east: 0, north: 0 }
}

/**
 * Drag: the surface follows the pointer. `dxPx`, `dyPx` are the pointer's movement on the screen, whose top is the
 * heading; the centre moves the other way on the ground, by the kilometres a pixel spans (at most 0.5° a pixel).
 */
export function dragOrbit(o: Orbit, headingDeg: number, dxPx: number, dyPx: number, viewHeightPx: number, fovDeg: number): { orbit: Orbit; heading: number } {
  const visibleKm = 2 * (o.dist - MOON_R_KM) * Math.tan((fovDeg * DEG) / 2)
  const kmPerPx = Math.min(0.5 * DEG * MOON_R_KM, visibleKm / viewHeightPx)
  const c = Math.cos(headingDeg * DEG)
  const s = Math.sin(headingDeg * DEG)
  // the ground follows the pointer, so the centre moves against it: screen right is heading + 90°, screen down is
  // heading + 180° (a drag down the screen moves the centre toward the heading)
  const east = (-dxPx * c + dyPx * s) * kmPerPx
  const north = (dxPx * s + dyPx * c) * kmPerPx
  const m = moveOnSphere(o.lat, o.lon, headingDeg, east, north)
  return { orbit: { lat: m.lat, lon: m.lon, dist: o.dist }, heading: m.heading }
}

export function zoomOrbit(o: Orbit, factor: number): Orbit {
  const h = Math.max(MIN_DIST - MOON_R_KM, Math.min(MAX_DIST - MOON_R_KM, (o.dist - MOON_R_KM) * factor))
  return { ...o, dist: MOON_R_KM + h }
}

/**
 * Zoom in toward a point (degrees): the camera comes closer and its centre moves toward the point, along the great
 * circle, by the share of the distance to the surface the zoom removes, so the place under the pointer stays near
 * the pointer (over a pole too). The heading is carried along (moveOnSphere). Zooming out (factor >= 1) does not move
 * the centre.
 */
export function zoomOrbitToward(o: Orbit, factor: number, lat: number, lon: number, headingDeg = 0): Orbit & { heading: number } {
  const z = zoomOrbit(o, factor)
  const w = Math.max(0, 1 - (z.dist - MOON_R_KM) / (o.dist - MOON_R_KM))
  if (w === 0) return { ...z, heading: headingDeg }
  const t = towards(o.lat, o.lon, lat, lon)
  const m = moveOnSphere(o.lat, o.lon, headingDeg, t.east * t.km * w, t.north * t.km * w)
  return { dist: z.dist, lat: m.lat, lon: m.lon, heading: m.heading }
}

/** Steepest tilt of the camera away from straight down, degrees (at 90 it would look along the ground). */
export const MAX_TILT = 75
/** Tilt of the "3D" view, degrees (the polar map's own is 58). */
export const TILT_3D = 58

/**
 * Close-up view of the globe: closer than NEAR_ENTER_KM above the surface the view tilts into 3D by itself and the
 * finest detail tiles are loaded around the place in view, the south pole included. 450 km is the height the polar map flies down to when it opens (terrain/TerrainView.tsx, mapEntry). It
 * goes back to the straight 2D view above NEAR_LEAVE_KM: the gap keeps a zoom that hovers near one value from
 * flicking between the two.
 */
export const NEAR_ENTER_KM = 450
export const NEAR_LEAVE_KM = 700

/** Whether the camera, `altitudeKm` above the surface, is in the close-up view, given whether it was (null: unknown). */
export function isNearView(wasNear: boolean | null, altitudeKm: number): boolean {
  return altitudeKm < (wasNear ? NEAR_LEAVE_KM : NEAR_ENTER_KM)
}

/**
 * Where the camera is and what it looks at, in scene kilometres. The camera looks at the point of the sphere under
 * the orbit's centre from `dist − R` away. With no tilt it is straight above it, north up: the view of the whole
 * Moon. Tilted, it swings down around that point, away from the heading (degrees clockwise from north), so the
 * ground stretches toward the horizon in that direction; `up` keeps the heading at the top of the screen.
 */
export function cameraPose(o: Orbit, tiltDeg = 0, headingDeg = 0): { position: Vec3; target: Vec3; up: Vec3 } {
  const lat = o.lat * DEG
  const lon = o.lon * DEG
  const radial = latLonToScene(o.lat, o.lon, 1)
  const north = meToScene(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat))
  const east = meToScene(-Math.sin(lon), Math.cos(lon), 0)
  const ch = Math.cos(headingDeg * DEG)
  const sh = Math.sin(headingDeg * DEG)
  const ahead: Vec3 = [north[0] * ch + east[0] * sh, north[1] * ch + east[1] * sh, north[2] * ch + east[2] * sh]
  const h = o.dist - MOON_R_KM
  const up = MOON_R_KM + h * Math.cos(tiltDeg * DEG)
  const back = h * Math.sin(tiltDeg * DEG)
  return {
    position: [radial[0] * up - ahead[0] * back, radial[1] * up - ahead[1] * back, radial[2] * up - ahead[2] * back],
    target: [radial[0] * MOON_R_KM, radial[1] * MOON_R_KM, radial[2] * MOON_R_KM],
    up: ahead,
  }
}

/** Every point of the surface, exaggerated relief included, lies within this radius (km): LOLA heights span about
 * -9 to +11 km, times RELIEF_MAX is under 45 km. */
export const SURFACE_MAX_R_KM = MOON_R_KM * 1.05

/**
 * Near clipping distance (km) that leaves the whole visible surface in front of the near plane. The plane clips by
 * depth along the view axis, not by distance: a point `d` km away at an angle θ off the axis is `d cos θ` deep. A
 * tilted camera far out sees the ground below itself well off the axis, and a near plane set from the distance alone
 * (|camera| − 1.05 R) cut a hole there. Two lower bounds of the depth of any surface point the camera can see, the
 * larger one is used:
 *   - distance ≥ |camera| − R_max, and inside the view θ ≤ θ_max, so depth ≥ (|camera| − R_max) cos θ_max;
 *   - the sphere of radius R_max lies beyond the plane tangent to it across the view axis:
 *     depth ≥ (−camera · axis) − R_max.
 * `axis` is the unit view direction; `cosMaxOffAxis` the cosine of the widest angle between it and a corner of the
 * view. Never under 1 km.
 */
export function nearPlaneKm(camera: Vec3, axis: Vec3, cosMaxOffAxis: number, rMax = SURFACE_MAX_R_KM): number {
  const fromCentre = Math.hypot(camera[0], camera[1], camera[2])
  const byAngle = (fromCentre - rMax) * cosMaxOffAxis
  const byTangent = -(camera[0] * axis[0] + camera[1] * axis[1] + camera[2] * axis[2]) - rMax
  return Math.max(1, byAngle, byTangent)
}

/** South of here a region centre is accepted (mission mode, section 3.8); the search covers the south polar grids. */
export const REGION_MIN_LAT = -60

/**
 * In mission mode, a click at this latitude either sets the region centre (south of `regionMinLat`) or is
 * refused with a toast ("The search covers south of 60° S") that leaves the centre unchanged. Pure decision
 * shared by the globe's and the map's click handlers, so it can be tested without a WebGL canvas.
 */
export function missionPickOutcome(lat: number, regionMinLat = REGION_MIN_LAT): 'centre' | 'refused' {
  return lat <= regionMinLat ? 'centre' : 'refused'
}

/** Length of a flight (flyTo), seconds. */
export const FLIGHT_S = 1.6

const easeInOut = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/**
 * Where a flight is after `t` of `FLIGHT_S` seconds. Across the Moon first, then down: the place slides under the
 * camera over the first 70 % of the time while the height comes down over the last 80 %, eased in and out. The height
 * above the surface falls geometrically (log-linear), so each second covers the same share of it and the ground does
 * not rush up at the end. `tilt` is the share of the change of tilt done: it follows the descent's second half, so
 * the view leans into 3D only as it nears the ground.
 */
export function flightAt(from: Orbit, to: Orbit, t: number): { orbit: Orbit; tilt: number } {
  const x = t / FLIGHT_S
  const across = easeInOut(clamp01(x / 0.7))
  const down = easeInOut(clamp01((x - 0.2) / 0.8))
  const dLon = ((((to.lon - from.lon + 180) % 360) + 360) % 360) - 180
  const h0 = Math.max(1, from.dist - MOON_R_KM)
  const h1 = Math.max(1, to.dist - MOON_R_KM)
  return {
    orbit: { lat: from.lat + (to.lat - from.lat) * across, lon: from.lon + dLon * across, dist: MOON_R_KM + h0 * (h1 / h0) ** down },
    tilt: easeInOut(clamp01((x - 0.5) / 0.5)),
  }
}

/** Idle time after which the Moon starts turning by itself, ms. */
export const IDLE_BEFORE_SPIN_MS = 20_000
/** Slow turn: about two minutes a revolution. */
export const SPIN_DEG_PER_S = 3
/** Cinematic mode's turn: about a minute a revolution (the slow one when the system asks for reduced motion). */
export const CINEMA_DEG_PER_S = 6
/** In cinematic mode the turn picks up again this soon after a drag or a zoom, ms. */
export const CINEMA_IDLE_MS = 1500
/** Cinematic mode frames the whole Moon from a little south of the equator, so the south pole shows. */
export const CINEMA_LAT = -15
/** Share of the window's smaller side the Moon fills in cinematic mode. */
const CINEMA_FILL = 0.8

/**
 * Distance from the Moon's centre at which the whole Moon fills `fill` of the free area between the panels
 * (perspective: sin(angular radius) = R / distance; the field of view is vertical).
 */
export function wholeMoonDist(viewW: number, viewH: number, free: { left: number; right: number; top: number; bottom: number }, fovDeg: number, fill: number): number {
  const freePx = Math.max(160, Math.min(viewW - free.left - free.right, viewH - free.top - free.bottom)) * fill
  const angular = Math.atan((freePx / Math.max(1, viewH)) * Math.tan(((fovDeg / 2) * Math.PI) / 180))
  return Math.min(MAX_DIST, MOON_R_KM / Math.sin(angular))
}

/**
 * Camera controller of the globe: input moves a goal, the camera eases toward it every frame. When nobody has
 * touched the Moon for IDLE_BEFORE_SPIN_MS it turns slowly by itself (unless anchored, or motion is reduced).
 */
export class OrbitRig {
  readonly now: Orbit
  readonly goal: Orbit
  /** Tilt away from straight down and heading (clockwise from north), degrees: where they are and where they go. */
  readonly view = { tilt: 0, heading: 0 }
  readonly viewGoal = { tilt: 0, heading: 0 }
  /** When true the Moon never turns by itself. */
  private anchored = false
  private lastInputMs = 0
  /** A flight under way (flyTo): from where, its start tilt and heading, and the time flown, s. */
  private flight: { from: Orbit; tilt: number; heading: number; t: number } | null = null
  /** A dive toward a point of the polar cap (mission mode); when it arrives, the map opens there. */
  private diving: [number, number] | null = null
  private fitted = false
  /** Cinematic mode: the whole Moon, turning by itself whatever the anchor (setCinematic). */
  private cinematic = false

  /**
   * First frame: the distance at which the whole Moon fills `fill` of the free area between the panels
   * (perspective: sin(angular radius) = R / distance).
   */
  fit(viewW: number, viewH: number, free: { left: number; right: number; top: number; bottom: number }, fovDeg: number, fill = 0.86): void {
    if (this.fitted || viewH <= 0) return
    this.fitted = true
    const dist = wholeMoonDist(viewW, viewH, free, fovDeg, fill)
    this.now.dist = dist
    this.goal.dist = dist
  }

  /**
   * Cinematic mode on: back to the whole Moon, straight down and north up, then it turns by itself (a drag or a zoom
   * pauses the turn for CINEMA_IDLE_MS). Off: the Moon stays where it is and the usual idle rules apply again.
   */
  setCinematic(on: boolean, viewW: number, viewH: number, fovDeg: number): void {
    if (on === this.cinematic) return
    this.cinematic = on
    if (!on) return this.touch()
    this.diving = null
    this.resetView()
    // the mode has the whole window to itself (on a phone the map was only part of it until now)
    this.flyTo(CINEMA_LAT, this.goal.lon, wholeMoonDist(viewW, viewH, { left: 0, right: 0, top: 0, bottom: 0 }, fovDeg, CINEMA_FILL))
  }

  get isCinematic(): boolean {
    return this.cinematic
  }

  /** Set by the scene: CSS pixel → the place drawn there, or null. */
  markerAt: (px: number, py: number) => unknown = () => null

  setMarkerPicker(fn: (px: number, py: number) => unknown): void {
    this.markerAt = fn
  }

  constructor(start: Orbit, nowMs = performance.now()) {
    this.now = { ...start }
    this.goal = { ...start }
    this.lastInputMs = nowMs
  }

  setAnchored(anchored: boolean): void {
    this.anchored = anchored
  }

  /** Any touch of the Moon (drag, zoom, key, pick, flight) restarts the idle timer. */
  touch(nowMs = performance.now()): void {
    this.lastInputMs = nowMs
  }

  /** Taking the controls ends a flight where it is; the camera then eases to the new goal as usual. */
  private takeOver(): void {
    this.touch()
    this.flight = null
  }

  get isFlying(): boolean {
    return this.flight !== null
  }

  /** True while the Moon is turning by itself. */
  isSpinning(nowMs = performance.now()): boolean {
    if (this.cinematic) return !this.flight && !this.diving && nowMs - this.lastInputMs >= CINEMA_IDLE_MS
    // a tilted or turned view is someone looking at a place: it stays put
    return !this.anchored && !this.flight && !this.diving && this.viewGoal.tilt < 1 && Math.abs(this.viewGoal.heading) < 1 && nowMs - this.lastInputMs >= IDLE_BEFORE_SPIN_MS
  }

  drag(dxPx: number, dyPx: number, viewHeightPx: number, fovDeg: number, immediate = false): void {
    this.takeOver()
    const m = dragOrbit(this.goal, this.viewGoal.heading, dxPx, dyPx, viewHeightPx, fovDeg)
    Object.assign(this.goal, m.orbit)
    this.viewGoal.heading = m.heading
    if (immediate) {
      Object.assign(this.now, { lat: this.goal.lat, lon: this.goal.lon })
      this.view.heading = m.heading
    }
  }

  /** Tilt the view (0 = straight down, up to MAX_TILT). */
  setTilt(tiltDeg: number): void {
    this.touch()
    this.viewGoal.tilt = Math.max(0, Math.min(MAX_TILT, tiltDeg))
  }

  /** Turn the view around the place under it and tilt it, by these degrees. */
  rotate(dHeadingDeg: number, dTiltDeg = 0, immediate = false): void {
    this.takeOver()
    this.viewGoal.heading += dHeadingDeg
    this.viewGoal.tilt = Math.max(0, Math.min(MAX_TILT, this.viewGoal.tilt + dTiltDeg))
    if (immediate) Object.assign(this.view, this.viewGoal)
  }

  /** North up and straight down again (the nearest way round). */
  resetView(): void {
    this.touch()
    this.viewGoal.tilt = 0
    this.viewGoal.heading = Math.round(this.viewGoal.heading / 360) * 360
  }

  zoom(factor: number): void {
    this.takeOver()
    Object.assign(this.goal, zoomOrbit(this.goal, factor))
  }

  zoomToward(factor: number, lat: number, lon: number): void {
    this.takeOver()
    const z = zoomOrbitToward(this.goal, factor, lat, lon, this.viewGoal.heading)
    Object.assign(this.goal, { lat: z.lat, lon: z.lon, dist: z.dist })
    this.viewGoal.heading = z.heading
  }

  turnTo(lat: number, lon: number): void {
    this.takeOver()
    Object.assign(this.goal, { lat: Math.max(-POLE_LAT_LIMIT, Math.min(POLE_LAT_LIMIT, lat)), lon })
  }

  /**
   * Fly to a point at a distance from the centre (km) in FLIGHT_S seconds (flightAt): across, then down, the tilt
   * following the descent. Any drag, zoom or turn ends it.
   */
  flyTo(lat: number, lon: number, dist: number): void {
    this.touch()
    this.flight = { from: { ...this.now }, tilt: this.view.tilt, heading: this.view.heading, t: 0 }
    Object.assign(this.goal, { lat: Math.max(-POLE_LAT_LIMIT, Math.min(POLE_LAT_LIMIT, lat)), lon, dist: Math.max(MIN_DIST, Math.min(MAX_DIST, dist)) })
  }

  dive(lat: number, lon: number, dist: number): void {
    this.touch()
    this.diving = [lat, lon]
    Object.assign(this.goal, { lat: Math.max(-88, lat), lon, dist })
  }

  /** The dive target once the camera has arrived (then cleared), else null. */
  arrived(): [number, number] | null {
    if (!this.diving || Math.abs(this.now.dist - this.goal.dist) > MOON_R_KM * 0.02) return null
    const d = this.diving
    this.diving = null
    return d
  }

  get isDiving(): boolean {
    return this.diving !== null
  }

  step(dt: number, reducedMotion: boolean, nowMs = performance.now()): void {
    // cinematic mode was asked for, so it turns even with reduced motion, but only at the slow idle speed
    if (this.isSpinning(nowMs) && (this.cinematic || !reducedMotion)) this.goal.lon += (this.cinematic && !reducedMotion ? CINEMA_DEG_PER_S : SPIN_DEG_PER_S) * dt
    const n = this.now
    const g = this.goal
    const f = this.flight
    if (f) {
      this.touch(nowMs)
      f.t = reducedMotion ? FLIGHT_S : f.t + dt
      const at = flightAt(f.from, g, f.t)
      Object.assign(n, at.orbit)
      this.view.tilt = f.tilt + (this.viewGoal.tilt - f.tilt) * at.tilt
      this.view.heading = f.heading + (this.viewGoal.heading - f.heading) * at.tilt
      if (f.t >= FLIGHT_S) this.flight = null
      return
    }
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 6)
    const dLon = ((((g.lon - n.lon + 180) % 360) + 360) % 360) - 180
    n.lon += dLon * k
    n.lat += (g.lat - n.lat) * k
    n.dist += (g.dist - n.dist) * k
    this.view.tilt += (this.viewGoal.tilt - this.view.tilt) * k
    this.view.heading += (this.viewGoal.heading - this.view.heading) * k
    // once it has arrived, keep the heading within a turn
    if (Math.abs(this.viewGoal.heading - this.view.heading) < 1e-3 && Math.abs(this.viewGoal.heading) >= 360) {
      this.viewGoal.heading %= 360
      this.view.heading = this.viewGoal.heading
    }
  }
}
