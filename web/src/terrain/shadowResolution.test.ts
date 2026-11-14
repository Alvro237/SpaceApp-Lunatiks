import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHADOW_FAST_SIZE, SHADOW_SIZE, TerrainEngine } from './engine'
import { BANDS, SETTLE_MS, ShadowSchedule } from './shadowSchedule'

/** A render target as renderShadows uses it: its texture, and the scissor of a strip. */
function fakeTarget(size: number) {
  return {
    width: size,
    texture: { size },
    scissorTest: false,
    scissor: { set: vi.fn() },
  }
}

/** The fields renderShadows reads, without a WebGL context or the tile workers. */
function fakeEngine() {
  return {
    shadowTarget: fakeTarget(SHADOW_SIZE),
    shadowTargetFast: fakeTarget(SHADOW_FAST_SIZE),
    shadowSchedule: new ShadowSchedule(),
    shadowMaterial: { uniforms: { uHeight: { value: {} } } },
    shadowScene: {},
    shadowCamera: {},
    shared: { uShadow: { value: null as { size: number } | null }, uShadowReady: { value: 0 } },
    stats: { shadowPasses: 0 },
  }
}

function fakeRenderer() {
  const targets: number[] = []
  return {
    targets,
    getRenderTarget: () => null,
    setRenderTarget: vi.fn((t: { width: number } | null) => {
      if (t) targets.push(t.width)
    }),
    render: vi.fn(),
  }
}

let now = 0
const at = (t: number) => {
  now = t
}
const renderShadows = (e: ReturnType<typeof fakeEngine>, r: ReturnType<typeof fakeRenderer>, playing: boolean) =>
  (TerrainEngine.prototype.renderShadows as (this: unknown, r: unknown, p: boolean) => void).call(e, r, playing)

describe('shadow resolution', () => {
  afterEach(() => vi.restoreAllMocks())

  it('draws at half the side while the Sun moves and shows the full side once it is still', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    expect(SHADOW_FAST_SIZE * 2).toBe(SHADOW_SIZE)
    const e = fakeEngine()
    const r = fakeRenderer()
    // playing: every Sun change is drawn at 1024
    for (let t = 1000; t <= 2000; t += 100) {
      at(t)
      e.shadowSchedule.changed(t)
      renderShadows(e, r, true)
    }
    expect(new Set(r.targets)).toEqual(new Set([SHADOW_FAST_SIZE]))
    expect(e.shared.uShadow.value?.size).toBe(SHADOW_FAST_SIZE)
    // stopped: after the settle time the full texture is drawn in strips and shown after the last one
    r.targets.length = 0
    for (let k = 0; k < BANDS; k++) {
      at(2000 + SETTLE_MS + 16 * (k + 1))
      renderShadows(e, r, false)
      expect(e.shared.uShadow.value?.size).toBe(k < BANDS - 1 ? SHADOW_FAST_SIZE : SHADOW_SIZE)
    }
    expect(r.targets).toEqual(Array(BANDS).fill(SHADOW_SIZE))
    expect(e.shadowTarget.scissor.set).toHaveBeenCalledTimes(BANDS)
  })

  it('does nothing at rest when the Sun has not moved', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const e = fakeEngine()
    const r = fakeRenderer()
    at(0)
    e.shadowSchedule.changed(0)
    for (let t = 0; t <= 2000; t += 16) {
      at(t)
      renderShadows(e, r, false)
    }
    const passes = r.render.mock.calls.length
    expect(passes).toBe(1 + BANDS)
    for (let t = 2016; t <= 4000; t += 16) {
      at(t)
      renderShadows(e, r, false)
    }
    expect(r.render).toHaveBeenCalledTimes(passes)
  })
})
