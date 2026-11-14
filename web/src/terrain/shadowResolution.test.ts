import { describe, expect, it, vi } from 'vitest'
import { SHADOW_PLAY_SIZE, SHADOW_SIZE, TerrainEngine, shadowSize } from './engine'

/** The fields renderShadows reads, without a WebGL context or the tile workers. */
function fakeEngine() {
  const target = {
    width: SHADOW_SIZE,
    texture: {},
    setSize: vi.fn(function (this: { width: number }, w: number) {
      this.width = w
    }),
  }
  return {
    shadowTarget: target,
    shadowDirty: false,
    lastShadowAt: 0,
    shadowMaterial: { uniforms: { uHeight: { value: {} } } },
    shadowScene: {},
    shadowCamera: {},
    shared: { uShadow: { value: null }, uShadowReady: { value: 0 } },
    stats: { shadowPasses: 0 },
  }
}

function fakeRenderer() {
  return { getRenderTarget: () => null, setRenderTarget: vi.fn(), render: vi.fn() }
}

const renderShadows = (e: ReturnType<typeof fakeEngine>, r: ReturnType<typeof fakeRenderer>, playing: boolean) =>
  (TerrainEngine.prototype.renderShadows as (this: unknown, r: unknown, p: boolean) => void).call(e, r, playing)

describe('shadow resolution during playback', () => {
  it('uses half the side while playing and the full side at rest', () => {
    expect(shadowSize(false)).toBe(2048)
    expect(shadowSize(true)).toBe(1024)
    expect(SHADOW_PLAY_SIZE * 2).toBe(SHADOW_SIZE)
  })

  it('does nothing at rest when the Sun has not moved', () => {
    const e = fakeEngine()
    const r = fakeRenderer()
    renderShadows(e, r, false)
    expect(r.render).not.toHaveBeenCalled()
    expect(e.shadowTarget.setSize).not.toHaveBeenCalled()
  })

  it('switches to the low resolution when playback starts and recomputes at once', () => {
    const e = fakeEngine()
    const r = fakeRenderer()
    e.lastShadowAt = performance.now() // a pass just ran: the playback interval alone would skip this frame
    renderShadows(e, r, true)
    expect(e.shadowTarget.width).toBe(SHADOW_PLAY_SIZE)
    expect(r.render).toHaveBeenCalledTimes(1)
    expect(e.shadowDirty).toBe(false)
  })

  it('returns to full resolution when playback stops, even if the Sun did not move', () => {
    const e = fakeEngine()
    const r = fakeRenderer()
    renderShadows(e, r, true)
    renderShadows(e, r, false)
    expect(e.shadowTarget.width).toBe(SHADOW_SIZE)
    expect(r.render).toHaveBeenCalledTimes(2)
    renderShadows(e, r, false)
    expect(r.render).toHaveBeenCalledTimes(2)
  })
})
