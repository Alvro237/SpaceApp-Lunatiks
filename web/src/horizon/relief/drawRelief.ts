/**
 * Puts the rendered relief (render.ts) on the horizon canvas, then the mask's skyline as a thin line where it stands
 * in the sky above the drawn ground (the line the metrics use; where the drawn ground rises above it the line is
 * hidden, as a real skyline would be).
 *
 * Two passes. The ray casting runs on the main thread, so its cost is the frame's:
 *   - fine: device resolution, built a slice of columns a frame (FINE_SLICE_MS) for the camera and the scene of the
 *     moment the build started, then shown. It is rendered MARGIN_PX wider on every side, and the projection is linear
 *     (one CSS pixel is the same number of degrees across and up), so the last finished image still fits a camera
 *     that has turned a little since: it is shifted by the turn. Following the Sun or the Earth while time plays, the
 *     view stays sharp and a new image follows a few frames behind, with the light of its own instant.
 *   - moving: fewer columns (as many as fit in INTERACTIVE_MS, between MIN_COLUMNS and INTERACTIVE_COLUMNS), scaled
 *     up; drawn when no finished image fits (a fast drag, a zoom, a new scene, the arrival descent).
 */
import type { Camera } from '../project'
import { wrap180, wrap360 } from '../project'
import { type ReliefScene, renderRelief } from './render'

/** Most columns rendered by the moving pass. */
const INTERACTIVE_COLUMNS = 640
/** Fewest columns of the moving pass: below this the ground turns to blocks. */
const MIN_COLUMNS = 240
/** Time the moving pass may take in a frame, ms: past about 16 ms a drag stutters. Its columns follow its cost. */
const INTERACTIVE_MS = 14
/** Time the fine pass may take in a frame, ms (a slice of columns at a time). */
const FINE_SLICE_MS = 9
/** Columns rendered between two looks at the clock. */
const SLICE_COLUMNS = 16
/** Extra ground rendered around the fine image on every side, CSS px: how far the camera may turn and still use it. */
const MARGIN_PX = 48

interface Buffer {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  image: ImageData
}

function sized(b: Buffer | null, w: number, h: number): Buffer | null {
  if (b && b.image.width === w && b.image.height === h) return b
  const canvas = b?.canvas ?? document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  return ctx ? { canvas, ctx, image: ctx.createImageData(w, h) } : null
}

/** A fine image, finished or being built: the camera it is rendered for and its scene. */
interface Fine {
  buf: Buffer
  /** The view's camera when it was started (the screen's, without the margin). */
  cam: Camera
  W: number
  H: number
  scale: number
  scene: ReliefScene
  horizonAt: (az: number) => number
  /** Next column to render (while building). */
  next: number
}

let moving: Buffer | null = null
let front: Fine | null = null
let building: Fine | null = null
/** The buffer of the image shown before the last one, reused for the next build. */
let spare: Buffer | null = null
/** Columns of the moving pass, adjusted to INTERACTIVE_MS after each moving frame. */
let movingColumns = INTERACTIVE_COLUMNS
let pending = false

/** Last fine image's cost, for the tests and the console: columns, ray steps and milliseconds (all its slices). */
export const reliefStats = { columns: 0, steps: 0, ms: 0 }

/** True while a fine image is still being built or does not match the camera yet: the caller draws again next frame. */
export const reliefPending = () => pending

/** Same projection (field, size, centre): an image differs from the screen by a turn only. */
const sameView = (f: Fine, c: Camera, W: number, H: number) =>
  f.W === W && f.H === H && f.cam.degPerPx === c.degPerPx && f.cam.cx === c.cx && f.cam.cy === c.cy
/** Where an image made for f.cam lies on the screen of camera c, CSS px (linear projection). */
const shiftOf = (f: Fine, c: Camera) => ({ dx: wrap180(f.cam.yaw - c.yaw) / c.degPerPx, dy: (c.pitch - f.cam.pitch) / c.degPerPx })
const within = (s: { dx: number; dy: number }) => Math.abs(s.dx) <= MARGIN_PX && Math.abs(s.dy) <= MARGIN_PX
const isZero = (s: { dx: number; dy: number }) => Math.abs(s.dx) < 0.01 && Math.abs(s.dy) < 0.01

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

  // the finished fine image, if it fits this camera with a shift inside its margin
  let shown: Fine | null = null
  let shift = { dx: 0, dy: 0 }
  // (another scene, such as the light of a later instant while time plays, still fits: it is shown until the image of
  // the new scene is built, which a scene that changes every frame would otherwise never let finish)
  const fits = (f: Fine | null): f is Fine => !!f && sameView(f, c, W, H) && within(shiftOf(f, c))
  if (fine && fits(front)) {
    shown = front
    shift = shiftOf(front, c)
  }

  if (!fine) building = null
  else {
    // a build that no longer fits (another field or size, or turned past its margin) starts again for this camera
    if (building && !fits(building)) building = null
    let fresh = false
    const current = !!shown && isZero(shift) && shown.scene === scene
    if (!building && !current) {
      const scale = 1 / dpr
      const buf = sized(spare, Math.ceil((W + 2 * MARGIN_PX) / scale), Math.ceil((H + 2 * MARGIN_PX) / scale))
      if (!buf) return false
      spare = buf
      building = { buf, cam: { ...c }, W, H, scale, scene, horizonAt, next: 0 }
      reliefStats.steps = 0
      reliefStats.ms = 0
      fresh = true
    }
    // A build started while nothing finished fits (a drag past the margins, a zoom) waits a frame: if the camera keeps
    // moving it would be thrown away, and its slices would only slow the drag.
    const b = building
    if (b && !(fresh && !shown && front)) {
      const cam = { ...b.cam, cx: b.cam.cx + MARGIN_PX, cy: b.cam.cy + MARGIN_PX }
      const w = b.buf.image.width
      const t0 = performance.now()
      while (b.next < w && performance.now() - t0 < FINE_SLICE_MS) {
        const i1 = Math.min(w, b.next + SLICE_COLUMNS)
        reliefStats.steps += renderRelief(b.buf.image, b.scale, cam, b.horizonAt, b.scene, b.next, i1)
        b.next = i1
      }
      reliefStats.ms += performance.now() - t0
      if (b.next >= w) {
        b.buf.ctx.putImageData(b.buf.image, 0, 0)
        reliefStats.columns = w
        spare = front?.buf ?? null
        front = b
        building = null
        if (fits(front)) {
          shown = front
          shift = shiftOf(front, c)
        }
      }
    }
  }
  pending = fine && (building !== null || !shown || !isZero(shift) || shown.scene !== scene)

  // what is drawn: the fine image (shifted by the turn since it was started), or the moving pass
  let read: { data: Uint8ClampedArray; w: number; h: number; scale: number; ox: number; oy: number }
  if (shown) {
    const img = shown.buf.image
    const ox = shift.dx - MARGIN_PX
    const oy = shift.dy - MARGIN_PX
    ctx.drawImage(shown.buf.canvas, ox, oy, img.width * shown.scale, img.height * shown.scale)
    read = { data: img.data, w: img.width, h: img.height, scale: shown.scale, ox, oy }
  } else {
    const scale = Math.max(1 / dpr, W / movingColumns)
    const w = Math.max(1, Math.ceil(W / scale))
    const h = Math.max(1, Math.ceil(H / scale))
    moving = sized(moving, w, h)
    if (!moving) return false
    const t0 = performance.now()
    renderRelief(moving.image, scale, c, horizonAt, scene)
    const ms = performance.now() - t0
    if (ms > 0) {
      // cost goes with the pixels, columns squared: aim the next moving frame at the budget, a step at a time
      const ideal = movingColumns * Math.sqrt(INTERACTIVE_MS / ms)
      movingColumns = Math.round(Math.min(INTERACTIVE_COLUMNS, Math.max(MIN_COLUMNS, movingColumns + 0.5 * (ideal - movingColumns))))
    }
    moving.ctx.putImageData(moving.image, 0, 0)
    ctx.save()
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(moving.canvas, 0, 0, w * scale, h * scale)
    ctx.restore()
    read = { data: moving.image.data, w, h, scale, ox: 0, oy: 0 }
  }

  // the mask's skyline, thin and faint, only where it is in the sky (no ground drawn just under it)
  const step = 2
  const { data, w, h, scale, ox, oy } = read
  const groundAt = (x: number, y: number) => {
    const i = Math.min(w - 1, Math.max(0, Math.floor((x - ox) / scale)))
    const j = Math.floor((y - oy + 1.5) / scale)
    return j > 0 && j < h && data[4 * (j * w + i) + 3] > 0 && data[4 * ((j - 1) * w + i) + 3] > 0
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

