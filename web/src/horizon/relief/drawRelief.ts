/**
 * Puts the rendered relief (render.ts) on the horizon canvas: an offscreen buffer at device resolution once the
 * view is still ("fine"), or at about INTERACTIVE_COLUMNS columns while it moves, scaled up; then the mask's skyline
 * as a thin line, so the line the metrics use stays visible on the drawn ground.
 */
import type { Camera } from '../project'
import { wrap360 } from '../project'
import { type ReliefScene, renderRelief } from './render'

/** Columns rendered while the camera moves or time plays. */
const INTERACTIVE_COLUMNS = 640

let buffer: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData } | null = null

/** Last fine render's cost, for the tests and the console: columns, ray steps and milliseconds. */
export const reliefStats = { columns: 0, steps: 0, ms: 0 }

export function drawReliefGround(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  c: Camera,
  horizonAt: (az: number) => number,
  scene: ReliefScene,
  fine: boolean,
): boolean {
  if (typeof document === 'undefined') return false
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const scale = fine ? 1 / dpr : Math.max(1 / dpr, W / INTERACTIVE_COLUMNS)
  const w = Math.max(1, Math.ceil(W / scale))
  const h = Math.max(1, Math.ceil(H / scale))
  if (!buffer || buffer.image.width !== w || buffer.image.height !== h) {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const bctx = canvas.getContext('2d')
    if (!bctx) return false
    buffer = { canvas, ctx: bctx, image: bctx.createImageData(w, h) }
  }
  const t0 = performance.now()
  const steps = renderRelief(buffer.image, scale, c, horizonAt, scene)
  if (fine) Object.assign(reliefStats, { columns: w, steps, ms: performance.now() - t0 })
  buffer.ctx.putImageData(buffer.image, 0, 0)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(buffer.canvas, 0, 0, w * scale, h * scale)
  ctx.restore()

  // the mask's skyline, thin and faint
  const step = 2
  ctx.strokeStyle = 'rgba(241,238,232,0.32)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x <= W + step; x += step) {
    const az = wrap360(c.yaw + (x - c.cx) * c.degPerPx)
    const y = c.cy - (horizonAt(az) - c.pitch) / c.degPerPx
    if (x === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  return true
}
