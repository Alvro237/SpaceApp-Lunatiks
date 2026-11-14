import { describe, expect, it } from 'vitest'
import { CHAPTERS, EMPTY_MEMORY, daysOf, dur, MALAPERT, SHACKLETON, type StoryCtx, chapterDone, firstDay, questionReady, stepsOf } from './story'

const base: StoryCtx = {
  view: 'moon',
  selection: { kind: 'site', id: 'shackleton' },
  placeName: 'Shackleton crater',
  horizonKind: 'terrain',
  sunUp: false,
  earthContact: true,
  sunEl: 1.47,
  sunElMax: 6.2,
  sunOnScreen: false,
  earthOnScreen: false,
  tMs: 0,
  windowDays: 30,
  metrics: { sunlightPct: 52.9, commsPct: 82.9, longestDarkH: 325, longestBlackoutH: 123.5 },
  memory: EMPTY_MEMORY,
  names: (id) => ({ [MALAPERT]: 'Mons Malapert', [SHACKLETON]: 'Shackleton crater' })[id] ?? id,
}
const ch = (id: string) => CHAPTERS.find((c) => c.id === id)!
const H = 3_600_000

describe('mission log', () => {
  it('has six chapters, each with a place, a date, short facts, a source, a task, a hint and a short lesson', () => {
    expect(CHAPTERS).toHaveLength(6)
    for (const c of CHAPTERS) {
      expect(c.where.length).toBeGreaterThan(2)
      expect(c.when.length).toBeGreaterThan(2)
      expect(c.story.length).toBeGreaterThanOrEqual(2)
      expect(c.story.length).toBeLessThanOrEqual(3)
      // one idea per line: no paragraphs
      for (const line of c.story) expect(line.length).toBeLessThanOrEqual(70)
      expect(c.lesson.length).toBeLessThanOrEqual(90)
      expect(c.source.url).toMatch(/^https:\/\//)
      expect(c.steps(base).length).toBeGreaterThan(0)
      expect(c.hint.length).toBeGreaterThan(10)
      expect(c.lesson.length).toBeGreaterThan(10)
    }
  })

  it('Apollo 11: find the Sun, then answer from the Sun elevation at the landing minute', () => {
    const a = ch('apollo-11')
    const atLanding = { ...base, memory: { ...EMPTY_MEMORY, startSunEl: 10.8 } }
    expect(questionReady(a, atLanding)).toBe(false)
    const found = { ...atLanding, view: 'ground' as const, sunOnScreen: true }
    expect(questionReady(a, found)).toBe(true)
    expect(a.question!.answer(found)).toBe('low')
    // the steps alone do not finish a chapter with a question
    expect(chapterDone(a, found)).toBe(false)
    const answered = { ...found, memory: { ...found.memory, answer: 'low' } }
    expect(chapterDone(a, answered)).toBe(true)
    expect(a.found(answered)?.stats[0].value).toBe('10.8°')
  })

  it('Apollo 11: no answer until the landing elevation is known, none for an ambiguous 20–45°', () => {
    const a = ch('apollo-11')
    expect(a.question!.answer(base)).toBeNull()
    expect(a.question!.answer({ ...base, memory: { ...EMPTY_MEMORY, startSunEl: 30 } })).toBeNull()
    expect(a.question!.answer({ ...base, memory: { ...EMPTY_MEMORY, startSunEl: 60 } })).toBe('high')
  })

  it('Chandrayaan-3: play from sunrise until the Sun sets, and say how long it lasted', () => {
    const c = ch('chandrayaan-3')
    const start = { ...base, sunUp: true, memory: { ...EMPTY_MEMORY, startTMs: 0, startSunUp: true, targetMs: 13.5 * 24 * H } }
    expect(stepsOf(c, start).map((s) => s.done)).toEqual([false, false])
    // the Sun dipping behind a hill for a moment is not the sunset
    expect(stepsOf(c, { ...start, tMs: 2 * H, sunUp: false }).map((s) => s.done)).toEqual([true, false])
    // 13.5 days later the Sun has set
    const later = { ...start, tMs: 13.6 * 24 * H, sunUp: false }
    expect(chapterDone(c, later)).toBe(true)
    expect(c.found(later)?.stats).toEqual([
      { value: '13.5 days', label: 'of sunshine, from sunrise to sunset' },
      { value: '14 days', label: 'of night, the longest one' },
    ])
  })

  it('finds the first day in a series, ignoring the Sun grazing the skyline at dawn', () => {
    // hourly samples: dark 3 h, lit 1 h, dark 1 h (a hill at dawn), lit 10 h, dark 30 h
    const lit = [0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, ...Array(30).fill(0)].map(Boolean)
    const t = lit.map((_, i) => i * H)
    expect(firstDay(t, lit)).toEqual({ rise: 3, set: 15 })
    expect(firstDay(t, lit.map(() => true))).toBeNull()
    expect(firstDay(t, lit.slice(0, 20))).toBeNull()
  })

  it('IM-2: the question waits for a day of playback, and the answer follows the highest Sun', () => {
    const c = ch('im-2')
    const seen = { ...base, view: 'ground' as const, sunOnScreen: true, memory: { ...EMPTY_MEMORY, startTMs: 0 } }
    expect(questionReady(c, seen)).toBe(false)
    const aDay = { ...seen, tMs: 25 * H }
    expect(questionReady(c, aDay)).toBe(true)
    expect(c.question!.answer(aDay)).toBe('around')
    expect(c.question!.answer({ ...aDay, sunElMax: 40 })).toBe('over')
    expect(c.found({ ...aDay, memory: { ...aDay.memory, answer: 'around' } })?.stats[0]).toEqual({ value: '6.2°', label: 'the highest the Sun gets in 30 days (90° is straight up)' })
  })

  it('Peaks of light: visit both places, then the answer is the one with more sunlight', () => {
    const c = ch('light-ice')
    const visited = { [MALAPERT]: { sunPct: 71.2, earthPct: 100 }, [SHACKLETON]: { sunPct: 0, earthPct: 40 } }
    const ctx = { ...base, memory: { ...EMPTY_MEMORY, visited } }
    expect(questionReady(c, ctx)).toBe(true)
    expect(c.question!.answer(ctx)).toBe(MALAPERT)
    const done = { ...ctx, memory: { ...ctx.memory, answer: SHACKLETON } }
    expect(chapterDone(c, done)).toBe(true)
    expect(c.found(done)?.stats).toEqual([
      { value: '21 days', label: 'of sunshine on Mons Malapert, out of 30' },
      { value: '0 days', label: 'of sunshine in Shackleton crater, out of 30' },
    ])
  })

  it('Calling home: find the Earth, then wait for it to hide; a place where it never hides says so', () => {
    const c = ch('call-home')
    const ctx = { ...base, view: 'ground' as const, earthOnScreen: true, earthContact: false }
    expect(chapterDone(c, ctx)).toBe(true)
    expect(c.found(ctx)?.stats.map((s) => s.value)).toEqual(['25 days', '5 days'])
    const never = { ...base, metrics: { ...base.metrics!, commsPct: 100 } }
    expect(c.steps(never)[1].text).toContain('never hides')
  })

  it('Plan a landing: a new place, Sun and Earth up, standing there; a typed point warns about the smooth horizon', () => {
    const c = ch('yours')
    const start = { ...base, memory: { ...EMPTY_MEMORY, startSel: base.selection } }
    // the place the chapter started at does not count
    expect(stepsOf(c, { ...start, sunUp: true, view: 'ground' }).map((s) => s.done)).toEqual([false, false, false])
    const point = { kind: 'point' as const, lat: -70, lon: 10 }
    const ready = { ...start, selection: point, sunUp: true, earthContact: true, view: 'ground' as const, horizonKind: 'smooth_sphere' as const, placeName: '70.000° S, 10.000° E' }
    expect(chapterDone(c, ready)).toBe(true)
    expect(c.found(ready)?.note).toContain('70.000° S, 10.000° E: ready to land!')
    expect(c.found(ready)?.note).toContain('Nobody has mapped the hills here yet')
    expect(c.found({ ...ready, horizonKind: 'terrain' })?.note).toContain('real hills')
    expect(c.found(ready)?.stats).toHaveLength(4)
  })

  it('says durations as hours below two days and as whole days above', () => {
    expect(dur(1)).toBe('1 hour')
    expect(dur(30)).toBe('30 hours')
    expect(dur(123.5)).toBe('5 days')
    // a share of the window told as days, for children
    expect(daysOf(71.2, 30)).toBe('21 days')
    expect(daysOf(3, 30)).toBe('1 day')
  })

  it('keeps a step ticked once reached (latched), even if the view moves on', () => {
    const c = ch('call-home')
    const moved = { ...base, view: 'ground' as const, earthOnScreen: false, memory: { ...EMPTY_MEMORY, latched: [0] } }
    expect(stepsOf(c, moved)[0].done).toBe(true)
  })
})
