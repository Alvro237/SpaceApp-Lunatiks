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

/** A small filled square for a past landing or impact (mission planner, section 3.6): never colour alone, the
 * two kinds also differ in shape (a plain square for a landing, one rotated 45° — a diamond — for an impact) and
 * always carry a text label ("landing site" / "impact site"). */
export function squareArt(kind: 'landing' | 'impact'): Art {
  const s = 14
  const [c, ctx] = canvas(s, s)
  ctx.translate(s / 2, s / 2)
  if (kind === 'impact') ctx.rotate(Math.PI / 4)
  const half = kind === 'impact' ? 4.6 : 5
  ctx.beginPath()
  ctx.rect(-half, -half, half * 2, half * 2)
  ctx.fillStyle = kind === 'impact' ? '#ff8a65' : '#c9c6be'
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = 'rgba(0,0,0,0.75)'
  ctx.stroke()
  return { texture: texture(c), w: s, h: s, cx: 0.5, cy: 0.5 }
}

/**
 * A red pennant on a silver pole (mission planner: the best places found). The foot of the pole is the place.
 * The rank is written on the cloth, so the flags match the numbered list and are never told apart by colour alone.
 */
export const FLAG = { w: 34, h: 40 }
export function flagArt(rank: number): Art {
  const { w, h } = FLAG
  const [c, ctx] = canvas(w, h)
  const poleX = 6
  // pole: a thin silver rod with a light edge, from the cloth down to the ground
  const rod = ctx.createLinearGradient(poleX - 1.5, 0, poleX + 1.5, 0)
  rod.addColorStop(0, '#8c9096')
  rod.addColorStop(0.45, '#f1f2f4')
  rod.addColorStop(1, '#7a7e84')
  ctx.fillStyle = rod
  ctx.fillRect(poleX - 1.5, 3, 3, h - 4)
  // cloth: a waving triangle from the top of the pole, red with a lighter fold and a darker tail
  const top = 3
  const bottom = 21
  ctx.beginPath()
  ctx.moveTo(poleX, top)
  ctx.bezierCurveTo(poleX + 10, top - 2, poleX + 18, top + 8, w - 2, top + 9)
  ctx.bezierCurveTo(poleX + 18, top + 12, poleX + 10, bottom - 3, poleX, bottom)
  ctx.closePath()
  const cloth = ctx.createLinearGradient(poleX, 0, w - 2, 0)
  cloth.addColorStop(0, '#e8261c')
  cloth.addColorStop(0.35, '#ff6a5c')
  cloth.addColorStop(1, '#a8150f')
  ctx.fillStyle = cloth
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.stroke()
  // the rank, white on the cloth
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 ${rank >= 10 ? 8 : 9}px system-ui, -apple-system, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(rank), poleX + 8, top + 9)
  // a small shadow dot at the foot, so the place reads on bright and dark ground alike
  ctx.beginPath()
  ctx.ellipse(poleX, h - 1.5, 3.5, 1.4, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fill()
  return { texture: texture(c), w, h, cx: poleX / w, cy: 1.5 / h }
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
