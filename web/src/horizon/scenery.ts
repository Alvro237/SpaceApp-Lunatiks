/**
 * Scenery of the first-person horizon view: the star field and the ground.
 *
 * Stars are real: every naked-eye star of the Yale Bright Star Catalogue where it stands over this horizon at the
 * chosen instant (stars.ts), sized by magnitude and tinted by colour index. They hide behind the terrain like the
 * Sun and the Earth do.
 *
 * The ground is the real LOLA relief lit by the Sun (relief/). While it is still arriving only a plain dark ground
 * is drawn below the real skyline (the site's horizon mask): no invented craters, bands or photo texture that would
 * look like terrain and then jump to the real one.
 */
import { type Camera, wrap180, wrap360 } from './project'
import { STARS, starColour } from './stars'
import { drawReliefGround } from './relief/drawRelief'
import type { ReliefScene } from './relief/render'

// ------------------------------------------------------------------------------------------------- stars

/** Faintest star drawn at the widest field, and at a narrow one (zooming in shows fainter stars). */
const MAG_LIMIT_WIDE = 4.6
const MAG_LIMIT_NARROW = 5.5

const COLOURS = STARS.map((s) => starColour(s.bv))

/** `dirs`: azimuth, elevation of every catalogue star (stars.ts starDirections). */
export function drawStars(ctx: CanvasRenderingContext2D, W: number, H: number, c: Camera, dirs: Float32Array): void {
  const fov = c.degPerPx * W
  const limit = MAG_LIMIT_NARROW - (MAG_LIMIT_NARROW - MAG_LIMIT_WIDE) * Math.min(1, Math.max(0, (fov - 30) / 90))
  for (let i = 0; i < STARS.length; i++) {
    const mag = STARS[i].vmag
    if (mag > limit) break // catalogue order: brightest first
    const x = c.cx + wrap180(dirs[2 * i] - c.yaw) / c.degPerPx
    const y = c.cy - (dirs[2 * i + 1] - c.pitch) / c.degPerPx
    if (x < -8 || x > W + 8 || y < -8 || y > H + 8) continue
    // brightness: 2.512 per magnitude, compressed for the screen; radius grows gently, the rest goes into opacity
    const b = Math.pow(10, -0.4 * (mag - 1)) // 1 at magnitude 1
    const r = Math.min(3.4, 0.55 + 0.95 * Math.pow(b, 0.38))
    const alpha = Math.min(1, 0.28 + 0.75 * Math.pow(b, 0.45))
    const [cr, cg, cb] = COLOURS[i]
    if (mag < 1.6) {
      // the brightest two dozen: a soft halo and a four-point sparkle
      const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 4.5)
      halo.addColorStop(0, `rgba(${cr},${cg},${cb},0.42)`)
      halo.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(x, y, r * 4.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.55)`
      ctx.lineWidth = 0.8
      const arm = r * 3.2
      ctx.beginPath()
      ctx.moveTo(x - arm, y)
      ctx.lineTo(x + arm, y)
      ctx.moveTo(x, y - arm)
      ctx.lineTo(x, y + arm)
      ctx.stroke()
    }
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

// ------------------------------------------------------------------------------------------------- ground

const RIM = '#f1eef9'
/** The plain ground drawn while the relief loads: dark, slightly lighter at the skyline. */
const WAIT_TOP = '#2a2a33'
const WAIT_BOTTOM = '#0d0d12'

export interface GroundScene {
  horizonAt: (az: number) => number
  /** Visible fraction of the solar disc, 0..1 (draw.ts Body.fraction). Kept for the callers; the plain ground ignores it. */
  daylight?: number
  /** Real LOLA relief around the place (relief/): drawn instead of the plain ground when present. */
  relief?: { scene: ReliefScene; fine: boolean } | null
}

/** The real relief when it is there; otherwise a plain dark ground under the real skyline with its bright rim. */
export function drawGround(ctx: CanvasRenderingContext2D, W: number, H: number, c: Camera, s: GroundScene): void {
  if (s.relief && drawReliefGround(ctx, W, H, c, s.horizonAt, s.relief.scene, s.relief.fine)) return
  const step = 2
  const n = Math.floor(W / step) + 2
  const yOf = (el: number) => c.cy - (el - c.pitch) / c.degPerPx
  const ys = new Float64Array(n)
  let top = H
  for (let i = 0; i < n; i++) {
    ys[i] = yOf(s.horizonAt(wrap360(c.yaw + (i * step - c.cx) * c.degPerPx)))
    top = Math.min(top, ys[i])
  }
  const g = ctx.createLinearGradient(0, Math.min(top, H - 1), 0, H)
  g.addColorStop(0, WAIT_TOP)
  g.addColorStop(1, WAIT_BOTTOM)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(0, H)
  for (let i = 0; i < n; i++) ctx.lineTo(i * step, ys[i])
  ctx.lineTo(W, H)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = RIM
  ctx.lineWidth = 1.6
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    if (i === 0) ctx.moveTo(0, ys[i])
    else ctx.lineTo(i * step, ys[i])
  }
  ctx.stroke()
}
