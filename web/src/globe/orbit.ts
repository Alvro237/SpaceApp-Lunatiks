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

/** Drag: the surface follows the pointer (degrees per pixel shrink as the camera gets closer). */
export function dragOrbit(o: Orbit, dxPx: number, dyPx: number, viewHeightPx: number, fovDeg: number): Orbit {
  const visibleKm = 2 * (o.dist - MOON_R_KM) * Math.tan((fovDeg * DEG) / 2)
  const degPerPx = Math.min(0.5, (visibleKm / viewHeightPx / MOON_R_KM) / DEG)
  return { ...o, lon: o.lon - dxPx * degPerPx, lat: Math.max(-88, Math.min(88, o.lat + dyPx * degPerPx)) }
}

export function zoomOrbit(o: Orbit, factor: number): Orbit {
  const h = Math.max(MIN_DIST - MOON_R_KM, Math.min(MAX_DIST - MOON_R_KM, (o.dist - MOON_R_KM) * factor))
  return { ...o, dist: MOON_R_KM + h }
}

/**
 * Zoom in toward a point (degrees): the camera comes closer and its centre moves toward the point by the share of
 * the distance to the surface the zoom removes, so the place under the pointer stays near the pointer. Zooming out
 * (factor >= 1) does not move the centre.
 */
export function zoomOrbitToward(o: Orbit, factor: number, lat: number, lon: number): Orbit {
  const z = zoomOrbit(o, factor)
  const w = Math.max(0, 1 - (z.dist - MOON_R_KM) / (o.dist - MOON_R_KM))
  if (w === 0) return z
  const dLon = ((((lon - o.lon + 180) % 360) + 360) % 360) - 180
  return { dist: z.dist, lat: Math.max(-88, Math.min(88, o.lat + (lat - o.lat) * w)), lon: o.lon + dLon * w }
}

/** Steepest tilt of the camera away from straight down, degrees (at 90 it would look along the ground). */
export const MAX_TILT = 75
/** Tilt of the "3D" view, degrees (the polar map's own is 58). */
export const TILT_3D = 58

/**
 * Close-up view of the globe: closer than NEAR_ENTER_KM above the surface the view tilts into 3D by itself and the
 * finest detail tiles are loaded around the place in view, as the polar map does when zooming in over the south pole
 * opens it. 450 km is the height the polar map flies down to when it opens (terrain/TerrainView.tsx, mapEntry). It
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

/** Idle time after which the Moon starts turning by itself, ms. */
export const IDLE_BEFORE_SPIN_MS = 20_000
/** Slow turn: about two minutes a revolution. */
export const SPIN_DEG_PER_S = 3

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
  /** A dive toward a point of the polar cap; when it arrives, the map opens there. */
  private diving: [number, number] | null = null
  private fitted = false

  /**
   * First frame: the distance at which the whole Moon fills `fill` of the free area between the panels
   * (perspective: sin(angular radius) = R / distance).
   */
  fit(viewW: number, viewH: number, free: { left: number; right: number; top: number; bottom: number }, fovDeg: number, fill = 0.86): void {
    if (this.fitted || viewH <= 0) return
    this.fitted = true
    const freePx = Math.max(160, Math.min(viewW - free.left - free.right, viewH - free.top - free.bottom)) * fill
    const angular = Math.atan((freePx / viewH) * Math.tan(((fovDeg / 2) * Math.PI) / 180))
    const dist = Math.min(MAX_DIST, MOON_R_KM / Math.sin(angular))
    this.now.dist = dist
    this.goal.dist = dist
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

  /** True while the Moon is turning by itself. */
  isSpinning(nowMs = performance.now()): boolean {
    // a tilted or turned view is someone looking at a place: it stays put
    return !this.anchored && !this.diving && this.viewGoal.tilt < 1 && Math.abs(this.viewGoal.heading) < 1 && nowMs - this.lastInputMs >= IDLE_BEFORE_SPIN_MS
  }

  drag(dxPx: number, dyPx: number, viewHeightPx: number, fovDeg: number, immediate = false): void {
    this.touch()
    // the pointer moves on the screen, whose top is the heading: turn the movement into east and north
    const c = Math.cos(this.view.heading * DEG)
    const s = Math.sin(this.view.heading * DEG)
    Object.assign(this.goal, dragOrbit(this.goal, dxPx * c - dyPx * s, dxPx * s + dyPx * c, viewHeightPx, fovDeg))
    if (immediate) Object.assign(this.now, { lat: this.goal.lat, lon: this.goal.lon })
  }

  /** Tilt the view (0 = straight down, up to MAX_TILT). */
  setTilt(tiltDeg: number): void {
    this.touch()
    this.viewGoal.tilt = Math.max(0, Math.min(MAX_TILT, tiltDeg))
  }

  /** Turn the view around the place under it and tilt it, by these degrees. */
  rotate(dHeadingDeg: number, dTiltDeg = 0, immediate = false): void {
    this.touch()
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
    this.touch()
    Object.assign(this.goal, zoomOrbit(this.goal, factor))
  }

  zoomToward(factor: number, lat: number, lon: number): void {
    this.touch()
    Object.assign(this.goal, zoomOrbitToward(this.goal, factor, lat, lon))
  }

  turnTo(lat: number, lon: number): void {
    this.touch()
    Object.assign(this.goal, { lat: Math.max(-88, Math.min(88, lat)), lon })
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
    if (!reducedMotion && this.isSpinning(nowMs)) this.goal.lon += SPIN_DEG_PER_S * dt
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 6)
    const n = this.now
    const g = this.goal
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
