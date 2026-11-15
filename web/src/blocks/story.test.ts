import { describe, expect, it } from 'vitest'
import {
  APOLLO17,
  APOLLO17_LANDING_MS,
  BLUE_GHOST,
  BLUE_GHOST_ECLIPSE_EVE_MS,
  CABEUS,
  CHAPTERS,
  EMPTY_MEMORY,
  GROUPS,
  IM1,
  MALAPERT,
  NOBILE,
  NOBILE_EARTH_UP_MS,
  SHACKLETON,
  SLIM,
  type StoryCtx,
  chapterDone,
  daysOf,
  dur,
  eclipseSpan,
  firstDay,
  questionReady,
  rankOf,
  stepsOf,
} from './story'

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
  eclipse: 0,
  tMs: 0,
  windowDays: 30,
  metrics: { sunlightPct: 52.9, commsPct: 82.9, longestDarkH: 325, longestBlackoutH: 123.5 },
  memory: EMPTY_MEMORY,
  names: (id) => ({ [MALAPERT]: 'Mons Malapert', [SHACKLETON]: 'Shackleton crater' })[id] ?? id,
}
const ch = (id: string) => CHAPTERS.find((c) => c.id === id)!
const H = 3_600_000

describe('mission log', () => {
  it('has twelve missions, four in each group, each with a place, a date, a picture story, a source, a task and a short lesson', () => {
    expect(CHAPTERS).toHaveLength(12)
    expect(new Set(CHAPTERS.map((c) => c.id)).size).toBe(12)
    for (const g of GROUPS) expect(CHAPTERS.filter((c) => c.group === g.id)).toHaveLength(4)
    // the map shows the groups in order, so the mission numbers follow it
    expect(CHAPTERS.map((c) => c.group)).toEqual([...CHAPTERS.map((c) => c.group)].sort((a, b) => GROUPS.findIndex((g) => g.id === a) - GROUPS.findIndex((g) => g.id === b)))
    for (const c of CHAPTERS) {
      // the short name fits under its icon in the mission picker
      expect(c.short.length).toBeGreaterThan(1)
      expect(c.short.length).toBeLessThanOrEqual(10)
      expect(c.where.length).toBeGreaterThan(2)
      expect(c.when.length).toBeGreaterThan(2)
      expect(c.story.length).toBeGreaterThanOrEqual(2)
      expect(c.story.length).toBeLessThanOrEqual(3)
      // a comic strip: a picture and a few words per beat, never a sentence to read
      for (const beat of c.story) {
        expect(beat.icon.length).toBeGreaterThan(0)
        expect(beat.text.length).toBeLessThanOrEqual(30)
      }
      expect(c.lesson.length).toBeLessThanOrEqual(50)
      expect(c.source.url).toMatch(/^https:\/\//)
      expect(c.lesson.length).toBeGreaterThan(10)
      const steps = c.steps(base)
      expect(steps.length).toBeGreaterThan(0)
      expect(steps.length).toBeLessThanOrEqual(3)
      for (const s of steps) {
        // every step has a picture, a few words, and says how to do it in one short line
        expect(s.icon.length).toBeGreaterThan(0)
        expect(s.text.length).toBeLessThanOrEqual(40)
        expect(s.tip.length).toBeGreaterThan(5)
        expect(s.tip.length).toBeLessThanOrEqual(40)
        // a step the child only looks at is ticked by its own button, never by itself
        if (s.action?.kind === 'look') expect(s.done).toBe(false)
      }
      // a question a child can answer: two or three choices
      if (c.question) {
        expect(c.question.choices.length).toBeGreaterThanOrEqual(2)
        expect(c.question.choices.length).toBeLessThanOrEqual(3)
        expect(c.question.text.length).toBeLessThanOrEqual(30)
        // each choice is a picture tile with a few words
        for (const k of c.question.choices) {
          expect(k.icon.length).toBeGreaterThan(0)
          expect(k.label.length).toBeLessThanOrEqual(22)
        }
      }
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
      { icon: '☀️', value: '13.5 days', label: 'of sunshine' },
      { icon: '🌑', value: '14 days', label: 'of night' },
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
    expect(c.found({ ...aDay, memory: { ...aDay.memory, answer: 'around' } })?.stats[0]).toEqual({ icon: '🔝', value: '6.2°', label: 'the highest in 30 days' })
  })

  it('Peaks of light: visit both places, then the answer is the one with more sunlight', () => {
    const c = ch('light-ice')
    const visited = { [MALAPERT]: { sunPct: 71.2, earthPct: 100 }, [SHACKLETON]: { sunPct: 0, earthPct: 40 } }
    const seen = { ...base, memory: { ...EMPTY_MEMORY, visited } }
    // the first step waits for the child to look and say so
    expect(questionReady(c, seen)).toBe(false)
    expect(c.steps(seen)[1].action).toEqual({ kind: 'site', id: SHACKLETON, label: 'Fly to Shackleton crater' })
    const ctx = { ...seen, memory: { ...seen.memory, latched: [0] } }
    expect(questionReady(c, ctx)).toBe(true)
    expect(c.question!.answer(ctx)).toBe(MALAPERT)
    const done = { ...ctx, memory: { ...ctx.memory, answer: MALAPERT } }
    expect(chapterDone(c, done)).toBe(true)
    expect(c.found(done)?.stats).toEqual([
      { icon: '⛰️', value: '21 days', label: 'sunny on Mons Malapert, of 30' },
      { icon: '🕳️', value: '0 days', label: 'sunny in Shackleton crater, of 30' },
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

  it('Calling home opens at a fixed moment when the Earth is up, inside the Sun and Earth tables (2025–2035)', () => {
    // a crater that never sees the Earth (Faustini, Shackleton) on "today" left the task impossible
    const { scene } = ch('call-home')
    expect(scene.site).toBe(NOBILE)
    expect(scene.atMs).toBe(NOBILE_EARTH_UP_MS)
    expect(NOBILE_EARTH_UP_MS).toBeGreaterThanOrEqual(Date.UTC(2025, 0, 1))
    expect(NOBILE_EARTH_UP_MS).toBeLessThan(Date.UTC(2035, 0, 1))
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
    expect(c.found(ready)?.note).toContain('No hill map here')
    expect(c.found({ ...ready, horizonKind: 'terrain' })?.note).toContain('real hills')
    expect(c.found(ready)?.stats).toHaveLength(4)
  })

  it('SLIM: starts on a morning looking away from the Sun, plays nine days, and the answer follows the Sun now', () => {
    const c = ch('slim')
    expect(c.scene).toMatchObject({ site: SLIM, atSunrise: true, afterSunriseH: 24, lookAway: true })
    const start = { ...base, view: 'ground' as const, sunOnScreen: true, sunEl: 11.6, memory: { ...EMPTY_MEMORY, startTMs: 0 } }
    expect(stepsOf(c, start).map((s) => s.done)).toEqual([true, false])
    expect(questionReady(c, { ...start, tMs: 8 * 24 * H })).toBe(false)
    // engine, SLIM's site, ten days after sunrise: the Sun is 55° to 57° up
    const later = { ...start, sunOnScreen: false, tMs: 9 * 24 * H, sunEl: 57.0, sunElMax: 78, memory: { ...start.memory, latched: [0] } }
    expect(questionReady(c, later)).toBe(true)
    expect(c.question!.answer(later)).toBe('high')
    expect(c.question!.answer({ ...later, sunEl: 11.6 })).toBe('low')
    expect(c.found(later)?.stats.map((s) => s.value)).toEqual(['57.0°', '78.0°'])
  })

  it('Apollo 17: three days of play, and the Earth stayed if the engine saw it all the time', () => {
    const c = ch('apollo-17')
    expect(c.scene).toMatchObject({ site: APOLLO17, atMs: APOLLO17_LANDING_MS })
    const start = { ...base, metrics: { ...base.metrics!, commsPct: 100 }, memory: { ...EMPTY_MEMORY, startTMs: APOLLO17_LANDING_MS, startEarthEl: 45.3 } }
    expect(questionReady(c, { ...start, tMs: APOLLO17_LANDING_MS + 71 * H })).toBe(false)
    const later = { ...start, tMs: APOLLO17_LANDING_MS + 72 * H }
    expect(questionReady(c, later)).toBe(true)
    expect(c.question!.answer(later)).toBe('stayed')
    expect(c.question!.answer({ ...later, metrics: { ...later.metrics, commsPct: 80 } })).toBe('hid')
    expect(c.found(later)).toEqual({
      stats: [{ icon: '🌍', value: '45.3°', label: 'Earth height (straight up is 90°)' }],
      note: 'The Earth never set! It just stays there.',
    })
    // no claim that it never set where the engine says it did
    expect(c.found({ ...later, metrics: { ...later.metrics, commsPct: 80 } })?.note).not.toContain('never set')
  })

  it('Odysseus: look, fly into Shackleton, and the answer is the place that sees the Earth more', () => {
    const c = ch('im-1')
    const visited = { [IM1]: { sunPct: 42.7, earthPct: 100 }, [SHACKLETON]: { sunPct: 0, earthPct: 0 } }
    const ctx = { ...base, memory: { ...EMPTY_MEMORY, visited, latched: [0] } }
    expect(questionReady(c, ctx)).toBe(true)
    expect(c.question!.answer(ctx)).toBe(IM1)
    expect(c.found(ctx)?.stats.map((s) => s.value)).toEqual(['30 days', '0 days'])
    expect(c.question!.answer({ ...base, memory: { ...EMPTY_MEMORY, visited: { [IM1]: visited[IM1] } } })).toBeNull()
  })

  it('Blue Ghost: waits for the middle of the eclipse the engine found, and tells how long it lasted', () => {
    const c = ch('blue-ghost')
    expect(c.scene).toMatchObject({ site: BLUE_GHOST, atMs: BLUE_GHOST_ECLIPSE_EVE_MS, until: 'eclipse' })
    // no eclipse found: nothing to wait for, no answer, no numbers
    const none = { ...base, memory: { ...EMPTY_MEMORY, startTMs: BLUE_GHOST_ECLIPSE_EVE_MS } }
    expect(c.question!.answer(none)).toBeNull()
    expect(c.found(none)).toBeNull()
    // engine, Mare Crisium, 14 March 2025: total from 06:20 to 08:35 UTC, any part of the Sun from 05:05 to 09:55
    const mid = Date.parse('2025-03-14T07:27:30Z')
    const start = { ...none, memory: { ...none.memory, targetMs: mid, eclipse: { totalH: 2.25, anyH: 4.83 } } }
    expect(stepsOf(c, { ...start, tMs: BLUE_GHOST_ECLIPSE_EVE_MS + 2 * H }).map((s) => s.done)).toEqual([true, false])
    const dark = { ...start, tMs: mid, eclipse: 2 }
    expect(questionReady(c, dark)).toBe(true)
    expect(c.question!.answer(dark)).toBe('earth')
    expect(c.found(dark)?.stats.map((s) => s.value)).toEqual(['2 hours', '5 hours'])
  })

  it('finds the first total eclipse in a series: its middle and how long it lasts', () => {
    // five-minute samples: clear, 3 partial, 4 total, 2 partial, clear
    const e = [0, 0, 1, 1, 1, 2, 2, 2, 2, 1, 1, 0]
    const t = e.map((_, i) => i * 300_000)
    expect(eclipseSpan(t, e)).toEqual({ midMs: 6.5 * 300_000, totalH: 4 / 12, anyH: 9 / 12 })
    // a partial eclipse alone is not the one the mission waits for
    expect(eclipseSpan(t, e.map((v) => Math.min(v, 1)))).toBeNull()
  })

  it('LCROSS: five days of play in Cabeus, and the answer follows the sunshine the engine found', () => {
    const c = ch('lcross')
    expect(c.scene.site).toBe(CABEUS)
    const dark = { ...base, tMs: 5 * 24 * H, metrics: { ...base.metrics!, sunlightPct: 0, longestDarkH: 720 }, memory: { ...EMPTY_MEMORY, startTMs: 0 } }
    expect(questionReady(c, dark)).toBe(true)
    expect(c.question!.answer(dark)).toBe('dark')
    expect(c.found(dark)?.stats.map((s) => s.value)).toEqual(['0 days', '30 days'])
    expect(c.found(dark)?.note).toContain('No sunshine at all')
    const lit = { ...dark, metrics: { ...dark.metrics, sunlightPct: 24 } }
    expect(c.question!.answer(lit)).toBe('sun')
    expect(c.found(lit)?.note).not.toContain('No sunshine at all')
  })

  it('Moon base: three places to visit, and the best is the one with the most Sun and Earth together', () => {
    const c = ch('moon-base')
    const visited = { [MALAPERT]: { sunPct: 45.8, earthPct: 100 }, [NOBILE]: { sunPct: 41.7, earthPct: 17.7 } }
    const two = { ...base, memory: { ...EMPTY_MEMORY, visited, latched: [0] } }
    expect(stepsOf(c, two).map((s) => s.done)).toEqual([true, true, false])
    expect(c.question!.answer(two)).toBeNull()
    const all = { ...two, memory: { ...two.memory, visited: { ...visited, [SHACKLETON]: { sunPct: 0, earthPct: 0 } } } }
    expect(questionReady(c, all)).toBe(true)
    expect(c.question!.answer(all)).toBe(MALAPERT)
    expect(c.found(all)?.note).toBe('Mons Malapert wins: the most Sun and Earth!')
    // the engine decides, not the text: a sunnier, better-connected crater would win
    const other = { ...all, memory: { ...all.memory, visited: { ...all.memory.visited, [NOBILE]: { sunPct: 90, earthPct: 90 } } } }
    expect(c.question!.answer(other)).toBe(NOBILE)
  })

  it('names the explorer by the missions done', () => {
    expect(rankOf(0, 12)).toBe('New explorer')
    expect(rankOf(1, 12)).toBe('Moon cadet')
    expect(rankOf(4, 12)).toBe('Moon pilot')
    expect(rankOf(8, 12)).toBe('Moon captain')
    expect(rankOf(12, 12)).toBe('Mission commander')
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
