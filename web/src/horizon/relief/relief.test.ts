import { describe, expect, it } from 'vitest'
import { R_M } from '../../terrain/tileset'
import {
  GroundStack,
  HORIZON_CLAMP_DEG,
  PATCH_N,
  PATCH_PAD,
  PATCH_TILE,
  PATCH_TILES,
  type PatchGrid,
  discFractionAbove,
  earthPhaseAngle,
  earthshineRatio,
  lightFromHorizon,
  patchOrigin,
  ringLightHorizon,
  ringNormals,
  sampleEnu,
  stackNormals,
  tileOf,
} from './light'
import { MIN_WEIGHT, patchBox, patchSource, visibleFarPatches } from './patches'
import { renderRelief, tone } from './render'
import { FINE_FEATHER, RING_COUNT, RING_N, RING_RATIO, enuToPlane, fineDemAt, mergeFine, planeFrame, planeToEnu, ringSpecs } from './rings'

const D = Math.PI / 180
const C = (RING_N - 1) / 2

/** Synthetic rings around a place: heights from a function of the local (east, north) offset in metres. */
function synthetic(lat: number, lon: number, base: number, height: (e: number, n: number) => number) {
  const f = planeFrame(lat, lon)
  const rings = Array.from({ length: RING_COUNT }, (_, k) => {
    const cellM = base * RING_RATIO ** k
    const heights = new Float32Array(RING_N * RING_N)
    for (let j = 0; j < RING_N; j++)
      for (let i = 0; i < RING_N; i++) {
        const [e, n] = sampleEnu(f, cellM, i, j)
        heights[j * RING_N + i] = height(e, n)
      }
    return { cellM, heights }
  })
  const stack = new GroundStack(rings, f)
  return { f, rings, stack, normals: rings.map((r) => ringNormals(r, f)) }
}

describe('ring geometry', () => {
  it('lays every ring in the stereographic plane of the place: east is +x, north is +y, true metres', () => {
    const f = planeFrame(12.3, -45.6)
    expect(enuToPlane(f, 1200, -3400)).toEqual([1200, -3400])
    expect(planeToEnu(f, 1200, -3400)).toEqual([1200, -3400])
    // a sample's (east, north) offset: column i grows eastwards, row j southwards, the centre is (0, 0)
    expect(sampleEnu(f, 5, C, C)).toEqual([0, 0])
    expect(sampleEnu(f, 5, C + 10, C - 4)).toEqual([50, 20])
  })

  it('chooses the finest DEM covering the place, at either pole, and the global DEM elsewhere', () => {
    const south = ringSpecs(-89.5, 0)!
    expect(south.map((s) => s.cellM)).toEqual([5, 20, 80, 320, 1280])
    expect(south[0].source.file).toBe('LRO_LOLA_DEM_SPole875_5mp_v04')
    const north = ringSpecs(89.5, 0)!
    expect(north[0].source.file).toBe('LRO_LOLA_DEM_NPole875_5mp_v04')
    expect(ringSpecs(-80, 10)![0].cellM).toBe(30)
    expect(ringSpecs(-60, 10)![0].cellM).toBe(100)
    // Apollo 11: the global LOLA DEM (118 m), first ring at 60 m; rings stop once one reaches past 250 km
    const a11 = ringSpecs(0.674, 23.473)!
    expect(a11.map((s) => s.cellM)).toEqual([60, 240, 960, 3840])
    // the 256 px/deg v06 DEM up to 240 m cells, the 128 px/deg v04 DEM from 960 m (faster for large rings)
    expect(a11.map((s) => s.source.file)).toEqual([
      'LRO_LOLA_DEM_Global_256ppd_v06',
      'LRO_LOLA_DEM_Global_256ppd_v06',
      'LRO_LOLA_DEM_Global_128ppd_v04',
      'LRO_LOLA_DEM_Global_128ppd_v04',
    ])
    expect(ringSpecs(Number.NaN, 0)).toBeNull()
  })

  it('asks Moon Trek for the ring box in a stereographic projection centred on the place, one extra row below', () => {
    const [spec] = ringSpecs(0.674, 23.473)!
    const url = decodeURIComponent(spec.url)
    expect(url).toContain('bbox=-15360,-15420,15360,15360')
    expect(url).toContain(`size=${RING_N},${RING_N + 1}`)
    const wkt: string = JSON.parse(new URL(spec.url).searchParams.get('imageSR')!).wkt
    expect(new URL(spec.url).searchParams.get('bboxSR')).toBe(new URL(spec.url).searchParams.get('imageSR'))
    expect(wkt).toContain('PROJECTION["Stereographic"]')
    expect(wkt).toContain('PARAMETER["Latitude_Of_Origin",0.674]')
    expect(wkt).toContain('PARAMETER["Central_Meridian",23.473]')
    expect(wkt).toContain('SPHEROID["Moon_2000_IAU_IAG",1737400.0,0.0]')
  })
})

describe('disc above a straight horizon', () => {
  it('is half at the centre, whole one radius up, and symmetric', () => {
    expect(discFractionAbove(5, 5, 0.27)).toBeCloseTo(0.5, 12)
    expect(discFractionAbove(5.27, 5, 0.27)).toBe(1)
    expect(discFractionAbove(4.73, 5, 0.27)).toBe(0)
    for (const x of [0.1, 0.4, 0.8]) expect(discFractionAbove(x, 0, 1) + discFractionAbove(-x, 0, 1)).toBeCloseTo(1, 12)
    // segment of height 1 - x: area (acos x - x sqrt(1 - x^2)) / pi below the line; x = 0.5 -> 0.1955 hidden
    expect(discFractionAbove(0.5, 0, 1)).toBeCloseTo(1 - (Math.acos(0.5) - 0.5 * Math.sqrt(0.75)) / Math.PI, 12)
  })
})

describe('sunlight on the rings', () => {
  const sun = { az: 0, el: 5, radiusDeg: 0.2666 }

  it('flat ground: nothing rises towards the Sun within reach, the whole disc is up', () => {
    const { stack, normals } = synthetic(-89.5, 0, 5, () => 0)
    const horizon = ringLightHorizon(stack, normals, sun)
    const centre = Math.round(C) * RING_N + Math.round(C)
    // the ray to the disc's lower edge clears every height at once: the horizon is kept at the clamp, far below
    expect(horizon[0][centre]).toBe(-HORIZON_CLAMP_DEG)
    expect(lightFromHorizon(horizon[0][centre], 0.2666)).toBe(1)
  })

  it('marks slopes facing away from the light as hidden', () => {
    const { stack, normals } = synthetic(-89.5, 0, 5, () => 0)
    const horizon = ringLightHorizon(stack, normals, { az: 0, el: -10, radiusDeg: 0.2666 })
    expect(horizon[0][Math.round(C) * RING_N + Math.round(C)]).toBe(HORIZON_CLAMP_DEG)
  })

  it('a 100 m step to the north (the Sun side) shades the ground in front of it up to atan(100 / d) = 5°', () => {
    // step at n = 200 m; d to it from a sample at n is 200 - n; shade ends where atan(100 / d) = el - r
    const { f, stack, normals } = synthetic(-89.5, 0, 5, (_e, n) => (n > 200 ? 100 : 0))
    const light = ringLightHorizon(stack, normals, sun)
    const at = (n: number) => {
      // sample of ring 0 nearest to (0, n)
      const [x, y] = enuToPlane(f, 0, n)
      const i = Math.round((x - f.x0) / 5 + C)
      const j = Math.round((f.y0 - y) / 5 + C)
      const [, nn] = sampleEnu(f, 5, i, j)
      return { v: lightFromHorizon(light[0][j * RING_N + i], 0.2666), d: 200 - nn }
    }
    const near = at(-200) // 400 m: atan(100/400) = 14°, deep shade
    expect(near.v).toBe(0)
    const far = at(-1000) // 1200 m: 4.76° < 5° - 0.27°: the whole disc is up
    expect(far.v).toBeCloseTo(1, 1)
    // in between, the expected share of the disc from the step's angle: shadow-ray steps are up to 3 cells (15 m)
    // long, which moves the step's angle by up to 0.07° at 1 km, a quarter of the disc: 0.2 of slack
    const mid = at(-930)
    const a = Math.atan(100 / mid.d) / D
    expect(Math.abs(mid.v - discFractionAbove(5, a, 0.2666))).toBeLessThan(0.2)
  })
})

describe('rendering', () => {
  it('a 50 m slope cresting 1 km to the north tops out at atan((50 - 1.7 - d^2/2R) / d) seen from 1.7 m', () => {
    // 27° slope from n = 900 m to its crest at n = 1000 m (20 cells of 5 m), a plateau behind
    const ramp = (n: number) => Math.min(50, Math.max(0, (n - 900) / 2))
    const { f, stack, normals, rings } = synthetic(-89.5, 0, 5, (_e, n) => ramp(n))
    const W = 64
    const H = 400
    const c = { yaw: 0, pitch: 0, cx: W / 2, cy: H / 2, degPerPx: 0.02 }
    const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4), colorSpace: 'srgb' } as ImageData
    // sunlit up to the crest, in shadow beyond (horizon 10° over the Sun): the slope is bright, the plateau is not.
    // Sun 20° up behind the eye, in the south: the slope faces it
    const sunlight = rings.map((r) => {
      const a = new Float32Array(RING_N * RING_N)
      for (let j = 0; j < RING_N; j++)
        for (let i = 0; i < RING_N; i++) a[j * RING_N + i] = sampleEnu(f, r.cellM, i, j)[1] <= 1000 ? -HORIZON_CLAMP_DEG : HORIZON_CLAMP_DEG
      return a
    })
    const sunDir: [number, number, number] = [0, -Math.cos(20 * D), Math.sin(20 * D)]
    renderRelief(img, 1, c, () => 10, { stack, normals, sunlight, eyeM: 1.7, sun: sunDir })
    const bright = 200 * tone(0.5)
    let top = H
    for (let j = 0; j < H; j++) {
      const o = 4 * (j * W + W / 2)
      if (img.data[o + 3] === 255 && img.data[o + 1] > bright) {
        top = j
        break
      }
    }
    const d = 1000
    const el = Math.atan2(50 - 1.7 - (d * d) / (2 * R_M), d) / D
    // one 5 m cell of this slope spans about 6 rows at 1 km and the light ramps over the last cell: 3 rows (0.06°)
    expect(Math.abs(top - (H / 2 - el / 0.02 - 0.5))).toBeLessThan(3)
    // above it the mask says 10°, but these rings are the whole relief (they reach past FULL_REACH_M) and put no
    // ground there: the band is left as sky, not painted
    expect(img.data[4 * (W / 2) + 3]).toBe(0)
    // while the relief is still incomplete (fillToMask) the band is painted, in the shade where the ray stopped
    renderRelief(img, 1, c, () => 10, { stack, normals, sunlight, eyeM: 1.7, sun: sunDir, fillToMask: true })
    expect(img.data[4 * (W / 2) + 3]).toBe(255)
    expect(img.data[4 * (W / 2) + 1]).toBeLessThan(bright)
  })

  it('paints only a hair of a gap between the drawn ground and the mask once the relief is whole', () => {
    // flat ground seen from 1.7 m: its horizon dips acos(R / (R + 1.7)) = 0.08° under the level
    const { stack, normals } = synthetic(-89.5, 0, 5, () => 0)
    const W = 8
    const H = 200
    const c = { yaw: 0, pitch: 0, cx: W / 2, cy: H / 2, degPerPx: 0.01 }
    const topRow = (maskDeg: number) => {
      const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4), colorSpace: 'srgb' } as ImageData
      renderRelief(img, 1, c, () => maskDeg, { stack, normals, sunlight: null, eyeM: 1.7, sun: [0, 1, 0] })
      for (let j = 0; j < H; j++) if (img.data[4 * (j * W + W / 2) + 3] === 255) return j
      return H
    }
    const dip = Math.acos(R_M / (R_M + 1.7)) / D
    const ground = H / 2 + dip / 0.01
    // a mask 0.05° above the ground's own horizon (under MASK_GAP_DEG = 0.08°): painted up to it
    expect(Math.abs(topRow(-dip + 0.05) - (ground - 5))).toBeLessThan(1.5)
    // a mask 0.5° above it: the ground stops at its own horizon
    expect(Math.abs(topRow(-dip + 0.5) - ground)).toBeLessThan(1.5)
  })

  it('draws the ground below an eye that is above every height in the rings, out to its own horizon', () => {
    const { stack, normals } = synthetic(-89.5, 0, 5, () => 0)
    const W = 8
    const H = 200
    const c = { yaw: 0, pitch: -3, cx: W / 2, cy: H / 2, degPerPx: 0.05 }
    const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4), colorSpace: 'srgb' } as ImageData
    // 2 km up: the horizon of the smooth Moon dips acos(R / (R + 2000)) = 2.75°
    renderRelief(img, 1, c, () => 0, { stack, normals, sunlight: null, eyeM: 2000, sun: [0, 1, 0] })
    let top = H
    for (let j = 0; j < H; j++)
      if (img.data[4 * (j * W + W / 2) + 3] === 255) {
        top = j
        break
      }
    const dip = Math.acos(R_M / (R_M + 2000)) / D
    expect(Math.abs(top - (H / 2 - (-dip + 3) / 0.05))).toBeLessThan(2)
  })

  it('draws a wall that rises above the mask up to its own silhouette', () => {
    const { stack, normals } = synthetic(-89.5, 0, 5, (_e, n) => (n > 300 ? 400 : 0))
    const W = 32
    const H = 300
    const c = { yaw: 0, pitch: 0, cx: W / 2, cy: H / 2, degPerPx: 0.1 }
    const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4), colorSpace: 'srgb' } as ImageData
    // the cliff rises to atan(398.3 / 300) = 53°, beyond the top of this 30° field; the mask says 2°
    renderRelief(img, 1, c, () => 2, { stack, normals, sunlight: null, eyeM: 1.7, sun: [0, 1, 0] })
    for (let j = 0; j < H; j++) expect(img.data[4 * (j * W + W / 2) + 3]).toBe(255)
  })

  it('stops at the ground silhouette below the top of the view', () => {
    // a 100 m rise 2 km north: atan((98.3 - 1.15) / 2000) = 2.78° above the eye; the mask says 0°
    const { stack, normals } = synthetic(-89.5, 0, 20, (_e, n) => (n > 2000 ? 100 : 0))
    const W = 32
    const H = 300
    const c = { yaw: 0, pitch: 0, cx: W / 2, cy: H / 2, degPerPx: 0.1 }
    const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4), colorSpace: 'srgb' } as ImageData
    renderRelief(img, 1, c, () => 0, { stack, normals, sunlight: null, eyeM: 1.7, sun: [0, 1, 0] })
    let top = H
    for (let j = 0; j < H; j++)
      if (img.data[4 * (j * W + W / 2) + 3] > 0) {
        top = j
        break
      }
    const el = Math.atan2(100 - 1.7 - (2000 * 2000) / (2 * R_M), 2000) / D
    expect(Math.abs(top - (H / 2 - el / 0.1 - 0.5))).toBeLessThan(2)
  })
})

describe('earthshine', () => {
  it('is A (2/3) (r/d)^2 of sunlight at full Earth, 1/pi of that at quarter, nothing at new Earth', () => {
    const full = 0.29 * (2 / 3) * (6371 / 384_400) ** 2
    expect(earthshineRatio(0, 384_400)).toBeCloseTo(full, 12)
    expect(full).toBeCloseTo(5.31e-5, 7)
    expect(earthshineRatio(90, 384_400)).toBeCloseTo(full / Math.PI, 12)
    expect(earthshineRatio(180, 384_400)).toBeCloseTo(0, 12)
  })

  it('takes the phase angle from the Sun and the Earth in the sky: opposite means full Earth', () => {
    expect(earthPhaseAngle({ az: 0, el: -30 }, { az: 180, el: 30 })).toBeCloseTo(0, 9)
    expect(earthPhaseAngle({ az: 90, el: 0 }, { az: 0, el: 0 })).toBeCloseTo(90, 9)
    expect(earthPhaseAngle({ az: 45, el: 10 }, { az: 45, el: 10 })).toBeCloseTo(180, 9)
  })

  it('shows the relief at night: earthlit ground with the exposure raised reads like day, unlit ground stays dark', () => {
    const { stack, normals } = synthetic(10, 20, 60, () => 0)
    const W = 16
    const H = 200
    const c = { yaw: 0, pitch: -10, cx: W / 2, cy: H / 2, degPerPx: 0.1 }
    const ratio = earthshineRatio(0, 384_400)
    const draw = (earthlight: Float32Array[] | null) => {
      const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4), colorSpace: 'srgb' } as ImageData
      renderRelief(img, 1, c, () => -5, {
        stack,
        normals,
        sunlight: normals.map(() => new Float32Array(RING_N * RING_N).fill(HORIZON_CLAMP_DEG)),
        eyeM: 1.7,
        sun: [0, 0, -1],
        earthlight,
        earth: [0, -Math.cos(30 * D), Math.sin(30 * D)],
        earthRatio: ratio,
        exposure: 0.6 / ratio,
      })
      return img.data[4 * ((H - 1) * W + W / 2) + 1]
    }
    // flat ground, Earth 30° up behind the eye, nothing above it: mu0 = sin 30° = 0.5
    const lit = draw(normals.map(() => new Float32Array(RING_N * RING_N).fill(-HORIZON_CLAMP_DEG)))
    const dark = draw(null)
    expect(dark).toBe(Math.round(200 * tone(0)))
    expect(lit).toBeGreaterThan(200 * tone(0.25))
  })
})

describe('high-resolution DTMs', () => {
  it('uses the LROC NAC DTM at Apollo 15 (Hadley Rille) for the inner rings, LOLA beyond', () => {
    expect(fineDemAt(26.13, 3.63)?.file).toBe('LRO_NAC_DEM_26N004E_150cmp')
    const specs = ringSpecs(26.13, 3.63)!
    expect(specs[0].cellM).toBeCloseTo(1.58, 2)
    // the DTM serves rings up to 16 times its cell: 1.58, 6.32 and 25.3 m
    expect(specs.filter((s) => s.fine).map((s) => Math.round(s.cellM * 100) / 100)).toEqual([1.58, 6.32, 25.28])
    expect(specs[0].source.file).toBe('LRO_LOLA_DEM_Global_256ppd_v06')
    expect(fineDemAt(0.674, 23.473)).toBeNull()
  })

  it('normalises the DTM to LOLA by its mean offset and feathers it in from the edge of its data', () => {
    const n = RING_N
    const lola = new Float32Array(n * n) // LOLA: flat at 0 m
    const fine = new Float32Array(n * n).fill(Number.NaN)
    // a 100 x 100 patch of DTM, 25 m above LOLA, with a 2 m boulder at its centre
    for (let j = 200; j < 300; j++) for (let i = 200; i < 300; i++) fine[j * n + i] = 25
    fine[250 * n + 250] = 27
    const { share, offsetM } = mergeFine(lola, fine)
    expect(share).toBeCloseTo(10_000 / (n * n), 9)
    expect(offsetM).toBeCloseTo(25 + 2 / 10_000, 6)
    // the boulder stands 2 m (less the offset's share) over the flat ground, deep inside the patch (weight 1)
    expect(lola[250 * n + 250]).toBeCloseTo(2 - 2 / 10_000, 4)
    expect(lola[250 * n + 251]).toBeCloseTo(-2 / 10_000, 4)
    // at the patch's edge the weight is 1 / FINE_FEATHER, outside it LOLA is untouched
    expect(lola[200 * n + 250]).toBeCloseTo((1 / FINE_FEATHER) * (-2 / 10_000), 7)
    expect(lola[199 * n + 250]).toBe(0)
  })
})

describe('photo albedo', () => {
  it('divides each byte by the place mean, leaving photographed shadows out of the mean', async () => {
    const { photoAlbedo, photoMean, ALBEDO_MIN } = await import('./rings')
    const grey = new Uint8Array(100).map((_, i) => (i < 20 ? 0 : i % 2 ? 120 : 80))
    const m = photoMean(grey)!
    expect(m).toBeCloseTo(100, 5)
    const a = photoAlbedo(grey, m)
    expect(a[0]).toBeCloseTo(ALBEDO_MIN, 5)
    expect(a[20]).toBeCloseTo(0.8, 5)
    expect(a[21]).toBeCloseTo(1.2, 5)
    expect(photoMean(new Uint8Array(100))).toBeNull()
  })

  it('takes the place mean from the finest ring with a usable photo', async () => {
    const { placePhotoMean } = await import('./rings')
    const rings = [
      { cellM: 60, photo: new Uint8Array(10) },
      { cellM: 960, photo: new Uint8Array(10).fill(90) },
      { cellM: 240, photo: new Uint8Array(10).fill(50) },
      { cellM: 120 },
    ]
    expect(placePhotoMean(rings)).toBe(50)
  })
})

describe('far detail tiles', () => {
  it('finds the tile of a wall 60 km north and samples its photo there', async () => {
    const { visibleFarTiles, detailSampler, tileKey, TILE_PX, TILE_M } = await import('./detailPhoto')
    // flat ground, then a 2 km wall from 60 km north on: the wall is in view, the ground behind it is not
    const { stack } = synthetic(-89.5, 0, 5, (_e, n) => (n > 60_000 ? 2000 : 0))
    const tiles = visibleFarTiles(stack, 1.7)
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles[0]).toMatchObject({ ix: 0, iy: Math.floor(60_000 / TILE_M + 0.5) })
    const g = new Uint8Array(TILE_PX * TILE_PX).fill(150)
    const at = detailSampler(new Map([[tileKey(tiles[0].ix, tiles[0].iy), g]]), 100)
    expect(at(0, 60_500)).toBeCloseTo(1.5, 5)
    expect(at(0, 0)).toBeNaN()
  })
})

describe('Kaguya TC tiles', () => {
  it('turns plane metres into latitude and longitude (inverse local stereographic)', async () => {
    const { planeToLatLon } = await import('./kaguya')
    const out = new Float64Array(2)
    const c = (0.5 * Math.PI) / 180 // half a degree of arc
    planeToLatLon(26.571, 150.851, 0, 2 * R_M * Math.tan(c / 2), out)
    expect(out[0]).toBeCloseTo(27.071, 6)
    expect(out[1]).toBeCloseTo(150.851, 6)
    planeToLatLon(0, 179.9, 2 * R_M * Math.tan(c / 2), 0, out)
    expect(out[0]).toBeCloseTo(0, 6)
    expect(out[1]).toBeCloseTo(-179.6, 6) // across the date line
  })

  it('samples the tile under a point and gives NaN where none is loaded', async () => {
    const { kaguyaSampler, kKey, KTILE_DEG, KTILE_PX } = await import('./kaguya')
    const lat0 = 26.571
    const lon0 = 150.851
    const col = Math.floor((lon0 + 180) / KTILE_DEG)
    const row = Math.floor((90 - lat0) / KTILE_DEG)
    const g = new Uint8Array(KTILE_PX * KTILE_PX).fill(60)
    const at = kaguyaSampler(new Map([[kKey(col, row), g]]), 40, lat0, lon0)
    expect(at(0, 0)).toBeCloseTo(1.5, 5)
    expect(at(0, 50_000)).toBeNaN()
  })
})

describe('far relief patches', () => {
  /** The patch of tile (tc, tr) of the ring of `parentCellM` cells, heights from a function of (east, north). */
  function patch(lat: number, lon: number, parentCellM: number, tc: number, tr: number, height: (e: number, n: number) => number): PatchGrid {
    const f = planeFrame(lat, lon)
    const cellM = parentCellM / RING_RATIO
    const heights = new Float32Array(PATCH_N * PATCH_N)
    for (let j = 0; j < PATCH_N; j++)
      for (let i = 0; i < PATCH_N; i++) {
        const [e, n] = sampleEnu(f, cellM, i, j, patchOrigin(tc), patchOrigin(tr))
        heights[j * PATCH_N + i] = height(e, n)
      }
    return { cellM, heights, parentCellM, tc, tr }
  }

  it('cuts a ring into 8 x 8 tiles of 64 cells; the four middle ones belong to the next finer ring', () => {
    expect(PATCH_TILES).toBe(8)
    expect(PATCH_N).toBe(PATCH_TILE * RING_RATIO + 2 * PATCH_PAD)
    // ring sample (0, 0) is the north-west corner: tile column 0, row 0; sample (511, 0) the north-east one
    expect(tileOf(0, 0)).toBe(0)
    expect(tileOf(511, 0)).toBe(7)
    expect(tileOf(100, 500)).toBe(7 * 8 + 1)
    // the centre and everything the inner ring holds (C ± C / 4 = 191.6 to 319.4)
    expect(tileOf(C, C)).toBe(-1)
    expect(tileOf(192, 319)).toBe(-1)
    // the sliver between the inner ring's last sample and the middle tiles' edge (191.5) goes to the tile outside
    // (the centre, 255.5, is the first half cell of column and row 4)
    expect(tileOf(191.55, C)).toBe(4 * 8 + 2)
    expect(tileOf(C, 319.45)).toBe(5 * 8 + 4)
  })

  it('lays a patch on the lattice of the next finer ring: tile 6, 2 of a 240 m ring starts 30 720 m east and north', () => {
    // ring half-width 256 x 240 = 61 440 m; tile 64 x 240 = 15 360 m; the apron is 2 cells of 60 m on every side
    expect(patchBox(240, 6, 2)).toEqual([30_720 - 120, 15_360 - 120, 46_080 + 120, 30_720 + 120])
    const f = planeFrame(10, 20)
    // its first sample inside the tile (index PATCH_PAD) sits half a 60 m cell inside the tile's north-west corner
    expect(sampleEnu(f, 60, PATCH_PAD, PATCH_PAD, patchOrigin(6), patchOrigin(2))).toEqual([30_750, 30_690])
    // and patches side by side share their lattice: sample 256 + i of one is sample i of the next
    const a = sampleEnu(f, 60, 256 + 1, 5, patchOrigin(5), patchOrigin(2))
    const b = sampleEnu(f, 60, 1, 5, patchOrigin(6), patchOrigin(2))
    expect(a).toEqual(b)
  })

  it('reads the patch where one covers the point and the ring elsewhere', () => {
    // the rings say 0 everywhere; the patch over tile 6, 2 of the 240 m ring says 100 + e / 100
    const { f, rings } = synthetic(10, 20, 60, () => 0)
    const p = patch(10, 20, 240, 6, 2, (e) => 100 + e / 100)
    const stack = new GroundStack(rings, f, [p])
    const tmp = new Float64Array(3)
    const drop = (e: number, n: number) => (e * e + n * n) / (2 * R_M)
    // inside the tile (east 30 720 to 46 080, north 15 360 to 30 720): the patch, exact for a plane
    expect(stack.level(40_000, 20_000, tmp)).toBeCloseTo(100 + 400 - drop(40_000, 20_000), 3)
    expect(stack.locateFine(40_000, 20_000, tmp)).toBe(rings.length)
    expect(tmp[2]).toBe(1)
    // right at its edges, still the patch (its apron holds the samples around them)
    expect(stack.level(30_721, 15_361, tmp)).toBeCloseTo(100 + 307.21 - drop(30_721, 15_361), 3)
    expect(stack.level(46_079, 30_719, tmp)).toBeCloseTo(100 + 460.79 - drop(46_079, 30_719), 3)
    // one tile west, and beyond the ring: the rings
    expect(stack.level(20_000, 20_000, tmp)).toBeCloseTo(-drop(20_000, 20_000), 6)
    expect(stack.level(40_000, 100_000, tmp)).toBeCloseTo(-drop(40_000, 100_000), 6)
    expect(stack.maxU).toBeCloseTo(100 + 462, 0)
  })

  it('draws a far ridge at its true height from a patch, where the ring alone flattens it', () => {
    // a ridge 1000 m high and 1 km wide at its base, its crest 40 080 m north: half-way between two samples of the
    // 240 m ring (39 960 and 40 200 m), which therefore holds 1000 (1 - 120 / 500) = 760 m at most there. The 60 m
    // patch has samples 30 m each side of the crest (40 050 and 40 110 m): 940 m, and every 60 m step of the ray
    // lands between them
    const crest = 40_080
    const ridge = (_e: number, n: number) => Math.max(0, 1000 * (1 - Math.abs(n - crest) / 500))
    const { f, rings, normals } = synthetic(10, 20, 60, ridge)
    // tile 4, 1 of the 240 m ring: east 0 to 15 360 m, north 30 720 to 46 080 m
    const withPatch = new GroundStack(rings, f, [patch(10, 20, 240, 4, 1, ridge)])
    const W = 8
    const H = 400
    // looking 6° east of north, through the tile: the crest is met 40 080 / cos 6° away
    const t = crest / Math.cos(6 * D)
    const elOf = (h: number) => Math.atan2(h - 1.7 - (t * t) / (2 * R_M), t) / D
    const c = { yaw: 6, pitch: elOf(1000), cx: W / 2, cy: H / 2, degPerPx: 0.004 }
    const topEl = (stack: GroundStack, n: Float32Array[]) => {
      const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4), colorSpace: 'srgb' } as ImageData
      renderRelief(img, 1, c, () => -90, { stack, normals: n, sunlight: null, eyeM: 1.7, sun: [0, 1, 0] })
      for (let j = 0; j < H; j++) if (img.data[4 * (j * W + W / 2) + 3] === 255) return c.pitch + (H / 2 - j - 0.5) * 0.004
      return NaN
    }
    // with the patch: the 940 m its samples hold, 0.085° under the true crest
    expect(elOf(1000) - elOf(940)).toBeCloseTo(0.085, 3)
    expect(Math.abs(topEl(withPatch, stackNormals(withPatch)) - elOf(940))).toBeLessThan(0.01)
    // the ring alone: 760 m at best (0.34° under the crest), less where its 240 m steps fall beside the samples
    expect(topEl(new GroundStack(rings, f), normals)).toBeLessThan(elOf(760) + 0.01)
  })

  it('lights the patch itself and casts its shadow on the ring samples behind it', () => {
    // a wall 600 m high from north 36 km on, inside the patch of tile 4, 1 of the 240 m ring; the Sun 2° up in the north
    const wall = (_e: number, n: number) => (n > 36_000 ? 600 : 0)
    const { f, rings } = synthetic(10, 20, 60, () => 0)
    const p = patch(10, 20, 240, 4, 1, wall)
    const stack = new GroundStack(rings, f, [p])
    const light = ringLightHorizon(stack, stackNormals(stack), { az: 0, el: 2, radiusDeg: 0.2666 })
    expect(light).toHaveLength(rings.length + 1)
    expect(light[rings.length]).toHaveLength(PATCH_N * PATCH_N)
    const tmp = new Float64Array(3)
    const at = (e: number, n: number) => {
      const g = stack.locateFine(e, n, tmp)
      return lightFromHorizon(light[g][Math.round(tmp[1]) * stack.size[g] + Math.round(tmp[0])], 0.2666)
    }
    // 1 km south of the wall, in the patch: the wall stands atan(600 / 1000) = 31° up, over the Sun
    expect(at(7000, 35_000)).toBe(0)
    // on the wall's top: nothing north of it
    expect(at(7000, 40_000)).toBe(1)
    // 6 km south of the wall, on the 240 m ring outside the patch (north 30 000 m). There the vertical leans
    // 30 000 / R = 0.99° towards the Sun, which stands 2.99° over that ground, its upper edge at 3.26°; the wall's
    // top, 6000^2 / 2R = 10 m lower by the curvature, stands atan(590 / 6000) = 5.6° up: full shadow
    expect(at(7000, 30_000)).toBe(0)
    // 20 km south of it (north 16 000 m, same ring): atan((600 - 115) / 20 000) = 1.4°, under the Sun's lower edge
    expect(at(7000, 16_000)).toBe(1)
    // the ring samples well inside the patch's tile are left to the patch (not computed)
    expect(light[1][Math.round(C - 36_000 / 240) * RING_N + Math.round(C + 7000 / 240)]).toBe(0)
  })

  it('picks the tiles of a far hill in view and asks for them four times finer, where LOLA has finer data', () => {
    // a hill 1500 m high, 6 km across, 40 km north of Apollo 11 (global DEM: rings of 60, 240, 960 and 3840 m)
    const specs = ringSpecs(0.674, 23.473)!
    const hill = (e: number, n: number) => Math.max(0, 1500 * (1 - Math.hypot(e, n - 40_000) / 3000))
    const f = planeFrame(0.674, 23.473)
    const rings = specs.map((s) => {
      const heights = new Float32Array(RING_N * RING_N)
      for (let j = 0; j < RING_N; j++)
        for (let i = 0; i < RING_N; i++) {
          const [e, n] = sampleEnu(f, s.cellM, i, j)
          heights[j * RING_N + i] = hill(e, n)
        }
      return { cellM: s.cellM, heights }
    })
    const want = visibleFarPatches(new GroundStack(rings, f), 1.7, specs, 0.674, 23.473)
    // the hill straddles east = 0 between north 37 and 43 km: tiles 3 and 4 of row 1 of the 240 m ring
    expect(want.length).toBeGreaterThanOrEqual(2)
    expect(want.slice(0, 2).map((w) => [w.parentCellM, w.tc, w.tr]).sort()).toEqual([
      [240, 3, 1],
      [240, 4, 1],
    ])
    expect(want.every((w) => w.weight >= MIN_WEIGHT)).toBe(true)
    const first = want.find((w) => w.tc === 4)!
    expect(first.cellM).toBe(60)
    expect(first.source.file).toBe('LRO_LOLA_DEM_Global_256ppd_v06')
    const url = decodeURIComponent(first.url)
    // east 0 to 15 360 m, north 30 720 to 46 080 m, 120 m of apron, one extra row of 60 m below
    expect(url).toContain('bbox=-120,30540,15480,46200')
    expect(url).toContain(`size=${PATCH_N},${PATCH_N + 1}`)
  })

  it('asks for no patch where no DEM is finer than the ring', () => {
    // Apollo 15: the rings start at the NAC DTM's 1.6 m; the 102 m ring is already at the global DEM's 118 m
    const specs = ringSpecs(26.13, 3.63)!
    const ring102 = specs.find((s) => Math.abs(s.cellM - 102) < 2)!
    expect(patchSource(26.13, 3.63, ring102, 6, 2)).toBeNull()
    // the 410 m ring is not: its patches read the 118 m DEM at 102 m
    const ring410 = specs.find((s) => Math.abs(s.cellM - 410) < 6)!
    expect(patchSource(26.13, 3.63, ring410, 6, 2)?.file).toBe('LRO_LOLA_DEM_Global_256ppd_v06')
    // near the south pole a 320 m ring is refined to 80 m from the 30 m polar DEM
    const polar = ringSpecs(-89.5, 0)!
    expect(patchSource(-89.5, 0, polar[3], 6, 2)?.file).toBe('LRO_LOLA_DEM_SPole75_30mp_v04')
  })
})
