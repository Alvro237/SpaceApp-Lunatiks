/**
 * Real lunar surface texture for the ground of the horizon view.
 *
 * Source: the LROC WAC global morphologic mosaic (303 px/deg, about 100 m; Speyerer et al. 2011) from NASA Moon
 * Trek's WMTS cache, the same tiles the globe's photo view reads. A fixed patch of 4 x 4 tiles at WMTS matrix 7
 * (1.40625 degree tiles, about 170 km square in all) in the near-side southern highlands, latitude 11.25-16.875 S,
 * longitude 0-5.625 E: densely cratered terrain, the brightness as photographed.
 *
 * It is a texture, not this site's ground: the patch is the same at every site, scaled down to metres around the
 * observer and repeated (mirrored, so there are no seams). The view says so on screen. The skyline above it stays
 * the site's real horizon mask.
 */
import { PHOTO_WMTS } from '../globe/detail/grid'

const MATRIX = 7
const COL0 = 128 // longitude 0 E
const ROW0 = 72 // latitude 11.25 S
const TILES = 4
const TILE_PX = 256

/** Mip levels of the grey texture: level 0 is 1024 x 1024, each next one half the size (box filter). */
export interface GroundTexture {
  levels: Float32Array[]
  sizes: number[]
}

let texture: GroundTexture | null = null
let loading: Promise<GroundTexture | null> | null = null

export const groundTexture = (): GroundTexture | null => texture

export const groundTextureTileUrls = (): string[] =>
  Array.from({ length: TILES * TILES }, (_, i) => `${PHOTO_WMTS}${MATRIX}/${ROW0 + Math.floor(i / TILES)}/${COL0 + (i % TILES)}.jpg`)

/** Fetch and decode the patch once; null where the browser cannot decode images (tests) or Moon Trek fails. */
export function loadGroundTexture(): Promise<GroundTexture | null> {
  if (loading) return loading
  if (typeof createImageBitmap === 'undefined' || typeof document === 'undefined') return Promise.resolve(null)
  loading = (async () => {
    const n = TILES * TILE_PX
    const canvas = document.createElement('canvas')
    canvas.width = n
    canvas.height = n
    const g = canvas.getContext('2d')
    if (!g) return null
    await Promise.all(
      groundTextureTileUrls().map(async (url, i) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`${url}: ${res.status}`)
        const img = await createImageBitmap(await res.blob())
        g.drawImage(img, (i % TILES) * TILE_PX, Math.floor(i / TILES) * TILE_PX)
      }),
    )
    const rgba = g.getImageData(0, 0, n, n).data
    // grey normalised to a mean of 1, so the colouring below sets the brightness
    const base = new Float32Array(n * n)
    let sum = 0
    for (let i = 0; i < n * n; i++) sum += base[i] = rgba[4 * i]
    const mean = sum / (n * n) || 1
    for (let i = 0; i < n * n; i++) base[i] /= mean
    const levels = [base]
    const sizes = [n]
    for (let s = n; s > 1; s >>= 1) {
      const prev = levels[levels.length - 1]
      const h = s >> 1
      const next = new Float32Array(h * h)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < h; x++) {
          const i = 2 * y * s + 2 * x
          next[y * h + x] = (prev[i] + prev[i + 1] + prev[i + s] + prev[i + s + 1]) / 4
        }
      levels.push(next)
      sizes.push(h)
    }
    texture = { levels, sizes }
    return texture
  })().catch(() => null)
  return loading
}

/** Mirrored repeat: 0..n-1, n-1..0, ... so the patch tiles with no seams. */
function mirror(t: number, n: number): number {
  const p = t & (2 * n - 1) // n is a power of two: a mask is the positive modulo, negatives included
  return p < n ? p : 2 * n - 1 - p
}

/** Bilinear sample of one mip level at level-0 texel coordinates (u, v). */
function sample(tex: GroundTexture, level: number, u: number, v: number): number {
  const s = tex.sizes[level]
  const k = 1 << level
  const x = u / k - 0.5
  const y = v / k - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const L = tex.levels[level]
  const xa = mirror(x0, s)
  const xb = mirror(x0 + 1, s)
  const ya = mirror(y0, s) * s
  const yb = mirror(y0 + 1, s) * s
  return (L[ya + xa] * (1 - fx) + L[ya + xb] * fx) * (1 - fy) + (L[yb + xa] * (1 - fx) + L[yb + xb] * fx) * fy
}

/** log2 of the pixel footprint (in level-0 texels) picks the nearest mip level, sampled bilinearly. */
function sampleFoot(tex: GroundTexture, log2Foot: number, u: number, v: number): number {
  const lv = log2Foot <= 0 ? 0 : Math.min(tex.levels.length - 1, Math.round(log2Foot))
  return sample(tex, lv, u, v)
}

/**
 * Eye height over the drawn ground (m) and the two scales the patch is laid at (m per level-0 texel): a macro scale
 * where the big craters show in the middle distance, and a fine detail scale that keeps the near ground sharp
 * (multiplied in, as detail textures are). Plus an offset that keeps the skyline at a finite distance.
 */
const EYE_M = 2
const MACRO_M = 0.5
const DETAIL_M = 0.025
const DETAIL_GAIN = 0.8
const LOG_MACRO = Math.log2(MACRO_M)
const LOG_DETAIL = Math.log2(DETAIL_M)
const SKYLINE_OFFSET_DEG = 0.3
/** Regolith colour at the mean brightness, sRGB: a warm grey, as in surface photographs. */
const TINT = [196, 190, 182]
const CONTRAST = 1.35

/**
 * Render the textured ground into `out` (an ImageData of the canvas at 1/scale resolution): every pixel below the
 * skyline is a point on a flat plane EYE_M below the eye, at the distance its depression under the skyline gives;
 * the texture is sampled there with the mip level of the pixel's footprint (two levels blended).
 */
export function renderGround(
  out: ImageData,
  scale: number,
  tex: GroundTexture,
  yaw: number,
  pitch: number,
  cx: number,
  cy: number,
  degPerPx: number,
  horizonAt: (az: number) => number,
): void {
  const w = out.width
  const h = out.height
  const px = out.data
  px.fill(0)
  const dTheta = ((scale * degPerPx) * Math.PI) / 180
  for (let i = 0; i < w; i++) {
    const az = yaw + (i * scale + scale / 2 - cx) * degPerPx
    const sky = horizonAt(((az % 360) + 360) % 360)
    const sa = Math.sin((az * Math.PI) / 180)
    const ca = Math.cos((az * Math.PI) / 180)
    const yTop = Math.max(0, Math.floor((cy - (sky - pitch) / degPerPx) / scale))
    for (let j = yTop; j < h; j++) {
      const el = pitch + (cy - (j * scale + scale / 2)) * degPerPx
      const dep = sky - el
      if (dep <= 0) continue
      const t = Math.tan(((dep + SKYLINE_OFFSET_DEG) * Math.PI) / 180)
      const dist = EYE_M / t
      // footprint of the pixel on the ground: radial and across, geometric mean, in texels
      const radial = (dist * dist * dTheta) / EYE_M
      const across = dist * dTheta
      const logFoot = 0.5 * Math.log2(radial * across)
      const x = dist * sa
      const y = -dist * ca
      const macro = sampleFoot(tex, logFoot - LOG_MACRO, x / MACRO_M, y / MACRO_M)
      // the detail layer is offset so its repeats do not line up with the macro layer's
      const detail = sampleFoot(tex, logFoot - LOG_DETAIL, x / DETAIL_M + 311, y / DETAIL_M + 517)
      const g = macro * (1 + (detail - 1) * DETAIL_GAIN)
      const b = 1 + (g - 1) * CONTRAST
      const o = 4 * (j * w + i)
      px[o] = Math.min(255, TINT[0] * b)
      px[o + 1] = Math.min(255, TINT[1] * b)
      px[o + 2] = Math.min(255, TINT[2] * b)
      px[o + 3] = 255
    }
  }
}
