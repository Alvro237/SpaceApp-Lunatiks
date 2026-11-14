/**
 * Camera controller of the map. The view is a target point on the map, a distance, a tilt (0 = straight
 * down, the top-down view) and a heading. Input moves a goal; every frame the camera eases toward it (or
 * jumps, when the system asks for reduced motion). Scene units are kilometres; −Z is map north (longitude 0).
 */
import * as THREE from 'three'
import type { Insets } from '../state/layout'
import { type Tileset, polarXY } from './tileset'

export const FOV_DEG = 40
export const TILT_3D = THREE.MathUtils.degToRad(58)
const MAX_TILT = THREE.MathUtils.degToRad(80)

export interface View {
  tx: number
  tz: number
  dist: number
  tilt: number
  heading: number
}

export const forward = (h: number) => new THREE.Vector3(Math.sin(h), 0, -Math.cos(h))
export const right = (h: number) => new THREE.Vector3(Math.cos(h), 0, Math.sin(h))

export class CameraRig {
  readonly now: View
  readonly goal: View
  private readonly home: View
  /** Set by the scene: screen fraction (0..1, 0..1) → lat/lon on the terrain, or null. */
  private picker: ((cx: number, cy: number) => [number, number] | null) | null = null

  private readonly discKm: number
  private fitted = false
  /** A fly-to requested before the first fit (entering from the globe); applied after it. */
  private pending: Partial<View> | null = null

  /** Distance of the whole-pole view. */
  get homeDist(): number {
    return this.home.dist
  }

  constructor(ts: Tileset) {
    const half = (ts.extentM[2] - ts.extentM[0]) / 2000
    this.discKm = (ts.discRadiusM ?? half * 1000) / 1000
    this.home = { tx: 0, tz: 0, dist: (half / Math.tan(THREE.MathUtils.degToRad(FOV_DEG / 2))) * 1.08, tilt: 0, heading: 0 }
    this.now = { ...this.home }
    this.goal = { ...this.home }
  }

  /**
   * The whole polar disc, top-down, fitted into the free area between the panels. The first fit also places the
   * camera there; later fits (panels opened or closed, window resized) only update what Reset returns to.
   */
  fitHome(viewW: number, viewH: number, insets: Insets): void {
    const free = Math.max(120, Math.min(viewW - insets.left - insets.right, viewH - insets.top - insets.bottom)) * 0.96
    const dist = (this.discKm * viewH) / (free * Math.tan(THREE.MathUtils.degToRad(FOV_DEG / 2)))
    Object.assign(this.home, { tx: 0, tz: 0, dist, tilt: 0, heading: 0 })
    if (!this.fitted) {
      this.fitted = true
      Object.assign(this.now, this.home)
      Object.assign(this.goal, this.home, this.pending ?? {})
      this.pending = null
    }
  }

  kmPerPixel(viewportHeightPx: number): number {
    return (2 * this.goal.dist * Math.tan(THREE.MathUtils.degToRad(FOV_DEG / 2))) / viewportHeightPx
  }

  /** Move the map by a screen offset in pixels (drag right → the map follows the pointer). */
  pan(dxPx: number, dyPx: number, viewportHeightPx: number, immediate = false): void {
    const k = this.kmPerPixel(viewportHeightPx)
    const d = right(this.goal.heading).multiplyScalar(-dxPx * k).add(forward(this.goal.heading).multiplyScalar(dyPx * k))
    this.goal.tx += d.x
    this.goal.tz += d.z
    if (immediate) {
      this.now.tx = this.goal.tx
      this.now.tz = this.goal.tz
    }
  }

  zoom(factor: number): void {
    this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * factor, 2, this.home.dist * 2.2)
  }

  rotate(dHeading: number, dTilt = 0, immediate = false): void {
    this.goal.heading += dHeading
    this.goal.tilt = THREE.MathUtils.clamp(this.goal.tilt + dTilt, 0, MAX_TILT)
    if (immediate) {
      this.now.heading = this.goal.heading
      this.now.tilt = this.goal.tilt
    }
  }

  setTilt(tilt: number): void {
    this.goal.tilt = tilt
  }

  reset(): void {
    Object.assign(this.goal, { ...this.home, tilt: this.goal.tilt })
  }

  flyTo(lat: number, lon: number, maxDistKm = 140): void {
    const [x, y] = polarXY(lat, lon)
    this.goal.tx = x / 1000
    this.goal.tz = -y / 1000
    this.goal.dist = Math.min(this.goal.dist, maxDistKm)
    if (!this.fitted) this.pending = { tx: this.goal.tx, tz: this.goal.tz, dist: maxDistKm }
  }

  /** Set by the scene: CSS pixel → the place drawn there, or null. */
  markerAt: (px: number, py: number) => unknown = () => null

  setMarkerPicker(fn: (px: number, py: number) => unknown): void {
    this.markerAt = fn
  }

  setPicker(fn: (cx: number, cy: number) => [number, number] | null): void {
    this.picker = fn
  }

  pick(cx: number, cy: number): [number, number] | null {
    return this.picker?.(cx, cy) ?? null
  }

  /** Ease toward the goal; returns nothing, mutates `now`. */
  step(dt: number, reducedMotion: boolean): void {
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 7)
    const n = this.now
    const g = this.goal
    n.tx += (g.tx - n.tx) * k
    n.tz += (g.tz - n.tz) * k
    n.dist *= Math.exp(Math.log(g.dist / n.dist) * k)
    n.tilt += (g.tilt - n.tilt) * k
    n.heading += (g.heading - n.heading) * k
  }

  /**
   * Place a perspective camera looking at the target, which sits at height `targetY` (scene km). The target is
   * drawn at the centre of the free area (a view offset of the projection), not at the centre of the window.
   */
  apply(cam: THREE.PerspectiveCamera, targetY: number, viewW: number, viewH: number, insets: Insets): void {
    const cx = insets.left + (viewW - insets.left - insets.right) / 2
    const cy = insets.top + (viewH - insets.top - insets.bottom) / 2
    cam.setViewOffset(viewW, viewH, viewW / 2 - cx, viewH / 2 - cy, viewW, viewH)
    const n = this.now
    const f = forward(n.heading)
    cam.position.set(n.tx, targetY, n.tz).addScaledVector(f, -n.dist * Math.sin(n.tilt))
    cam.position.y += n.dist * Math.cos(n.tilt)
    cam.up.copy(f)
    cam.lookAt(n.tx, targetY, n.tz)
    cam.near = Math.max(0.02, n.dist * 0.01)
    cam.far = n.dist * 6 + 3000
    cam.updateProjectionMatrix()
  }
}
