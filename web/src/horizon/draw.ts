/**
 * Draws the first-person horizon view on a 2D canvas, in this order so that occlusion is physical: black airless
 * sky, elevation grid, the window's Sun and Earth tracks, the Sun and the Earth (true angular size, Earth with its
 * phase), then the terrain from the horizon mask in front of them, then the scales and labels on top.
 * Colours are fixed (light on dark): the view is a night-sky scene in both colour schemes.
 */
import { type Camera, compass16, earthPhase, project, tickStep, wrap180, wrap360 } from './project'

export interface Body {
  az: number
  el: number
  fraction: number
  radiusDeg: number
}

export interface Scene {
  /** Horizon elevation (degrees) at an azimuth, from the site's mask. */
  horizonAt: (az: number) => number
  sun: Body
  earth: Body
  sunTrack: { az: number; el: number }[]
  earthTrack: { az: number; el: number }[]
  /** Free area of the screen (the rest is under panels). */
  free: { left: number; right: number; top: number; bottom: number }
  /** Name tags state the view from the surface: hidden while the camera is still coming down. */
  showLabels?: boolean
}

const SUN = '#ffb547'
const EARTH = '#6cb2ff'
const TEXT = '#eceae4'
const MUTED = '#a8a59d'
const MIN_DISC_PX = 2.5

export function drawHorizon(ctx: CanvasRenderingContext2D, W: number, H: number, c: Camera, s: Scene): void {
  // sky: black, a hint of depth towards the horizon (no atmosphere: no blue, no glow on the ground line)
  const zeroY = project(c, c.yaw, 0).y
  const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, zeroY))
  sky.addColorStop(0, '#000000')
  sky.addColorStop(1, '#0b0d12')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)

  drawGrid(ctx, W, H, c, s)
  drawTrack(ctx, W, c, s.sunTrack, SUN)
  drawTrack(ctx, W, c, s.earthTrack, EARTH)
  drawSun(ctx, c, s.sun)
  drawEarth(ctx, c, s.earth, s.sun)
  drawTerrain(ctx, W, H, c, s)
  if (s.showLabels !== false) drawLabels(ctx, W, c, s)
  drawCompass(ctx, W, H, c, s)
}

function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number, c: Camera, s: Scene) {
  const step = tickStep(c.degPerPx, 64)
  const top = c.pitch + (c.cy - 0) * c.degPerPx
  const bottom = c.pitch - (H - c.cy) * c.degPerPx
  ctx.lineWidth = 1
  ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace'
  ctx.textBaseline = 'middle'
  for (let el = Math.ceil(bottom / step) * step; el <= top; el += step) {
    const y = Math.round(project(c, c.yaw, el).y) + 0.5
    ctx.strokeStyle = el === 0 ? 'rgba(236,234,228,0.35)' : 'rgba(236,234,228,0.08)'
    ctx.setLineDash(el === 0 ? [6, 6] : [])
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = MUTED
    ctx.fillText(`${Number(el.toFixed(1))}°`, s.free.left + 8, y - 8)
  }
}

function drawTrack(ctx: CanvasRenderingContext2D, W: number, c: Camera, track: { az: number; el: number }[], colour: string) {
  if (track.length < 2) return
  ctx.strokeStyle = colour
  ctx.globalAlpha = 0.7
  ctx.lineWidth = 2
  ctx.setLineDash([3, 5])
  ctx.beginPath()
  let prev: { x: number; y: number } | null = null
  for (const p of track) {
    const q = project(c, p.az, p.el)
    if (prev && Math.abs(q.x - prev.x) < W / 2) ctx.lineTo(q.x, q.y)
    else ctx.moveTo(q.x, q.y)
    prev = q
  }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = 1
}

function discRadius(c: Camera, b: Body) {
  return Math.max(MIN_DISC_PX, b.radiusDeg / c.degPerPx)
}

function drawSun(ctx: CanvasRenderingContext2D, c: Camera, sun: Body) {
  const p = project(c, sun.az, sun.el)
  const r = discRadius(c, sun)
  const glow = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r * 5)
  glow.addColorStop(0, 'rgba(255,214,140,0.55)')
  glow.addColorStop(1, 'rgba(255,181,71,0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(p.x, p.y, r * 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff4d6'
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  ctx.fill()
}

function drawEarth(ctx: CanvasRenderingContext2D, c: Camera, earth: Body, sun: Body) {
  const p = project(c, earth.az, earth.el)
  const r = discRadius(c, earth)
  const { lit, brightLimbDeg } = earthPhase(sun, earth)
  // night side: dark blue, faintly visible
  ctx.fillStyle = '#10223d'
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  ctx.fill()
  // lit side: half disc towards the Sun plus or minus the terminator ellipse (semi-axis r·(2k − 1))
  ctx.save()
  ctx.translate(p.x, p.y)
  // canvas y points down; the bright limb direction is (sin χ, −cos χ) on screen
  ctx.rotate(Math.atan2(-Math.cos((brightLimbDeg * Math.PI) / 180), Math.sin((brightLimbDeg * Math.PI) / 180)))
  const b = r * (2 * lit - 1)
  ctx.fillStyle = EARTH
  ctx.beginPath()
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false)
  ctx.ellipse(0, 0, Math.max(0.01, Math.abs(b)), r, 0, Math.PI / 2, -Math.PI / 2, b <= 0)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = 'rgba(108,178,255,0.6)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  ctx.stroke()
}

function drawTerrain(ctx: CanvasRenderingContext2D, W: number, H: number, c: Camera, s: Scene) {
  const lit = s.sun.fraction > 0
  const top = Math.min(...[0, W / 4, W / 2, (3 * W) / 4, W].map((x) => project(c, wrap360(c.yaw + (x - c.cx) * c.degPerPx), s.horizonAt(wrap360(c.yaw + (x - c.cx) * c.degPerPx))).y))
  const g = ctx.createLinearGradient(0, Math.max(0, top), 0, H)
  g.addColorStop(0, lit ? '#77746d' : '#4a4843')
  g.addColorStop(1, '#141412')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(0, H)
  const step = 2
  for (let x = 0; x <= W + step; x += step) {
    const az = wrap360(c.yaw + (x - c.cx) * c.degPerPx)
    ctx.lineTo(x, project(c, az, s.horizonAt(az)).y)
  }
  ctx.lineTo(W, H)
  ctx.closePath()
  ctx.fill()
  // the silhouette line
  ctx.strokeStyle = '#cfccc4'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  for (let x = 0; x <= W + step; x += step) {
    const az = wrap360(c.yaw + (x - c.cx) * c.degPerPx)
    const y = project(c, az, s.horizonAt(az)).y
    if (x === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

/** Name tags next to the bodies, or an arrow at the edge of the free area when one is out of view. */
function drawLabels(ctx: CanvasRenderingContext2D, W: number, c: Camera, s: Scene) {
  ctx.font = '600 12px "Space Grotesk Variable", system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  const items: [string, Body, string][] = [
    ['Sun', s.sun, SUN],
    ['Earth', s.earth, EARTH],
  ]
  for (const [name, b, colour] of items) {
    const p = project(c, b.az, b.el)
    const state = b.fraction >= 0.999 ? '' : b.fraction > 0 ? ` · ${Math.round(b.fraction * 100)} % visible` : ' · hidden'
    const text = `${name} ${b.el.toFixed(1)}°${state}`
    const inView = p.x > s.free.left + 10 && p.x < W - s.free.right - 10
    if (inView) {
      const r = discRadius(c, b)
      label(ctx, text, p.x + r + 8, p.y - r - 6, colour)
    } else {
      const right = wrap180(b.az - c.yaw) > 0
      const x = right ? W - s.free.right - 16 : s.free.left + 16
      const y = Math.min(Math.max(p.y, s.free.top + 60), c.cy + 120)
      ctx.fillStyle = colour
      ctx.beginPath()
      ctx.moveTo(x + (right ? 8 : -8), y)
      ctx.lineTo(x + (right ? -4 : 4), y - 7)
      ctx.lineTo(x + (right ? -4 : 4), y + 7)
      ctx.closePath()
      ctx.fill()
      const t = `${name} ${Math.abs(Math.round(wrap180(b.az - c.yaw)))}° ${right ? '→' : '←'}`
      ctx.textAlign = right ? 'right' : 'left'
      label(ctx, t, x + (right ? -10 : 10), y, colour)
      ctx.textAlign = 'left'
    }
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string) {
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  ctx.strokeText(text, x, y)
  ctx.fillStyle = colour
  ctx.fillText(text, x, y)
}

/** Azimuth ruler along the bottom of the free area: compass points and degrees. */
function drawCompass(ctx: CanvasRenderingContext2D, W: number, H: number, c: Camera, s: Scene) {
  const y = H - s.free.bottom - 16
  const step = tickStep(c.degPerPx, 80)
  const az0 = c.yaw - (c.cx - s.free.left) * c.degPerPx
  const az1 = c.yaw + (W - s.free.right - c.cx) * c.degPerPx
  ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.strokeStyle = 'rgba(236,234,228,0.55)'
  ctx.lineWidth = 1
  for (let a = Math.ceil(az0 / step) * step; a <= az1; a += step) {
    const x = Math.round(project(c, wrap360(a), c.pitch).x) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, y - 6)
    ctx.lineTo(x, y)
    ctx.stroke()
    const deg = Math.round(wrap360(a))
    const name = deg % 45 === 0 ? compass16(deg) : `${deg}°`
    label(ctx, name, x, y - 10, deg % 90 === 0 ? TEXT : MUTED)
  }
  // heading marker at the centre
  ctx.fillStyle = '#ffd166'
  ctx.beginPath()
  ctx.moveTo(c.cx, y + 2)
  ctx.lineTo(c.cx - 5, y + 9)
  ctx.lineTo(c.cx + 5, y + 9)
  ctx.closePath()
  ctx.fill()
  ctx.textAlign = 'left'
}
