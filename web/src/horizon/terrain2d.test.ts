import { describe, expect, it } from 'vitest'
import { cameraFor, project } from './project'
import {
  EARTH_BOND_ALBEDO,
  type LandscapeScene,
  TAPER_SAMPLES,
  bufferScale,
  dropShortRuns,
  faceLight,
  grain,
  lightAt,
  nextBudget,
  planesFromApi,
  renderLandscape,
  sampleRing,
} from './terrain2d'

const sun = (az: number, el: number, fraction = 1) => ({ az, el, fraction, radiusDeg: 0.27 })
const earth = (az: number, el: number, fraction = 1) => ({ az, el, fraction, radiusDeg: 0.95 })
const TAN20 = Math.tan((20 * Math.PI) / 180)

describe('light on a face', () => {
  it('is brighter with the Sun behind the viewer than with the Sun behind the ridge', () => {
    // looking north (azimuth 0): the face of a ridge looks back at the viewer
    const behindViewer = faceLight(lightAt(0, sun(180, 10), earth(90, -20, 0), 0.5), TAN20, 0)
    const behindRidge = faceLight(lightAt(0, sun(0, 10), earth(90, -20, 0), 0.5), TAN20, 0)
    expect(behindViewer[0]).toBeGreaterThan(0.4)
    expect(behindRidge[0]).toBe(0) // the face is turned away: no sunlight
    // hand value: n = (0, -sin20, cos20), s = (0, -cos10, sin10) -> n.s = sin20 cos10 + cos20 sin10 = sin30
    expect(behindViewer[0]).toBeCloseTo(0.5, 6)
  })

  it('treats mirrored slopes and mirrored Suns the same', () => {
    const l = lightAt(0, sun(60, 8), earth(0, -30, 0), 0.5)
    const r = lightAt(0, sun(300, 8), earth(0, -30, 0), 0.5)
    expect(faceLight(l, TAN20, 0.3)[0]).toBeCloseTo(faceLight(r, TAN20, -0.3)[0], 12)
    // a face rising to the right turns towards a Sun on the left
    expect(faceLight(r, TAN20, 0.3)[0]).toBeGreaterThan(faceLight(l, TAN20, 0.3)[0])
  })

  it('goes dark without the Sun, down to the Earthshine term A θ² k', () => {
    const l = lightAt(0, sun(180, 10, 0), earth(180, 30, 1), 0.8)
    const out = faceLight(l, 0, 0)
    expect(out[0]).toBe(0)
    const theta = (0.95 * Math.PI) / 180
    expect(out[1]).toBeCloseTo(EARTH_BOND_ALBEDO * theta * theta * 0.8 * Math.sin(Math.PI / 6), 10)
    expect(out[1]).toBeLessThan(1e-4) // about four orders of magnitude below sunlight
    // no Sun and no Earth: nothing
    expect(faceLight(lightAt(0, sun(180, 10, 0), earth(180, 30, 0), 0.8), 0, 0)[1]).toBe(0)
  })
})

describe('grain', () => {
  it('is deterministic, stays around 1 and vanishes where its features are smaller than a pixel', () => {
    expect(grain(12.3, -4.5, -5)).toBe(grain(12.3, -4.5, -5))
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < 2000; i++) {
      const g = grain(i * 0.731, i * 0.377, -6)
      lo = Math.min(lo, g)
      hi = Math.max(hi, g)
    }
    expect(lo).toBeGreaterThanOrEqual(0.3)
    expect(hi).toBeLessThanOrEqual(1.9)
    expect(hi - lo).toBeGreaterThan(0.1)
    // one pixel = 1 km of ground: every octave (largest 256 m) is under a pixel
    expect(grain(5000, 3000, 10)).toBe(1)
  })
})

describe('layers from the API', () => {
  const ring = (n: number, f: (i: number) => number | null) => Array.from({ length: n }, (_, i) => f(i))

  it('drops spikes and keeps real runs', () => {
    const has = Uint8Array.from([1, 0, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0])
    dropShortRuns(has, 3)
    expect(Array.from(has)).toEqual([0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0])
    const wrap = Uint8Array.from([1, 1, 0, 0, 0, 0, 1])
    dropShortRuns(wrap, 3)
    expect(Array.from(wrap)).toEqual([1, 1, 0, 0, 0, 0, 1]) // a run of 3 across the end
  })

  it('fills a nearer layer with the one behind and tapers the ends of a crest', () => {
    const n = 60
    const p = planesFromApi({
      azStepDeg: 6,
      skylineDistanceKm: ring(n, () => 20),
      planes: [
        { elevation_deg: ring(n, (i) => (i >= 20 && i < 30 ? 2 : null)), distance_km: ring(n, (i) => (i >= 20 && i < 30 ? 1 : null)) },
        { elevation_deg: ring(n, () => 5), distance_km: ring(n, () => 20) },
      ],
    })!
    expect(p.el).toHaveLength(2)
    expect(p.el[0][25]).toBe(2)
    expect(p.dist[0][25]).toBe(1000)
    // far from the crest: the layer behind
    expect(p.el[0][0]).toBe(5)
    expect(p.dist[0][0]).toBe(20_000)
    // beside the crest: between the two, rising monotonically to the layer behind
    for (let g = 1; g <= TAPER_SAMPLES; g++) {
      expect(p.el[0][29 + g]).toBeGreaterThan(p.el[0][29 + g - 1])
      expect(p.el[0][29 + g]).toBeLessThan(5)
      expect(p.el[0][20 - g]).toBeCloseTo(p.el[0][29 + g], 6)
    }
    expect(p.el[0][29 + TAPER_SAMPLES + 1]).toBe(5)
    // never above or beyond the layer behind
    for (let i = 0; i < n; i++) {
      expect(p.el[0][i]).toBeLessThanOrEqual(p.el[1][i])
      expect(p.dist[0][i]).toBeLessThanOrEqual(p.dist[1][i])
    }
    expect(planesFromApi(null)).toBeNull()
  })

  it('interpolates around the ring and tolerates gaps', () => {
    const a = Float32Array.from([0, 10, NaN, 30])
    expect(sampleRing(a, 90, 45)).toBe(5)
    expect(sampleRing(a, 90, 315)).toBe(15) // wraps: between 30 and 0
    expect(sampleRing(a, 90, 100)).toBe(10) // next to a gap: the neighbour with data
    expect(Number.isNaN(sampleRing(Float32Array.from([NaN, NaN]), 180, 10))).toBe(true)
  })
})

describe('landscape painter', () => {
  const W = 320
  const H = 200
  const camera = cameraFor(100, 2, 80, W, W / 2, H * 0.55)
  const skyline = (az: number) => 4 + 3 * Math.sin((az * Math.PI) / 30)
  const planes = {
    azStepDeg: 0.5,
    el: [Float32Array.from({ length: 720 }, (_, i) => 1 + Math.sin(i / 25)), Float32Array.from({ length: 720 }, (_, i) => skyline(i / 2))],
    dist: [Float32Array.from({ length: 720 }, () => 400), Float32Array.from({ length: 720 }, () => 12_000)],
  }
  const scene = (over: Partial<LandscapeScene> = {}): LandscapeScene => ({ camera, skyline, planes, sun: sun(250, 6), earth: earth(20, 4), ...over })
  const paint = (s: LandscapeScene) => {
    const buf = new Uint8ClampedArray(W * H * 4)
    renderLandscape(buf, W, H, 1, s)
    return buf
  }
  const skyY = (x: number) => project(camera, camera.yaw + (x + 0.5 - camera.cx) * camera.degPerPx, skyline(camera.yaw + (x + 0.5 - camera.cx) * camera.degPerPx)).y

  it('paints nothing above the skyline and is opaque below it', () => {
    const buf = paint(scene())
    for (let x = 0; x < W; x += 7) {
      const y0 = skyY(x)
      for (let y = 0; y < H; y++) {
        const a = buf[(y * W + x) * 4 + 3]
        if (y + 1 <= y0) expect(a).toBe(0)
        if (y >= y0 + 1) expect(a).toBe(255)
      }
    }
  })

  it('keeps a nearer layer below the skyline even when its data says otherwise', () => {
    const tall = { ...planes, el: [Float32Array.from({ length: 720 }, () => 40), planes.el[1]] }
    const buf = paint(scene({ planes: tall }))
    for (let x = 0; x < W; x += 11) for (let y = 0; y + 1 <= skyY(x); y++) expect(buf[(y * W + x) * 4 + 3]).toBe(0)
  })

  it('is lit with the Sun up and nearly black with the Sun hidden', () => {
    const mean = (buf: Uint8ClampedArray) => {
      let s = 0
      let k = 0
      for (let i = 0; i < buf.length; i += 4)
        if (buf[i + 3] === 255) {
          s += buf[i]
          k++
        }
      return s / k
    }
    const day = mean(paint(scene()))
    const night = mean(paint(scene({ sun: sun(250, 6, 0) })))
    const dark = mean(paint(scene({ sun: sun(250, 6, 0), earth: earth(20, 4, 0) })))
    expect(day).toBeGreaterThan(40)
    expect(night).toBeLessThan(day / 3)
    expect(dark).toBeLessThanOrEqual(night)
    expect(dark).toBeLessThan(12) // the shadow floor, never pure black
    expect(dark).toBeGreaterThan(0)
  })

  it('draws without layers (skyline alone) and with the descent shape', () => {
    const one = paint(scene({ planes: null }))
    const x = 100
    expect(one[(Math.ceil(skyY(x) + 2) * W + x) * 4 + 3]).toBe(255)
    const flat = paint(scene({ shape: () => -90 }))
    expect(flat[(Math.ceil(skyY(x) + 2) * W + x) * 4 + 3]).toBe(255)
  })

  it('sizes its buffer to a pixel budget that follows the frame time', () => {
    expect(bufferScale(400, 300)).toBe(1)
    expect(bufferScale(2000, 1300)).toBeLessThan(0.5)
    expect(nextBudget(260_000, 40)).toBeLessThan(260_000)
    expect(nextBudget(260_000, 4)).toBeGreaterThan(260_000)
    expect(nextBudget(260_000, 14)).toBe(260_000)
  })
})
