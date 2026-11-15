/** Marker images drawn on a canvas at twice their CSS size: a map pin, a cross, and text labels. */
import * as THREE from 'three'

const PX = 2 // device pixels per CSS pixel in the textures

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w * PX
  c.height = h * PX
  const ctx = c.getContext('2d')!
  ctx.scale(PX, PX)
  return [c, ctx]
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.minFilter = THREE.LinearFilter
  t.generateMipmaps = false
  return t
}

export interface Art {
  texture: THREE.Texture
  /** Size in CSS pixels. */
  w: number
  h: number
  /** Anchor inside the image (0..1 from the left, 0..1 from the bottom), as THREE.Sprite.center. */
  cx: number
  cy: number
}

export const PIN = { w: 28, h: 38 }

/** Relative luminance of a #rrggbb colour (WCAG). */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** The same colour scaled towards black (k < 1). */
function darker(hex: string, k: number): string {
  const v = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k))
  return `rgb(${v[0]}, ${v[1]}, ${v[2]})`
}

/** A teardrop pin with a dark core; the tip is the place. A number goes in the core when compared. */
export function pinArt(opts: { selected: boolean; number: number | null; muted: boolean; colour?: string | null }): Art {
  const { w, h } = PIN
  const [c, ctx] = canvas(w, h)
  const cx = w / 2
  const r = w / 2 - 2
  const cy = r + 2
  ctx.beginPath()
  ctx.moveTo(cx, h - 1)
  ctx.bezierCurveTo(cx - 3, h - 10, cx - r, cy + r * 0.7, cx - r, cy)
  ctx.arc(cx, cy, r, Math.PI, 0)
  ctx.bezierCurveTo(cx + r, cy + r * 0.7, cx + 3, h - 10, cx, h - 1)
  ctx.closePath()
  const fill = opts.muted ? '#8d93a0' : (opts.colour ?? '#ea4335')
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = opts.selected ? 2.5 : 1
  ctx.strokeStyle = opts.selected ? '#ffffff' : 'rgba(0,0,0,0.55)'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.48, 0, Math.PI * 2)
  const light = !opts.muted && luminance(fill) > 0.45
  ctx.fillStyle = opts.muted ? '#4b505a' : opts.colour ? darker(opts.colour, light ? 0.62 : 0.45) : '#7a2a21'
  ctx.fill()
  if (opts.number !== null) {
    ctx.fillStyle = light ? '#111214' : '#ffffff'
    ctx.font = '700 11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(opts.number), cx, cy + 0.5)
  }
  return { texture: texture(c), w, h, cx: 0.5, cy: 0 }
}

/** A plus-shaped cross with a dark outline, centred on the place. */
export function crossArt(opts: { selected: boolean; number: number | null; pass: boolean | null; colour?: string | null }): Art {
  const s = opts.selected ? 26 : 20
  const [c, ctx] = canvas(s, s)
  const colour = opts.colour ?? (opts.selected ? '#ffd166' : opts.pass === true ? '#34d399' : '#00d8ff')
  const arm = s / 2 - 1
  const draw = (width: number, style: string) => {
    ctx.strokeStyle = style
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(s / 2 - arm, s / 2)
    ctx.lineTo(s / 2 + arm, s / 2)
    ctx.moveTo(s / 2, s / 2 - arm)
    ctx.lineTo(s / 2, s / 2 + arm)
    ctx.stroke()
  }
  draw(5, 'rgba(0,0,0,0.75)')
  draw(2.5, colour)
  return { texture: texture(c), w: s, h: s, cx: 0.5, cy: 0.5 }
}

/** A small filled dot for the centre of a crater outline. */
export function dotArt(colour: string): Art {
  const [c, ctx] = canvas(10, 10)
  ctx.beginPath()
  ctx.arc(5, 5, 3.5, 0, Math.PI * 2)
  ctx.fillStyle = colour
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'
  ctx.stroke()
  return { texture: texture(c), w: 10, h: 10, cx: 0.5, cy: 0.5 }
}

/** White text on a dark rounded box, anchored `dx` px to the right and `dy` px above the place. */
export function labelArt(text: string, dx: number, dy: number): Art {
  const font = '600 12px system-ui, -apple-system, sans-serif'
  const [, probe] = canvas(1, 1)
  probe.font = font
  const w = Math.ceil(probe.measureText(text).width) + 12
  const h = 20
  const [c, ctx] = canvas(w, h)
  ctx.fillStyle = 'rgba(0,0,0,0.78)'
  ctx.beginPath()
  ctx.roundRect(0, 0, w, h, 4)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = font
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 6, h / 2 + 0.5)
  return { texture: texture(c), w, h, cx: -dx / w, cy: 0.5 - dy / h }
}

export const RING_COLOURS = { pass: '#34d399', neutral: '#e8ecf3', selected: '#00d8ff' }
