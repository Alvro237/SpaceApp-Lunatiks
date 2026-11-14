import { describe, expect, it } from 'vitest'
import { CHAPTERS, EMPTY_MEMORY, IM2, MALAPERT, SHACKLETON, type StoryCtx, chapterDone } from './story'

const base: StoryCtx = {
  view: 'moon',
  selection: { kind: 'site', id: 'shackleton' },
  lat: -89.67,
  horizonKind: 'terrain',
  sunUp: false,
  earthContact: true,
  sunEl: 1.47,
  sunOnScreen: false,
  earthOnScreen: false,
  tMs: 0,
  metrics: { sunlightPct: 52.9, commsPct: 82.9, longestDarkH: 325, longestBlackoutH: 123.5 },
  memory: EMPTY_MEMORY,
  names: (id) => ({ [MALAPERT]: 'Mons Malapert', [SHACKLETON]: 'Shackleton crater' })[id] ?? id,
}
const ch = (id: string) => CHAPTERS.find((c) => c.id === id)!

describe('Pip’s story', () => {
  it('has six chapters, each with a story, a task and an ending', () => {
    expect(CHAPTERS).toHaveLength(6)
    for (const c of CHAPTERS) {
      expect(c.story.length).toBeGreaterThan(40)
      expect(c.steps(base).length).toBeGreaterThan(0)
    }
  })

  it('Arrival is done once Pip stands at IM-2', () => {
    const a = ch('arrival')
    expect(chapterDone(a, base)).toBe(false)
    expect(chapterDone(a, { ...base, selection: { kind: 'site', id: IM2 }, view: 'ground' })).toBe(true)
    // 90 − 84.78 = 5.22° of arc on a 1737.4 km sphere: 158 km
    expect(a.found({ ...base, lat: -84.78 })).toContain('about 158 km from the pole')
  })

  it('Where is the Sun? needs the Sun on screen in the ground view, and explains the hills', () => {
    const s = ch('sun')
    expect(chapterDone(s, { ...base, view: 'ground' })).toBe(false)
    const done = { ...base, view: 'ground' as const, sunOnScreen: true }
    expect(chapterDone(s, done)).toBe(true)
    expect(s.found(done)).toContain('1.47°')
    expect(s.found(done)).toContain('hills')
  })

  it('The long night needs time to move and the Sun to come back', () => {
    const n = ch('night')
    const memory = { ...EMPTY_MEMORY, startTMs: 0, startSunUp: false }
    expect(chapterDone(n, { ...base, memory })).toBe(false)
    expect(chapterDone(n, { ...base, memory, tMs: 30 * 3_600_000, sunUp: true })).toBe(true)
    expect(n.found({ ...base, memory, tMs: 30 * 3_600_000, sunUp: true })).toContain('Pip waited 30 hours')
  })

  it('Calling home needs the Earth seen, then lost', () => {
    const c = ch('call')
    const seen = { ...base, view: 'ground' as const, earthOnScreen: true }
    expect(chapterDone(c, seen)).toBe(false)
    expect(chapterDone(c, { ...seen, earthContact: false })).toBe(true)
    expect(c.found(seen)).toContain('124 hours')
  })

  it('A better home compares the two visits with their own numbers', () => {
    const h = ch('home')
    const visited = { [MALAPERT]: { sunPct: 80, earthPct: 90 }, [SHACKLETON]: { sunPct: 0, earthPct: 10 } }
    expect(h.choices!({ ...base, memory: { ...EMPTY_MEMORY, visited: { [MALAPERT]: visited[MALAPERT] } } })).toBeNull()
    const ctx = { ...base, memory: { ...EMPTY_MEMORY, visited, answer: MALAPERT } }
    expect(h.choices!(ctx)).toHaveLength(2)
    expect(chapterDone(h, ctx)).toBe(true)
    expect(h.found(ctx)).toContain('You chose right')
    expect(h.found(ctx)).toContain('80 %')
    expect(h.found({ ...ctx, memory: { ...ctx.memory, answer: SHACKLETON } })).toContain('Not this time')
  })

  it('Your own spot warns that a typed point has no measured skyline', () => {
    const y = ch('yours')
    const ctx = { ...base, selection: { kind: 'point' as const, lat: -85, lon: 20 }, lat: -85, view: 'ground' as const, horizonKind: 'smooth_sphere' as const }
    expect(chapterDone(y, ctx)).toBe(true)
    expect(y.found(ctx)).toContain('smooth')
  })
})
