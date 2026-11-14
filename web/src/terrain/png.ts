/**
 * Minimal PNG decoder for the tiles (8-bit grey, grey+alpha, RGB, RGBA; no interlace).
 *
 * The heights are 16-bit values split across the red and green bytes, so they must be read exactly. Going
 * through a canvas would let the browser apply colour management or premultiplied alpha; decoding the file
 * ourselves with the platform's DecompressionStream reads the bytes as written. Runs in the decode worker.
 */

export interface DecodedPng {
  width: number
  height: number
  channels: number
  data: Uint8Array
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export async function decodePng(buf: ArrayBuffer): Promise<DecodedPng> {
  const bytes = new Uint8Array(buf)
  const view = new DataView(buf)
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!sig.every((v, i) => bytes[i] === v)) throw new Error('not a PNG file')
  let pos = 8
  let width = 0
  let height = 0
  let channels = 0
  const idat: Uint8Array[] = []
  while (pos < bytes.length) {
    const len = view.getUint32(pos)
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8))
    const body = bytes.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8)
      height = view.getUint32(pos + 12)
      const depth = body[8]
      const colorType = body[9]
      if (depth !== 8 || !(colorType in CHANNELS) || body[12] !== 0) {
        throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${colorType}, interlace ${body[12]})`)
      }
      channels = CHANNELS[colorType]
    } else if (type === 'IDAT') {
      idat.push(body)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of idat) {
    joined.set(c, o)
    o += c.length
  }
  const raw = await inflate(joined)
  const stride = width * channels
  if (raw.length < height * (stride + 1)) throw new Error('truncated PNG data')
  const out = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[dst + x - channels] : 0
      const b = y > 0 ? out[dst - stride + x] : 0
      const c = x >= channels && y > 0 ? out[dst - stride + x - channels] : 0
      const v = raw[src + x]
      let r: number
      switch (filter) {
        case 0: r = v; break
        case 1: r = v + a; break
        case 2: r = v + b; break
        case 3: r = v + ((a + b) >> 1); break
        case 4: r = v + paeth(a, b, c); break
        default: throw new Error(`bad PNG filter ${filter}`)
      }
      out[dst + x] = r & 0xff
    }
  }
  return { width, height, channels, data: out }
}

/** Height tile: 16-bit value in red (high byte) and green (low byte); metres = min + v / 65535 × (max − min). */
export function heightsFromRgb(png: DecodedPng, min: number, max: number): Float32Array {
  const n = png.width * png.height
  const out = new Float32Array(n)
  const span = max - min
  for (let i = 0; i < n; i++) {
    const p = i * png.channels
    out[i] = min + ((png.data[p] * 256 + png.data[p + 1]) / 65535) * span
  }
  return out
}
