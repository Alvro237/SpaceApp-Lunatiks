/**
 * Scenery of the first-person horizon view: the star field and the ground.
 *
 * Stars are real: every naked-eye star of the Yale Bright Star Catalogue where it stands over this horizon at the
 * chosen instant (stars.ts), sized by magnitude and tinted by colour index. They hide behind the terrain like the
 * Sun and the Earth do.
 *
 * The ground is an illustration, on purpose: the skyline is the site's real horizon mask, but everything below it
 * (the bands, the craters, the pebbles) is drawn for looks, the same at every hour so the terrain reads at night
 * as well as by day. The view says so on screen ("Not real moon footage"). The decoration is anchored to azimuth, so
 * it turns with the view like the ground would.
 */
import { type GroundTexture, groundTexture, renderGround } from './groundTexture'
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

/** Deterministic 0..1 from two integers (the decoration must not change between frames). */
export function hash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** The bands of the ground, from the skyline down: how far below the skyline each starts (degrees) and its colours. */
const BANDS = [
  { drop: 0, top: '#b9b6c6', bottom: '#8a8799' },
  { drop: 2.2, top: '#9a97aa', bottom: '#716e82' },
  { drop: 6, top: '#7c7990', bottom: '#56546a' },
  { drop: 13, top: '#5f5d75', bottom: '#3d3c50' },
  { drop: 26, top: '#454459', bottom: '#232230' },
]
const RIM = '#f1eef9'

export interface GroundScene {
  horizonAt: (az: number) => number
  /** Visible fraction of the solar disc, 0..1 (draw.ts Body.fraction). The ground dims a little when it is 0. */
  daylight?: number
  /** Real LOLA relief around the place (relief/): drawn instead of the texture or the illustration when present. */
  relief?: { scene: ReliefScene; fine: boolean } | null
}

/** How much darker the ground gets with the Sun fully below the skyline: perceptible, still readable. */
const NIGHT_DIM = 0.3

/**
 * The illustrated ground: layered bands that echo the real skyline (each lower band a smoother, lower copy of it),
 * a bright rim on the skyline, craters and pebbles anchored to azimuth. The drawing is the same at every hour; only
 * a light veil dims it while the Sun is below the skyline, and the skyline rim stays bright.
 */
export function drawGround(ctx: CanvasRenderingContext2D, W: number, H: number, c: Camera, s: GroundScene): void {
  if (s.relief && drawReliefGround(ctx, W, H, c, s.horizonAt, s.relief.scene, s.relief.fine)) return
  const step = 2
  const n = Math.floor(W / step) + 2
  const az = new Float64Array(n)
  const sky = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    az[i] = wrap360(c.yaw + (i * step - c.cx) * c.degPerPx)
    sky[i] = s.horizonAt(az[i])
  }
  const tex = groundTexture()
  if (tex && drawTexturedGround(ctx, W, H, c, s, tex, sky, step)) return

  // the skyline smoothed over wider and wider windows (in degrees): lower bands follow the broad shape only
  const smooth = (deg: number): Float64Array => {
    const half = Math.max(1, Math.round(deg / (c.degPerPx * step)))
    const pre = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + sky[i]
    const out = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - half)
      const b = Math.min(n, i + half + 1)
      out[i] = (pre[b] - pre[a]) / (b - a)
    }
    return out
  }
  const lines: Float64Array[] = BANDS.map((b, k) => {
    if (k === 0) return sky
    const sm = smooth(1.5 * k * k)
    const out = new Float64Array(n)
    // a slow wave so the bands are not parallel copies; phase tied to azimuth, so it turns with the view
    for (let i = 0; i < n; i++) out[i] = Math.min(sky[i] - 0.15, sm[i] - b.drop + 0.35 * k * Math.sin((az[i] * Math.PI) / 180 * (5 - k) + k * 1.7))
    return out
  })
  const yOf = (el: number) => c.cy - (el - c.pitch) / c.degPerPx

  for (let k = 0; k < BANDS.length; k++) {
    const line = lines[k]
    let top = H
    for (let i = 0; i < n; i += 8) top = Math.min(top, yOf(line[i]))
    const next = k + 1 < BANDS.length ? yOf(Math.min(...Array.from({ length: 5 }, (_, j) => lines[k + 1][Math.min(n - 1, Math.floor((j * (n - 1)) / 4))]))) : H
    const g = ctx.createLinearGradient(0, top, 0, Math.max(top + 1, Math.min(H, next + 30)))
    g.addColorStop(0, BANDS[k].top)
    g.addColorStop(1, BANDS[k].bottom)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let i = 0; i < n; i++) ctx.lineTo(i * step, yOf(line[i]))
    ctx.lineTo(W, H)
    ctx.closePath()
    ctx.fill()
    // a soft highlight along the top edge of each band
    ctx.strokeStyle = k === 0 ? RIM : 'rgba(241,238,249,0.16)'
    ctx.lineWidth = k === 0 ? 1.6 : 1
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const y = yOf(line[i])
      if (i === 0) ctx.moveTo(0, y)
      else ctx.lineTo(i * step, y)
    }
    ctx.stroke()
  }

  // decoration below the skyline only
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(0, H)
  for (let i = 0; i < n; i++) ctx.lineTo(i * step, yOf(sky[i]) + 2)
  ctx.lineTo(W, H)
  ctx.closePath()
  ctx.clip()
  const skyAt = (a: number) => s.horizonAt(wrap360(a))
  const azLeft = c.yaw - c.cx * c.degPerPx
  const azRight = c.yaw + (W - c.cx) * c.degPerPx

  // craters: one candidate per 6 degrees of azimuth and per row; nearer rows are lower, larger and rounder
  const CELL = 6
  const ROWS = [
    { drop: 1.2, size: 0.5, squash: 0.16 },
    { drop: 3.6, size: 1.0, squash: 0.2 },
    { drop: 8.5, size: 2.1, squash: 0.26 },
    { drop: 17, size: 4.2, squash: 0.33 },
    { drop: 32, size: 8, squash: 0.42 },
  ]
  for (let k = Math.floor(azLeft / CELL) - 2; k <= Math.ceil(azRight / CELL) + 2; k++) {
    const cell = ((k % 60) + 60) % 60
    for (let r = 0; r < ROWS.length; r++) {
      if (hash(cell, r) < 0.42) continue
      const row = ROWS[r]
      const a = (k + 0.15 + 0.7 * hash(cell, r + 10)) * CELL
      const el = skyAt(a) - row.drop * (0.75 + 0.5 * hash(cell, r + 20))
      const rx = (row.size * (0.55 + 0.9 * hash(cell, r + 30))) / c.degPerPx
      const ry = rx * row.squash
      const x = c.cx + (a - c.yaw) / c.degPerPx
      const y = yOf(el)
      if (x < -rx - 4 || x > W + rx + 4 || y > H + ry || rx < 1.5) continue
      drawCrater(ctx, x, y, rx, ry, cell * 7 + r)
    }
  }

  // pebbles: small light and dark dots, denser and larger towards the feet
  const PEB = 1.5
  for (let k = Math.floor(azLeft / PEB) - 1; k <= Math.ceil(azRight / PEB) + 1; k++) {
    const cell = ((k % 240) + 240) % 240
    for (let j = 0; j < 4; j++) {
      const u = hash(cell, 100 + j)
      const drop = 0.6 + 44 * u * u
      const a = (k + hash(cell, 200 + j)) * PEB
      const x = c.cx + (a - c.yaw) / c.degPerPx
      const y = yOf(skyAt(a) - drop)
      if (x < -4 || x > W + 4 || y > H + 4) continue
      const size = Math.min(5, (0.05 + 0.09 * Math.sqrt(drop)) / c.degPerPx) * (0.6 + 0.8 * hash(cell, 300 + j))
      if (size < 0.5) continue
      ctx.fillStyle = hash(cell, 400 + j) < 0.5 ? 'rgba(246,243,255,0.4)' : 'rgba(14,12,26,0.42)'
      ctx.beginPath()
      ctx.ellipse(x, y, size, size * 0.55, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // night: a light veil over everything below the skyline (the rim above the clip stays bright)
  const dim = NIGHT_DIM * (1 - Math.min(1, Math.max(0, s.daylight ?? 1)))
  if (dim > 0.001) {
    ctx.fillStyle = `rgba(6,5,16,${dim.toFixed(3)})`
    ctx.fillRect(0, 0, W, H)
  }
  ctx.restore()
}

// ------------------------------------------------------------------------------------------------- textured ground

/**
 * The textured ground is rendered at a reduced resolution, then scaled up: at most about RENDER_BUDGET pixels, so a
 * frame stays near 20 ms (measured 2026-11-15: 52 ms for 1280 x 800 at half resolution, 23 ms at a third).
 */
const RENDER_BUDGET = 150_000
let buffer: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; image: ImageData } | null = null

/**
 * The ground as real lunar surface (groundTexture.ts), with the bright rim on the real skyline and the night veil.
 * Returns false where an offscreen canvas is not available, so the illustration is drawn instead.
 */
function drawTexturedGround(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  c: Camera,
  s: GroundScene,
  tex: GroundTexture,
  sky: Float64Array,
  step: number,
): boolean {
  const RENDER_SCALE = Math.max(2, Math.ceil(Math.sqrt((W * H) / RENDER_BUDGET)))
  const w = Math.max(1, Math.ceil(W / RENDER_SCALE))
  const h = Math.max(1, Math.ceil(H / RENDER_SCALE))
  if (!buffer || buffer.image.width !== w || buffer.image.height !== h) {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const bctx = canvas.getContext('2d')
    if (!bctx) return false
    buffer = { canvas, ctx: bctx, image: bctx.createImageData(w, h) }
  }
  renderGround(buffer.image, RENDER_SCALE, tex, c.yaw, c.pitch, c.cx, c.cy, c.degPerPx, s.horizonAt)
  buffer.ctx.putImageData(buffer.image, 0, 0)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(buffer.canvas, 0, 0, w * RENDER_SCALE, h * RENDER_SCALE)
  ctx.restore()

  const yOf = (el: number) => c.cy - (el - c.pitch) / c.degPerPx
  const n = sky.length
  // night: a light veil below the skyline
  const dim = NIGHT_DIM * (1 - Math.min(1, Math.max(0, s.daylight ?? 1)))
  if (dim > 0.001) {
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let i = 0; i < n; i++) ctx.lineTo(i * step, yOf(sky[i]) + 1)
    ctx.lineTo(W, H)
    ctx.closePath()
    ctx.clip()
    ctx.fillStyle = `rgba(6,5,16,${dim.toFixed(3)})`
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
  }
  // the real skyline, bright
  ctx.strokeStyle = RIM
  ctx.lineWidth = 1.6
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const y = yOf(sky[i])
    if (i === 0) ctx.moveTo(0, y)
    else ctx.lineTo(i * step, y)
  }
  ctx.stroke()
  return true
}

// ------------------------------------------------------------------------------------------------- craters

/** Points of an irregular ellipse: the radius wobbles with two low harmonics so no crater is a perfect ring. */
function wobblyOutline(x: number, y: number, rx: number, ry: number, seed: number, amp: number, scale = 1): number[] {
  const N = 28
  const p1 = hash(seed, 1) * Math.PI * 2
  const p2 = hash(seed, 2) * Math.PI * 2
  const pts: number[] = []
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2
    const w = 1 + amp * (0.6 * Math.sin(2 * t + p1) + 0.4 * Math.sin(5 * t + p2)) + amp * 0.5 * (hash(seed, 10 + i) - 0.5)
    pts.push(x + Math.cos(t) * rx * scale * w, y + Math.sin(t) * ry * scale * w)
  }
  return pts
}

/** Smooth path through the outline points (quadratic curves between midpoints), closed or over [from, to]. */
function tracePath(ctx: CanvasRenderingContext2D, pts: number[], from = 0, to = pts.length / 2, close = true): void {
  const N = pts.length / 2
  const px = (k: number) => pts[2 * (((k % N) + N) % N)]
  const py = (k: number) => pts[2 * (((k % N) + N) % N) + 1]
  const end = close ? from + N : to
  ctx.beginPath()
  ctx.moveTo((px(from) + px(from + 1)) / 2, (py(from) + py(from + 1)) / 2)
  for (let k = from + 1; k <= end; k++) ctx.quadraticCurveTo(px(k), py(k), (px(k) + px(k + 1)) / 2, (py(k) + py(k + 1)) / 2)
  if (close) ctx.closePath()
}

/**
 * One crater seen at a grazing angle: a faint ejecta apron, a raised irregular rim, a bowl that is dark under the
 * far rim and lighter towards the near wall, a bright crest on the near rim, and a few blocks on the floor of the
 * larger ones. About a third are old, degraded craters drawn softer and without an apron.
 */
function drawCrater(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, seed: number): void {
  const fresh = hash(seed, 50) > 0.35
  ctx.save()
  ctx.globalAlpha = fresh ? 1 : 0.55
  const N = 28

  // ejecta apron: a lighter, ragged blanket around fresh craters
  if (fresh && rx > 5) {
    const apron = wobblyOutline(x, y + ry * 0.1, rx, ry, seed + 3, 0.18, 1.55)
    ctx.fillStyle = 'rgba(236,233,248,0.07)'
    tracePath(ctx, apron)
    ctx.fill()
  }

  // raised rim: a lighter ring just outside the bowl
  const rim = wobblyOutline(x, y, rx, ry, seed, 0.09, 1.12)
  ctx.fillStyle = 'rgba(226,223,240,0.16)'
  tracePath(ctx, rim)
  ctx.fill()

  // bowl: shadow under the far (upper) rim fading to a lit near wall
  const bowl = wobblyOutline(x, y, rx, ry, seed, 0.09)
  const g = ctx.createLinearGradient(0, y - ry, 0, y + ry)
  g.addColorStop(0, 'rgba(10,9,22,0.62)')
  g.addColorStop(0.45, 'rgba(22,20,38,0.38)')
  g.addColorStop(1, 'rgba(120,116,140,0.12)')
  ctx.fillStyle = g
  tracePath(ctx, bowl)
  ctx.fill()

  // far inner wall: a darker crescent along the top of the bowl
  ctx.strokeStyle = 'rgba(8,7,18,0.55)'
  ctx.lineWidth = Math.max(1, ry * 0.2)
  tracePath(ctx, bowl, Math.round(N * 0.55), Math.round(N * 0.95), false)
  ctx.stroke()

  // near rim crest: bright, sometimes broken once by a slump in the wall
  ctx.strokeStyle = 'rgba(246,243,255,0.55)'
  ctx.lineWidth = Math.max(1, ry * 0.14)
  ctx.lineCap = 'round'
  const start = Math.round(N * 0.04)
  const end = Math.round(N * 0.46)
  if (hash(seed, 80) < 0.4) {
    const gap = start + 2 + Math.floor(hash(seed, 81) * (end - start - 5))
    tracePath(ctx, rim, start, gap, false)
    ctx.stroke()
    tracePath(ctx, rim, gap + 2, end, false)
    ctx.stroke()
  } else {
    tracePath(ctx, rim, start, end, false)
    ctx.stroke()
  }

  // floor blocks on the larger craters
  if (rx > 14) {
    const count = 2 + Math.floor(hash(seed, 60) * 4)
    for (let j = 0; j < count; j++) {
      const bx = x + (hash(seed, 61 + j) - 0.5) * rx * 0.9
      const by = y + (hash(seed, 71 + j) - 0.2) * ry * 0.6
      const bs = Math.max(0.8, rx * 0.025 * (0.6 + hash(seed, 91 + j)))
      ctx.fillStyle = 'rgba(240,237,252,0.35)'
      ctx.beginPath()
      ctx.ellipse(bx, by, bs, bs * 0.6, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(8,7,18,0.4)'
      ctx.beginPath()
      ctx.ellipse(bx + bs * 0.5, by + bs * 0.45, bs * 0.9, bs * 0.3, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}
