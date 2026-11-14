/**
 * Colour scales of the layers (plan: inferno for light, viridis for the Earth, magma for slope, cividis for
 * elevation). All four are perceptually uniform and readable with colour-vision deficiencies; every legend
 * prints values, so colour is never the only carrier.
 */
import { interpolateCividis, interpolateInferno, interpolateMagma, interpolateViridis } from 'd3-scale-chromatic'

export type ColormapId = 'inferno' | 'viridis' | 'magma' | 'cividis'

const INTERPOLATORS: Record<ColormapId, (t: number) => string> = {
  inferno: interpolateInferno,
  viridis: interpolateViridis,
  magma: interpolateMagma,
  cividis: interpolateCividis,
}

export const colorAt = (id: ColormapId, t: number) => INTERPOLATORS[id](Math.min(1, Math.max(0, t)))

/** 256 × 1 RGBA bytes (sRGB) for a lookup texture. */
export function lutBytes(id: ColormapId): Uint8Array {
  const out = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    const c = INTERPOLATORS[id](i / 255)
    const m = /rgb\((\d+), ?(\d+), ?(\d+)\)/.exec(c)
    const [r, g, b] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : hex(c)
    out.set([r, g, b, 255], i * 4)
  }
  return out
}

function hex(c: string): [number, number, number] {
  const v = parseInt(c.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** CSS gradient for a legend bar. */
export const gradientCss = (id: ColormapId) =>
  `linear-gradient(to right, ${Array.from({ length: 9 }, (_, i) => colorAt(id, i / 8)).join(', ')})`

function rgbOf(c: string): [number, number, number] {
  const m = /rgb\((\d+), ?(\d+), ?(\d+)\)/.exec(c)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : hex(c)
}

/** WCAG relative luminance of an sRGB colour. */
export function luminance(c: string): number {
  const [r, g, b] = rgbOf(c).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Black or white, whichever contrasts more with the background (always ≥ 4.5:1 for these colour maps). */
export function textOn(bg: string): '#000' | '#fff' {
  const l = luminance(bg)
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000' : '#fff'
}
