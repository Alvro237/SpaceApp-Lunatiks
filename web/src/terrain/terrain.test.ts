// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { LruCache } from './cache'
import { byDistanceTo, renderable, screenErrorPx, selectTiles } from './lod'
import { decodePng, heightsFromRgb } from './png'
import { type Tileset, keyOf, polarLatLon, polarXY, scaleFactor, tileBounds } from './tileset'

/** A synthetic 4-level tileset: 1 + 4 + 16 + 64 tiles, flat at 0 m, 1 000 km wide. */
function synthetic(levels = 4): Tileset {
  const tiles: Record<string, [number, number]> = {}
  for (let z = 0; z < levels; z++) for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) tiles[`${z}/${x}/${y}`] = [0, 0]
  return {
    format: 1,
    kind: 'test',
    extentM: [-500_000, -500_000, 500_000, 500_000],
    tileCells: 256,
    tileSamples: 257,
    levels: Array.from({ length: levels }, (_, z) => ({ z, tiles: 2 ** z, cellM: 1_000_000 / (256 * 2 ** z) })),
    height: { path: 'height/{z}/{x}/{y}.png', encoding: '', tiles, sources: [] },
    overview: { path: '', samples: 0, min: 0, max: 0 },
    layers: {},
    builtUtc: '',
  }
}

const cam = (heightKm: number, x = 0, z = 0) => ({
  pos: [x, heightKm, z] as [number, number, number],
  viewportHeightPx: 1000,
  fovYRad: Math.PI / 2, // tan(45°) = 1 keeps the hand-worked numbers simple
  exaggeration: 1,
})

describe('projection', () => {
  it('round-trips lat/lon and puts longitude 0 up the map', () => {
    const [x, y] = polarXY(-85, 0)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeGreaterThan(0)
    const [lat, lon] = polarLatLon(...polarXY(-84.79, 29.2))
    expect(lat).toBeCloseTo(-84.79, 9)
    expect(lon).toBeCloseTo(29.2, 9)
    expect(scaleFactor(-90)).toBe(1)
  })

  it('tile 1/0/0 is the top-left quarter', () => {
    expect(tileBounds(synthetic(), { z: 1, x: 0, y: 0 })).toEqual([-500_000, 0, 0, 500_000])
  })
})

describe('screen-space error (hand-worked)', () => {
  it('3.9 km cells seen from 1000 km on a 1000 px viewport with a 90° field are 1.95 px', () => {
    // 3.90625 × 1000 / (2 × 1000 × tan 45°) = 1.953 px
    expect(screenErrorPx(3.90625, 1000, cam(1000))).toBeCloseTo(1.953, 3)
  })
})

describe('quadtree selection', () => {
  const ts = synthetic()

  it('keeps the root from far away and refines near the ground', () => {
    expect(selectTiles(ts, cam(5000)).tiles.map(keyOf)).toEqual(['0/0/0'])
    const near = selectTiles(ts, cam(20)).tiles
    expect(Math.max(...near.map((t) => t.z))).toBe(3)
  })

  it('refines more under the camera than far from it', () => {
    const { tiles } = selectTiles(ts, cam(60, -400, -400))
    const under = tiles.find((t) => { const [a, b, c, d] = tileBounds(ts, t); return a <= -400_000 && c >= -400_000 && b <= 400_000 && d >= 400_000 })!
    const far = tiles.find((t) => { const [a, b, c, d] = tileBounds(ts, t); return a <= 400_000 && c >= 400_000 && b <= -400_000 && d >= -400_000 })!
    expect(under.z).toBeGreaterThan(far.z)
  })

  it('has hysteresis: a split tile stays split between 1.5 and 2 px', () => {
    // Root cell 3.90625 km; camera at 1100 km → error 1.78 px: between merge (1.5) and split (2).
    const first = selectTiles(ts, cam(1100))
    expect(first.tiles.map(keyOf)).toEqual(['0/0/0'])
    const kept = selectTiles(ts, cam(1100), { splitPx: 2, mergePx: 1.5, previouslySplit: new Set(['0/0/0']) })
    expect(kept.tiles.every((t) => t.z >= 1)).toBe(true)
  })

  it('skips tiles outside the view', () => {
    const { tiles } = selectTiles(ts, cam(20), { splitPx: 2, mergePx: 1.5, visible: (min) => min[0] < 0 })
    expect(tiles.every((t) => tileBounds(ts, t)[0] < 0)).toBe(true)
  })
})

describe('parent stays visible until all children arrive', () => {
  const wanted = [{ z: 1, x: 0, y: 0 }, { z: 1, x: 1, y: 0 }, { z: 1, x: 0, y: 1 }, { z: 1, x: 1, y: 1 }]

  it('draws the parent while a child is missing', () => {
    const loaded = new Set(['0/0/0', '1/0/0', '1/1/0', '1/0/1'])
    expect(renderable(wanted, (k) => loaded.has(k)).map(keyOf)).toEqual(['0/0/0'])
  })

  it('draws the children once all four are in', () => {
    const loaded = new Set(['0/0/0', '1/0/0', '1/1/0', '1/0/1', '1/1/1'])
    expect(renderable(wanted, (k) => loaded.has(k)).map(keyOf).sort()).toEqual(wanted.map(keyOf).sort())
  })

  it('resolves a deep selection quickly and keeps unloaded deep tiles on their loaded ancestor', () => {
    // a selection like the map's when zoomed in near the pole: four tiles at z11 and, at every level above, two of
    // the three siblings on the way down (the third is outside the view, culled, so in no branch of the selection).
    // Each culled branch used to be searched down to z11: about a second per frame, which froze the map.
    const deep = [0, 1, 2, 3].map((i) => ({ z: 11, x: 1024 + (i & 1), y: 1024 + (i >> 1) }))
    const between = []
    for (let z = 1; z <= 10; z++) {
      const px = 1024 >> (11 - z)
      for (const [dx, dy] of [[0, 1], [1, 0]]) between.push({ z, x: (px & ~1) + dx, y: (px & ~1) + dy })
    }
    const wanted = [...deep, ...between]
    const t0 = performance.now()
    const all = renderable(wanted, () => true)
    expect(performance.now() - t0).toBeLessThan(50)
    expect(all.map(keyOf).sort()).toEqual(wanted.map(keyOf).sort())
    // the four z11 tiles not loaded yet: their z10 parent is drawn instead
    const parent = '10/512/512'
    const some = renderable(wanted, (k) => !k.startsWith('11/')).map(keyOf)
    expect(some).toContain(parent)
    expect(some.some((k) => k.startsWith('11/'))).toBe(false)
  })

  it('requests nearest tiles first, coarse levels before fine', () => {
    const order = byDistanceTo(synthetic(), [-400, -400], [{ z: 2, x: 3, y: 3 }, { z: 2, x: 0, y: 0 }, { z: 1, x: 1, y: 1 }])
    expect(order.map(keyOf)).toEqual(['1/1/1', '2/0/0', '2/3/3'])
  })
})

describe('LRU cache', () => {
  it('evicts the least recently used, never a pinned one', () => {
    const gone: string[] = []
    const c = new LruCache<number>(2, (_, k) => gone.push(k))
    c.set('a', 1)
    c.set('b', 2)
    c.touch('a')
    c.set('c', 3)
    expect(gone).toEqual(['b'])
    c.set('d', 4, new Set(['a']))
    expect(gone).toEqual(['b', 'c'])
    expect(c.has('a')).toBe(true)
  })
})

/** PNG with filter 0 rows, as written by scripts/build_preview_tiles.py. */
function png(width: number, height: number, colorType: number, pixels: number[]): ArrayBuffer {
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]!
  const raw: number[] = []
  for (let y = 0; y < height; y++) raw.push(0, ...pixels.slice(y * width * ch, (y + 1) * width * ch))
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const v = new DataView(out.buffer)
    v.setUint32(0, data.length)
    out.set([...type].map((c) => c.charCodeAt(0)), 4)
    out.set(data, 8)
    return out // CRC is not checked by the decoder
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr.set([8, colorType, 0, 0, 0], 8)
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Uint8Array.from(raw))), chunk('IEND', new Uint8Array())]
  const total = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { total.set(p, o); o += p.length }
  return total.buffer
}

describe('PNG height decoding', () => {
  it('reads 16-bit heights from red and green exactly', async () => {
    // 0 → min, 65535 → max, 32768 → min + 32768/65535 × span
    const buf = png(3, 1, 2, [0, 0, 0, 255, 255, 0, 128, 0, 0])
    const h = heightsFromRgb(await decodePng(buf), -1000, 5553.5)
    expect(h[0]).toBeCloseTo(-1000, 3)
    expect(h[1]).toBeCloseTo(5553.5, 3)
    expect(h[2]).toBeCloseTo(-1000 + (32768 / 65535) * 6553.5, 2)
  })

  it('decodes a real preview tile when it has been built', async () => {
    const root = resolve(__dirname, '../../public/tiles')
    let ts: Tileset
    try {
      ts = JSON.parse(readFileSync(`${root}/tileset.json`, 'utf8')) as Tileset
    } catch {
      return // tiles not built in this checkout (npm run tiles)
    }
    const b = readFileSync(`${root}/height/0/0/0.png`)
    const decoded = await decodePng(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
    expect([decoded.width, decoded.height]).toEqual([257, 257])
    const [lo, hi] = ts.height.tiles['0/0/0']
    const h = heightsFromRgb(decoded, lo, hi)
    expect(Math.min(...h)).toBeCloseTo(lo, 0)
    expect(Math.max(...h)).toBeCloseTo(hi, 0)
  })
})
