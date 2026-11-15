import { describe, expect, it } from 'vitest'
import { nextDpr, SLOW_FPS } from './AdaptiveDpr'

describe('adaptive pixel ratio', () => {
  it('keeps every pixel on a machine that draws fast', () => {
    expect(nextDpr(2, 60)).toBe(2)
    expect(nextDpr(2, SLOW_FPS)).toBe(2)
    expect(nextDpr(1.5, 120)).toBe(1.5)
  })

  it('goes down one step at a time when the frame rate is low', () => {
    expect(nextDpr(2, 30)).toBe(1.5)
    expect(nextDpr(3, 30)).toBe(1.5)
    expect(nextDpr(1.5, 30)).toBe(1)
    expect(nextDpr(1.25, 30)).toBe(1)
  })

  it('never goes below one device pixel per CSS pixel', () => {
    expect(nextDpr(1, 10)).toBe(1)
    expect(nextDpr(0.75, 10)).toBe(0.75)
  })
})
