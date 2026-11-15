import { describe, expect, it } from 'vitest'
import { R_M } from '../../terrain/tileset'
import { GroundStack, discFractionAbove, earthPhaseAngle, earthshineRatio, ringNormals, ringSunlight, sampleEnu } from './light'
import { renderRelief, tone } from './render'
import { RING_COUNT, RING_N, RING_RATIO, enuToPlane, planeFrame, planeToEnu, ringSpecs } from './rings'

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

  it('flat ground: the cosine of the incidence, no shadow', () => {
    const { stack, normals } = synthetic(-89.5, 0, 5, () => 0)
    const light = ringSunlight(stack, normals, sun)
    const centre = Math.round(C) * RING_N + Math.round(C)
    expect(light[0][centre]).toBeCloseTo(Math.sin(5 * D), 3)
  })

  it('a 100 m step to the north (the Sun side) shades the ground in front of it up to atan(100 / d) = 5°', () => {
    // step at n = 200 m; d to it from a sample at n is 200 - n; shade ends where atan(100 / d) = el - r
    const { f, stack, normals } = synthetic(-89.5, 0, 5, (_e, n) => (n > 200 ? 100 : 0))
    const light = ringSunlight(stack, normals, sun)
    const at = (n: number) => {
      // sample of ring 0 nearest to (0, n)
      const [x, y] = enuToPlane(f, 0, n)
      const i = Math.round((x - f.x0) / 5 + C)
      const j = Math.round((f.y0 - y) / 5 + C)
      const [, nn] = sampleEnu(f, 5, i, j)
      return { v: light[0][j * RING_N + i] / Math.sin(5 * D), d: 200 - nn }
    }
    const near = at(-200) // 400 m: atan(100/400) = 14°, deep shade
    expect(near.v).toBe(0)
    const far = at(-1000) // 1200 m: 4.76° < 5° - 0.27°: the whole disc is up
    expect(far.v).toBeCloseTo(1, 1)
    // in between, the expected share of the disc from the step's angle (steps are a few cells long: 0.15 of slack)
    const mid = at(-930)
    const a = Math.atan(100 / mid.d) / D
    expect(Math.abs(mid.v - discFractionAbove(5, a, 0.2666))).toBeLessThan(0.15)
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
    // sunlit up to the crest, dark beyond: the slope is bright, the plateau and the band filled above it are not
    const sunlight = rings.map((r) => {
      const a = new Float32Array(RING_N * RING_N)
      for (let j = 0; j < RING_N; j++) for (let i = 0; i < RING_N; i++) a[j * RING_N + i] = sampleEnu(f, r.cellM, i, j)[1] <= 1000 ? 0.9 : 0
      return a
    })
    renderRelief(img, 1, c, () => 10, { stack, normals, sunlight, eyeM: 1.7, sun: [0, -1, 0], grain: null })
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
    // above it, up to the mask (10°), the band beyond what can show, filled to the mask in the shade where the ray stopped
    expect(img.data[4 * (W / 2) + 3]).toBe(255)
    expect(img.data[4 * (W / 2) + 1]).toBeLessThan(bright)
  })

  it('never draws above the mask', () => {
    const { stack, normals } = synthetic(-89.5, 0, 5, (_e, n) => (n > 300 ? 400 : 0))
    const W = 32
    const H = 300
    const c = { yaw: 0, pitch: 0, cx: W / 2, cy: H / 2, degPerPx: 0.1 }
    const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4), colorSpace: 'srgb' } as ImageData
    // the cliff would rise to atan(398.3 / 300) = 53°; the mask says 2°
    renderRelief(img, 1, c, () => 2, { stack, normals, sunlight: null, eyeM: 1.7, sun: [0, 1, 0], grain: null })
    const maskRow = Math.ceil(H / 2 - 2 / 0.1 - 0.5)
    for (let j = 0; j < maskRow; j++) expect(img.data[4 * (j * W + W / 2) + 3]).toBe(0)
    expect(img.data[4 * (maskRow * W + W / 2) + 3]).toBe(255)
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
        sunlight: normals.map(() => new Float32Array(RING_N * RING_N)),
        eyeM: 1.7,
        sun: [0, 0, -1],
        earthlight,
        earth: [0, -Math.cos(30 * D), Math.sin(30 * D)],
        earthRatio: ratio,
        exposure: 0.6 / ratio,
        grain: null,
      })
      return img.data[4 * ((H - 1) * W + W / 2) + 1]
    }
    // flat ground, Earth 30° up behind the eye: mu0 = sin 30° = 0.5
    const lit = draw(normals.map(() => new Float32Array(RING_N * RING_N).fill(0.5)))
    const dark = draw(null)
    expect(dark).toBe(Math.round(200 * tone(0)))
    expect(lit).toBeGreaterThan(200 * tone(0.25))
  })
})
