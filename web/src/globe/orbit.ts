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
 * Exaggeration at a camera distance (km from the centre): x1 (true relief) up to 250 km above the surface, x4 from
 * 2 500 km, linear in between. Close in, the shading comes from 118 m heights while the mesh holds 21 km steps of
 * the 7.6 km grid; exaggerated steps would make the fine shading slide over them as the camera moves.
 */
export function reliefExaggeration(distKm: number): number {
  const t = (distKm - MOON_R_KM - 250) / (2_500 - 250)
  return 1 + (RELIEF_MAX - 1) * Math.max(0, Math.min(1, t))
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
    return !this.anchored && !this.diving && nowMs - this.lastInputMs >= IDLE_BEFORE_SPIN_MS
  }

  drag(dxPx: number, dyPx: number, viewHeightPx: number, fovDeg: number, immediate = false): void {
    this.touch()
    Object.assign(this.goal, dragOrbit(this.goal, dxPx, dyPx, viewHeightPx, fovDeg))
    if (immediate) Object.assign(this.now, { lat: this.goal.lat, lon: this.goal.lon })
  }

  zoom(factor: number): void {
    this.touch()
    Object.assign(this.goal, zoomOrbit(this.goal, factor))
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
  }
}
