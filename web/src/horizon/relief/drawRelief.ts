/**
 * Puts the rendered relief (render.ts) on the horizon canvas: an offscreen buffer at device resolution once the
 * view is still ("fine"), or at fewer columns while it moves (as many as fit in a frame's budget, INTERACTIVE_MS, between
 * MIN_COLUMNS and INTERACTIVE_COLUMNS), scaled up; then the mask's skyline
 * as a thin line where it stands in the sky above the drawn ground (the line the metrics use; where the drawn ground
 * rises above it the line is hidden, as a real skyline would be).
 */
import type { Camera } from '../project'
import { wrap360 } from '../project'
import { type ReliefScene, renderRelief } from './render'

/** Most columns rendered while the camera moves or time plays. */
const INTERACTIVE_COLUMNS = 640
/** Fewest columns while it moves: below this the ground turns to blocks. */
const MIN_COLUMNS = 240
/**
 * Time a moving frame's relief may take, ms. The relief is ray cast on the main thread, so its cost is the frame's:
 * past about 16 ms the drag stutters. The column count follows the measured cost (it scales with the pixel count).
 */
const INTERACTIVE_MS = 14

interface Buffer {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  image: ImageData
}
/**
 * One buffer for the fine pass and one for the moving pass: they differ in size, and sharing one reallocated it (tens
 * of megabytes at device resolution) every time the view stopped or started moving.
 */
const buffers: { fine: Buffer | null; moving: Buffer | null } = { fine: null, moving: null }
/** Columns of the moving pass, adjusted to INTERACTIVE_MS after each moving frame. */
let movingColumns = INTERACTIVE_COLUMNS

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
  const scale = fine ? 1 / dpr : Math.max(1 / dpr, W / movingColumns)
  const w = Math.max(1, Math.ceil(W / scale))
  const h = Math.max(1, Math.ceil(H / scale))
  const kind = fine ? 'fine' : 'moving'
  let buffer = buffers[kind]
  if (!buffer || buffer.image.width !== w || buffer.image.height !== h) {
    const canvas = buffer?.canvas ?? document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const bctx = canvas.getContext('2d')
    if (!bctx) return false
    buffer = buffers[kind] = { canvas, ctx: bctx, image: bctx.createImageData(w, h) }
  }
  const t0 = performance.now()
  const steps = renderRelief(buffer.image, scale, c, horizonAt, scene)
  const ms = performance.now() - t0
  if (fine) Object.assign(reliefStats, { columns: w, steps, ms })
  else if (ms > 0) {
    // cost goes with the pixels, columns squared: aim the next moving frame at the budget, a step at a time
    const ideal = movingColumns * Math.sqrt(INTERACTIVE_MS / ms)
    movingColumns = Math.round(Math.min(INTERACTIVE_COLUMNS, Math.max(MIN_COLUMNS, movingColumns + 0.5 * (ideal - movingColumns))))
  }
  buffer.ctx.putImageData(buffer.image, 0, 0)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(buffer.canvas, 0, 0, w * scale, h * scale)
  ctx.restore()

  // the mask's skyline, thin and faint, only where it is in the sky (no ground drawn just under it)
  const step = 2
  const data = buffer.image.data
  const groundAt = (x: number, y: number) => {
    const i = Math.min(w - 1, Math.max(0, Math.floor(x / scale)))
    const j = Math.floor((y + 1.5) / scale)
    return j >= 0 && j < h && data[4 * (j * w + i) + 3] > 0 && j > 0 && data[4 * ((j - 1) * w + i) + 3] > 0
  }
  ctx.strokeStyle = 'rgba(241,238,232,0.32)'
  ctx.lineWidth = 1
  ctx.beginPath()
  let pen = false
  for (let x = 0; x <= W + step; x += step) {
    const az = wrap360(c.yaw + (x - c.cx) * c.degPerPx)
    const y = c.cy - (horizonAt(az) - c.pitch) / c.degPerPx
    // hidden where the drawn ground covers the line and the row above it
    if (groundAt(x, y - 3)) {
      pen = false
      continue
    }
    if (!pen) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
    pen = true
  }
  ctx.stroke()
  return true
}
